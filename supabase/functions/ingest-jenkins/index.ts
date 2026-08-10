// ingest-jenkins -- Edge Function
// Polls Jenkins REST API for recent CAPA CI builds and upserts into the builds table.
// Triggered by pg_cron every 5 minutes.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const JENKINS_BASE_URL = Deno.env.get("JENKINS_BASE_URL")!; // e.g. https://jenkins-csb-rhacm-tests.dno.corp.redhat.com/job/CI-Jobs/job/capi_tests
const JENKINS_USER = Deno.env.get("JENKINS_USER")!;
const JENKINS_API_TOKEN = Deno.env.get("JENKINS_API_TOKEN")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Jenkins job names to poll
const JENKINS_JOBS = [
  "capi_tests",
  "capi_nightly",
  "rosa_hcp_e2e",
  "capa_e2e_nightly",
  "capa_upgrade_tests",
];

interface JenkinsBuild {
  number: number;
  result: string | null;
  timestamp: number;
  duration: number;
  url: string;
  actions: Array<{
    _class?: string;
    parameters?: Array<{ name: string; value: string }>;
  }>;
}

interface JenkinsTestCase {
  name: string;
  className: string;
  status: string;
  errorDetails: string | null;
  errorStackTrace: string | null;
}

interface JenkinsTestReport {
  passCount: number;
  failCount: number;
  skipCount: number;
  suites: Array<{
    cases: JenkinsTestCase[];
  }>;
}

function mapJenkinsResult(result: string | null): string {
  if (!result) return "running";
  switch (result.toUpperCase()) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
      return "failure";
    case "ABORTED":
      return "aborted";
    case "UNSTABLE":
      return "unstable";
    default:
      return "pending";
  }
}

function extractParameters(
  actions: JenkinsBuild["actions"]
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const action of actions) {
    if (action.parameters) {
      for (const p of action.parameters) {
        params[p.name] = p.value;
      }
    }
  }
  return params;
}

function extractOcpVersion(params: Record<string, string>): string | null {
  // Look for common OCP version parameter names
  for (const key of [
    "OCP_VERSION",
    "OPENSHIFT_VERSION",
    "ocp_version",
    "VERSION",
  ]) {
    if (params[key]) return params[key];
  }
  return null;
}

async function fetchJenkinsApi(path: string): Promise<unknown> {
  const url = `${JENKINS_BASE_URL}${path}`;
  const credentials = btoa(`${JENKINS_USER}:${JENKINS_API_TOKEN}`);

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    },
    // Deno does not support rejectUnauthorized directly, but we can use
    // the Deno.HttpClient with cert verification disabled for self-signed certs
  });

  if (!response.ok) {
    throw new Error(`Jenkins API error: ${response.status} ${response.statusText} for ${url}`);
  }

  return response.json();
}

async function fetchTestReport(
  buildNumber: number
): Promise<JenkinsTestReport | null> {
  try {
    const report = (await fetchJenkinsApi(
      `/${buildNumber}/testReport/api/json`
    )) as JenkinsTestReport;
    return report;
  } catch (_err) {
    // Test report may not exist for all builds (e.g., aborted builds)
    return null;
  }
}

function extractTestFailures(
  report: JenkinsTestReport | null
): Array<{
  name: string;
  className: string;
  errorMessage: string;
  errorStackTrace: string;
}> {
  if (!report) return [];
  const failures: Array<{
    name: string;
    className: string;
    errorMessage: string;
    errorStackTrace: string;
  }> = [];

  for (const suite of report.suites || []) {
    for (const testCase of suite.cases || []) {
      if (
        testCase.status === "FAILED" ||
        testCase.status === "REGRESSION"
      ) {
        failures.push({
          name: testCase.name,
          className: testCase.className,
          errorMessage: testCase.errorDetails || "",
          errorStackTrace: testCase.errorStackTrace || "",
        });
      }
    }
  }

  return failures;
}

async function ingestJob(jobName: string): Promise<{
  ingested: number;
  skipped: number;
  errors: string[];
}> {
  const result = { ingested: 0, skipped: 0, errors: [] as string[] };

  // Fetch recent builds from Jenkins (last 20)
  let builds: JenkinsBuild[];
  try {
    const data = (await fetchJenkinsApi(
      `/api/json?tree=builds[number,result,timestamp,duration,url,actions[parameters[name,value]]]{0,20}`
    )) as { builds: JenkinsBuild[] };
    builds = data.builds || [];
  } catch (err) {
    result.errors.push(`Failed to fetch builds for ${jobName}: ${(err as Error).message}`);
    return result;
  }

  for (const build of builds) {
    try {
      const parameters = extractParameters(build.actions || []);
      const ocpVersion = extractOcpVersion(parameters);
      const status = mapJenkinsResult(build.result);

      // Fetch test report for completed builds
      let testReport: JenkinsTestReport | null = null;
      if (build.result) {
        testReport = await fetchTestReport(build.number);
      }

      const testFailures = extractTestFailures(testReport);

      const startedAt = new Date(build.timestamp).toISOString();
      const finishedAt = build.result
        ? new Date(build.timestamp + build.duration).toISOString()
        : null;

      // Upsert the build
      const { data: upsertedBuild, error: upsertError } = await supabase
        .from("builds")
        .upsert(
          {
            source: "jenkins",
            external_id: String(build.number),
            job_name: jobName,
            job_url: build.url,
            status,
            pass_count: testReport?.passCount ?? 0,
            fail_count: testReport?.failCount ?? 0,
            skip_count: testReport?.skipCount ?? 0,
            total_count:
              (testReport?.passCount ?? 0) +
              (testReport?.failCount ?? 0) +
              (testReport?.skipCount ?? 0),
            duration_ms: build.duration || null,
            started_at: startedAt,
            finished_at: finishedAt,
            ocp_version: ocpVersion,
            parameters,
            test_failures: testFailures,
            raw_payload: build,
          },
          {
            onConflict: "source,external_id,job_name",
            ignoreDuplicates: false,
          }
        )
        .select("id")
        .single();

      if (upsertError) {
        // If the upsert was skipped by the terminal-state guard, this is expected
        if (upsertError.code === "PGRST116") {
          result.skipped++;
          continue;
        }
        result.errors.push(
          `Upsert failed for build #${build.number}: ${upsertError.message}`
        );
        continue;
      }

      // Insert build_completed activity for finished builds (only if not already logged)
      if (build.result && upsertedBuild) {
        const { count: existingCount } = await supabase
          .from("activities")
          .select("id", { count: "exact", head: true })
          .eq("build_id", upsertedBuild.id)
          .eq("activity_type", "build_completed");

        if (!existingCount || existingCount === 0) {
          await supabase.from("activities").insert({
            activity_type: "build_completed",
            title: `Build #${build.number} ${status}`,
            description: `Jenkins job ${jobName} build #${build.number} completed with status: ${status}. ${testReport?.failCount ?? 0} test failures.`,
            build_id: upsertedBuild.id,
            actor: "ingest-jenkins",
            metadata: {
              source: "jenkins",
              job_name: jobName,
              build_number: build.number,
              pass_count: testReport?.passCount ?? 0,
              fail_count: testReport?.failCount ?? 0,
            },
          });
        }
      }

      result.ingested++;
    } catch (err) {
      result.errors.push(
        `Error processing build #${build.number}: ${(err as Error).message}`
      );
    }
  }

  return result;
}

serve(async (req: Request) => {
  const startTime = Date.now();
  let overallSuccess = true;
  const allResults: Record<
    string,
    { ingested: number; skipped: number; errors: string[] }
  > = {};

  try {
    // Process each Jenkins job
    for (const jobName of JENKINS_JOBS) {
      const result = await ingestJob(jobName);
      allResults[jobName] = result;
      if (result.errors.length > 0) {
        overallSuccess = false;
      }
    }

    const totalIngested = Object.values(allResults).reduce(
      (sum, r) => sum + r.ingested,
      0
    );
    const totalErrors = Object.values(allResults).reduce(
      (sum, r) => sum + r.errors.length,
      0
    );

    // Log the agent run
    await supabase.from("agent_runs").insert({
      agent_name: "ingest-jenkins",
      trigger: "cron",
      input_payload: { jobs: JENKINS_JOBS },
      output_payload: allResults,
      success: overallSuccess,
      error_message: overallSuccess
        ? null
        : `${totalErrors} error(s) across jobs`,
      duration_ms: Date.now() - startTime,
    });

    return new Response(
      JSON.stringify({
        success: overallSuccess,
        total_ingested: totalIngested,
        results: allResults,
      }),
      {
        status: overallSuccess ? 200 : 207,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const errorMessage = (err as Error).message;

    // Log the failed agent run
    await supabase.from("agent_runs").insert({
      agent_name: "ingest-jenkins",
      trigger: "cron",
      input_payload: { jobs: JENKINS_JOBS },
      output_payload: null,
      success: false,
      error_message: errorMessage,
      duration_ms: Date.now() - startTime,
    });

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
