// diagnosis -- Edge Function
// Called by the triage agent after ticket creation.
// Matches test_failures against 12 known-issue regex patterns.
// Updates ticket with root_cause, root_cause_category, and potentially adjusted severity.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================
// 12 Known Issue Patterns
// Ported from rosa-hcp-e2e-test-fresh-upstream/agents/knowledge_base/known_issues.json
// ============================================================

interface KnownIssue {
  type: string;
  pattern: string;
  description: string;
  category: string;
  default_severity: string;
}

const KNOWN_ISSUES: KnownIssue[] = [
  {
    type: "cloudformation_deletion_failure",
    pattern:
      "CloudFormation stack DELETE_FAILED:.*|FAILED - RETRYING.*cloudformation.*deletion",
    description:
      "AWS CloudFormation stack deletion failure -- ROSA creates security groups outside CF that block VPC deletion",
    category: "aws_infrastructure",
    default_severity: "infrastructure",
  },
  {
    type: "ocm_auth_failure",
    pattern:
      ".*(ocm|openshift cluster manager).*(401|403|unauthorized|forbidden).*",
    description: "OpenShift Cluster Manager authentication failure",
    category: "auth_credentials",
    default_severity: "infrastructure",
  },
  {
    type: "capi_not_installed",
    pattern:
      ".*(capi|cluster.*api).*(not found|does not exist|no.*running).*",
    description: "CAPI/CAPA controllers not installed or running",
    category: "capi_setup",
    default_severity: "upstream_breakage",
  },
  {
    type: "api_rate_limit",
    pattern:
      "^(?!.*(?:Pattern matched|Issue detected|Fix applied|Monitor|Remediation|RETRYING|retries left)).*(?:HTTP.*429|rate.limit.exceed|throttl.*request|too.many.requests.*api).*",
    description: "API rate limiting encountered",
    category: "aws_infrastructure",
    default_severity: "infrastructure",
  },
  {
    type: "resource_quota_exceeded",
    pattern: ".*(quota|limit).*exceed.*",
    description: "Resource quota or limit exceeded",
    category: "aws_infrastructure",
    default_severity: "infrastructure",
  },
  {
    type: "rosacontrolplane_stuck_deletion",
    pattern:
      "FAILED - RETRYING.*(?:rosacontrolplane|ROSAControlPlane).*(?:delet|still exists)|FAILED - RETRYING.*(?:delet).*(?:rosacontrolplane|ROSAControlPlane)",
    description:
      "ROSAControlPlane stuck in deletion state due to finalizers or AWS resource cleanup",
    category: "rosa_lifecycle",
    default_severity: "infrastructure",
  },
  {
    type: "rosanetwork_stuck_deletion",
    pattern:
      "FAILED - RETRYING.*(?:rosanetwork|ROSANetwork).*(?:delet|still exists)|FAILED - RETRYING.*(?:delet).*(?:rosanetwork|ROSANetwork)",
    description:
      "ROSANetwork stuck in deletion state due to finalizers or VPC dependencies",
    category: "rosa_lifecycle",
    default_severity: "infrastructure",
  },
  {
    type: "rosaroleconfig_stuck_deletion",
    pattern:
      "FAILED - RETRYING.*(?:rosaroleconfig|ROSARoleConfig).*(?:delet|still exists)|FAILED - RETRYING.*(?:delet).*(?:rosaroleconfig|ROSARoleConfig)",
    description:
      "ROSARoleConfig stuck in deletion state due to finalizers or IAM cleanup",
    category: "rosa_lifecycle",
    default_severity: "infrastructure",
  },
  {
    type: "vpc_deletion_failure",
    pattern:
      ".*vpc.*(has dependencies|cannot be deleted|delete.*fail|DELETE_FAILED).*",
    description: "VPC deletion failure due to orphaned dependencies",
    category: "aws_infrastructure",
    default_severity: "infrastructure",
  },
  {
    type: "networking_configuration_error",
    pattern:
      "(?i)(?:subnet|vpc).*(?:invalid|not found|does not exist|no route|unreachable)",
    description: "Network configuration error",
    category: "aws_infrastructure",
    default_severity: "infrastructure",
  },
  {
    type: "repeated_timeouts",
    pattern:
      "^(?!.*(?:Pattern matched|Issue detected|RETRYING)).*(?:timed?.out|timeout.*(?:waiting|exceeded|expired)).*",
    description: "Operation timing out repeatedly",
    category: "infrastructure_timeout",
    default_severity: "infrastructure",
  },
  {
    type: "iam_permission_error",
    pattern:
      "(?i)(?:access denied|not authorized|AccessDenied|UnauthorizedAccess|iam.*(?:error|fail|denied))",
    description: "IAM permission or role error",
    category: "aws_iam",
    default_severity: "infrastructure",
  },
];

interface TestFailure {
  name: string;
  className: string;
  errorMessage: string;
  errorStackTrace: string;
}

interface DiagnosisResult {
  root_cause: string;
  root_cause_category: string;
  severity: string;
  matched_pattern: string;
}

function diagnoseFailures(
  testFailures: TestFailure[]
): DiagnosisResult | null {
  for (const failure of testFailures) {
    const errorText = failure.errorMessage || "";
    for (const issue of KNOWN_ISSUES) {
      try {
        const regex = new RegExp(issue.pattern, "i");
        if (regex.test(errorText)) {
          return {
            root_cause: issue.description,
            root_cause_category: issue.category,
            severity: issue.default_severity,
            matched_pattern: issue.type,
          };
        }
      } catch (_err) {
        // Skip invalid regex patterns
        console.error(`Invalid regex pattern for ${issue.type}: ${issue.pattern}`);
      }
    }

    // Also check the stack trace
    const stackText = failure.errorStackTrace || "";
    if (stackText) {
      for (const issue of KNOWN_ISSUES) {
        try {
          const regex = new RegExp(issue.pattern, "i");
          if (regex.test(stackText)) {
            return {
              root_cause: issue.description,
              root_cause_category: issue.category,
              severity: issue.default_severity,
              matched_pattern: issue.type,
            };
          }
        } catch (_err) {
          // Skip invalid regex patterns
        }
      }
    }
  }

  return null;
}

serve(async (req: Request) => {
  const startTime = Date.now();

  try {
    const body = await req.json();
    const ticketId: string = body.ticket_id;
    const buildId: string = body.build_id;

    if (!ticketId || !buildId) {
      return new Response(
        JSON.stringify({
          error: "ticket_id and build_id are required",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Fetch the build with test_failures
    const { data: build, error: buildError } = await supabase
      .from("builds")
      .select("id, job_name, test_failures, parameters, ocp_version")
      .eq("id", buildId)
      .single();

    if (buildError || !build) {
      throw new Error(
        `Build not found: ${buildId} -- ${buildError?.message}`
      );
    }

    const testFailures: TestFailure[] = build.test_failures || [];
    const diagnosisResult = diagnoseFailures(testFailures);

    if (diagnosisResult) {
      // Update the ticket with diagnosis results
      const updatePayload: Record<string, unknown> = {
        root_cause: diagnosisResult.root_cause,
        root_cause_category: diagnosisResult.root_cause_category,
        diagnosed_at: new Date().toISOString(),
      };

      // Only adjust severity if the diagnosis suggests a different one
      // and the current severity is the default (test_regression)
      const { data: currentTicket } = await supabase
        .from("support_tickets")
        .select("severity")
        .eq("id", ticketId)
        .single();

      if (
        currentTicket &&
        currentTicket.severity === "test_regression" &&
        diagnosisResult.severity !== "test_regression"
      ) {
        updatePayload.severity = diagnosisResult.severity;
      }

      const { error: updateError } = await supabase
        .from("support_tickets")
        .update(updatePayload)
        .eq("id", ticketId);

      if (updateError) {
        throw new Error(
          `Failed to update ticket: ${updateError.message}`
        );
      }

      // Insert diagnosis_completed activity
      await supabase.from("activities").insert({
        activity_type: "diagnosis_completed",
        title: `Diagnosis completed: ${diagnosisResult.matched_pattern}`,
        description: `Root cause identified: ${diagnosisResult.root_cause}. Category: ${diagnosisResult.root_cause_category}.`,
        ticket_id: ticketId,
        build_id: buildId,
        actor: "diagnosis-agent",
        metadata: {
          matched_pattern: diagnosisResult.matched_pattern,
          root_cause: diagnosisResult.root_cause,
          root_cause_category: diagnosisResult.root_cause_category,
          severity_adjusted:
            currentTicket?.severity !== diagnosisResult.severity,
          patterns_checked: KNOWN_ISSUES.length,
        },
      });
    } else {
      // No known pattern matched -- still record the attempt
      await supabase.from("activities").insert({
        activity_type: "diagnosis_completed",
        title: "Diagnosis completed: no known pattern matched",
        description: `Checked ${KNOWN_ISSUES.length} known issue patterns against ${testFailures.length} test failure(s). No match found -- manual investigation required.`,
        ticket_id: ticketId,
        build_id: buildId,
        actor: "diagnosis-agent",
        metadata: {
          matched_pattern: null,
          patterns_checked: KNOWN_ISSUES.length,
          failures_checked: testFailures.length,
        },
      });
    }

    const outputPayload = {
      ticket_id: ticketId,
      build_id: buildId,
      diagnosis: diagnosisResult || { matched: false },
      patterns_checked: KNOWN_ISSUES.length,
      failures_checked: testFailures.length,
    };

    // Log the agent run
    await supabase.from("agent_runs").insert({
      agent_name: "diagnosis",
      trigger: "triage-agent",
      input_payload: { ticket_id: ticketId, build_id: buildId },
      output_payload: outputPayload,
      success: true,
      duration_ms: Date.now() - startTime,
    });

    return new Response(
      JSON.stringify({ success: true, ...outputPayload }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const errorMessage = (err as Error).message;

    await supabase.from("agent_runs").insert({
      agent_name: "diagnosis",
      trigger: "triage-agent",
      input_payload: null,
      output_payload: null,
      success: false,
      error_message: errorMessage,
      duration_ms: Date.now() - startTime,
    });

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
