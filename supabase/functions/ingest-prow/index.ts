// ingest-prow -- Edge Function
// Polls Prow prowjobs.js endpoint for recent CAPA/ROSA periodic jobs
// and upserts into the builds table.
// Triggered by pg_cron every 5 minutes (staggered +2 min from Jenkins).

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Prow API endpoint (public, no auth required)
const PROW_API_URL =
  "https://prow.ci.openshift.org/prowjobs.js?type=periodic&job=*capa-e2e*";

// Only match CAPA e2e jobs
const PROW_JOB_PATTERNS = [
  /periodic-ci-openshift-online-rosa-e2e-main_capa-e2e/,
];

interface ProwJob {
  spec: {
    job: string;
    type: string;
    cluster?: string;
    refs?: {
      org: string;
      repo: string;
      base_ref: string;
    };
    extra_refs?: Array<{
      org: string;
      repo: string;
      base_ref: string;
    }>;
    decoration_config?: Record<string, unknown>;
  };
  status: {
    state: string;
    startTime?: string;
    completionTime?: string;
    url?: string;
    build_id?: string;
    description?: string;
  };
  metadata?: {
    name?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
}

function mapProwState(state: string): string {
  switch (state.toLowerCase()) {
    case "success":
      return "success";
    case "failure":
    case "error":
      return "failure";
    case "pending":
    case "triggered":
      return "pending";
    case "aborted":
      return "aborted";
    default:
      return "pending";
  }
}

function isRelevantJob(jobName: string): boolean {
  return PROW_JOB_PATTERNS.some((pattern) => pattern.test(jobName));
}

function extractOcpVersionFromJobName(jobName: string): string | null {
  // Prow job names often contain the OCP version, e.g.:
  // periodic-ci-openshift-cluster-api-provider-aws-release-4.17-e2e-rosa-hcp-e2e-main_capa-e2e
  const match = jobName.match(/release-(\d+\.\d+)/);
  if (match) return match[1];

  // Also try matching version from annotations or labels
  const nightlyMatch = jobName.match(
    /(\d+\.\d+(?:\.\d+)?(?:-nightly)?)/
  );
  if (nightlyMatch) return nightlyMatch[1];

  return null;
}

function computeDurationMs(
  startTime?: string,
  completionTime?: string
): number | null {
  if (!startTime || !completionTime) return null;
  const start = new Date(startTime).getTime();
  const end = new Date(completionTime).getTime();
  const duration = end - start;
  return duration >= 0 ? duration : null;
}

function extractTestFailuresFromDescription(
  description?: string
): Array<{
  name: string;
  className: string;
  errorMessage: string;
  errorStackTrace: string;
}> {
  // Prow does not provide structured test failure data in prowjobs.js.
  // The description field sometimes contains summary info.
  // We create a minimal test failure entry from the description if the job failed.
  if (!description) return [];

  return [
    {
      name: "prow-job-result",
      className: "ProwJobExecution",
      errorMessage: description,
      errorStackTrace: "",
    },
  ];
}

serve(async (_req: Request) => {
  const startTime = Date.now();
  let ingested = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    // Fetch ProwJobs from the public API
    const response = await fetch(PROW_API_URL, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(
        `Prow API error: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as { items?: ProwJob[] };
    const prowJobs = data.items || [];

    // Filter to only relevant CAPA/ROSA jobs
    const relevantJobs = prowJobs.filter((pj) =>
      isRelevantJob(pj.spec.job)
    );

    for (const prowJob of relevantJobs) {
      try {
        const jobName = prowJob.spec.job;
        const buildId =
          prowJob.status.build_id ||
          prowJob.metadata?.name ||
          `${jobName}-${prowJob.status.startTime || "unknown"}`;
        const status = mapProwState(prowJob.status.state);
        const ocpVersion = extractOcpVersionFromJobName(jobName);
        const durationMs = computeDurationMs(
          prowJob.status.startTime,
          prowJob.status.completionTime
        );

        // Build test_failures from description when the job failed
        const testFailures =
          status === "failure"
            ? extractTestFailuresFromDescription(
                prowJob.status.description
              )
            : [];

        // Upsert the build
        const { data: upsertedBuild, error: upsertError } = await supabase
          .from("builds")
          .upsert(
            {
              source: "prow",
              external_id: buildId,
              job_name: jobName,
              job_url: prowJob.status.url || null,
              status,
              pass_count: status === "success" ? 1 : 0,
              fail_count: status === "failure" ? 1 : 0,
              skip_count: 0,
              total_count: 1,
              duration_ms: durationMs,
              started_at: prowJob.status.startTime || null,
              finished_at: prowJob.status.completionTime || null,
              ocp_version: ocpVersion,
              parameters: {
                prow_job_type: prowJob.spec.type,
                cluster: prowJob.spec.cluster || null,
                refs: prowJob.spec.refs || null,
              },
              test_failures: testFailures,
              raw_payload: prowJob,
            },
            {
              onConflict: "source,external_id,job_name",
              ignoreDuplicates: false,
            }
          )
          .select("id")
          .single();

        if (upsertError) {
          if (upsertError.code === "PGRST116") {
            skipped++;
            continue;
          }
          errors.push(
            `Upsert failed for Prow job ${jobName}/${buildId}: ${upsertError.message}`
          );
          continue;
        }

        // Insert build_completed activity for finished builds (only if not already logged)
        if (
          prowJob.status.completionTime &&
          upsertedBuild
        ) {
          const { count: existingCount } = await supabase
            .from("activities")
            .select("id", { count: "exact", head: true })
            .eq("build_id", upsertedBuild.id)
            .eq("activity_type", "build_completed");

          if (!existingCount || existingCount === 0) {
            await supabase.from("activities").insert({
              activity_type: "build_completed",
              title: `Prow job ${jobName} ${status}`,
              description: `Prow periodic job ${jobName} completed with status: ${status}.${prowJob.status.description ? " " + prowJob.status.description : ""}`,
              build_id: upsertedBuild.id,
              actor: "ingest-prow",
              metadata: {
                source: "prow",
                job_name: jobName,
                build_id: buildId,
                prow_state: prowJob.status.state,
              },
            });
          }
        }

        ingested++;
      } catch (err) {
        errors.push(
          `Error processing Prow job ${prowJob.spec.job}: ${(err as Error).message}`
        );
      }
    }

    const success = errors.length === 0;

    // Log the agent run
    await supabase.from("agent_runs").insert({
      agent_name: "ingest-prow",
      trigger: "cron",
      input_payload: {
        api_url: PROW_API_URL,
        total_jobs_fetched: prowJobs.length,
        relevant_jobs: relevantJobs.length,
      },
      output_payload: { ingested, skipped, errors },
      success,
      error_message: success
        ? null
        : `${errors.length} error(s) during ingestion`,
      duration_ms: Date.now() - startTime,
    });

    return new Response(
      JSON.stringify({ success, ingested, skipped, errors }),
      {
        status: success ? 200 : 207,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const errorMessage = (err as Error).message;

    await supabase.from("agent_runs").insert({
      agent_name: "ingest-prow",
      trigger: "cron",
      input_payload: { api_url: PROW_API_URL },
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
