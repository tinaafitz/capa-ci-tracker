/**
 * Known issue patterns for CI failure diagnosis.
 *
 * Extracted from supabase/functions/diagnosis/index.ts.
 * Each pattern matches a specific class of CI failure and maps it
 * to a root cause category and default severity.
 */

export interface KnownIssue {
  id: string;
  pattern: RegExp;
  category: string;
  rootCause: string;
  defaultSeverity: string;
  sopUrl?: string;
  /**
   * Optional label to add to the ticket's `labels` JSON array when this pattern
   * matches. Merged in without clobbering existing labels.
   */
  label?: string;
  /**
   * Short human phrase naming the failure, used to retitle the ticket when this
   * pattern matches.
   *
   * Triage has to title a ticket before anything has been diagnosed, so it uses
   * the first failing test's name. That is right for a product test failure but
   * wrong for an environment problem: when a dead hub or a stuck teardown takes
   * the whole run down, the first failing test is arbitrary and the title ends
   * up blaming code that never ran. Patterns that describe an environment-level
   * cause set this so the ticket is named after the actual problem.
   *
   * Omit it for patterns where the failing test IS the story.
   */
  shortTitle?: string;
}

export const KNOWN_ISSUES: KnownIssue[] = [
  {
    id: 'cloudformation_deletion_failure',
    pattern:
      /CloudFormation stack DELETE_FAILED:|FAILED - RETRYING[^\n]{0,200}?cloudformation[^\n]{0,200}?deletion/i,
    category: 'aws_infrastructure',
    rootCause:
      'AWS CloudFormation stack deletion failure -- ROSA creates security groups outside CF that block VPC deletion',
    defaultSeverity: 'infrastructure',
    shortTitle: 'CloudFormation stack deletion failed',
  },
  {
    // The suite could not log in to the MCE hub cluster, so it never reached
    // CAPA at all -- every "test failure" in the run is downstream of this one
    // environment problem. Placed near the top so the distinctive login banner
    // wins over the broader iam_permission_error / repeated_timeouts patterns,
    // which would otherwise claim it and mislabel a dead hub as a CAPA defect.
    // Literal alternation only (no nested quantifiers) -- these run over
    // multi-megabyte console output.
    id: 'hub_login_failure',
    pattern:
      /OPENSHIFT LOGIN FAILED|Failed to login to OpenShift Hub cluster|Check for authentication failure \(401 Unauthorized\)/i,
    category: 'hub_environment',
    rootCause:
      'Could not log in to the MCE hub cluster -- the hub API rejected or failed the login, so the suite never reached CAPA. Hub environment problem, not a CAPA/5.0 product defect.',
    defaultSeverity: 'infrastructure',
    shortTitle: 'Hub login failed',
    label: 'hub-unavailable',
  },
  {
    id: 'ocm_auth_failure',
    pattern:
      /(ocm|openshift cluster manager)[^\n]{0,200}?(401|403|unauthorized|forbidden)/i,
    category: 'auth_credentials',
    rootCause: 'OpenShift Cluster Manager authentication failure',
    defaultSeverity: 'infrastructure',
    shortTitle: 'OCM authentication failed',
  },
  {
    // Test-environment config gap: a feature was requested and the CRD accepts
    // it, but the feature's cloud/env plumbing (e.g. CloudWatch log-forwarding
    // destinations, IAM role, log group) was never provisioned for this run.
    // This is NOT a 5.0/CAPA product defect -- it is a wiring gap in the test
    // harness. Placed before capi_not_installed / resource_quota / iam so the
    // distinctive phrasing wins over the broader infra patterns.
    id: 'feature_env_not_wired',
    pattern:
      /requested[^\n]{0,80}?CRD supports it[^\n]{0,120}?(not found|not configured)|log forwarding destinations not found/i,
    category: 'test_config_gap',
    rootCause:
      'Requested feature was accepted by the CRD, but its AWS/env plumbing was not provisioned for this run (e.g. CloudWatch log-forwarding destinations, IAM role, or log group not wired). Test-environment config gap, not a CAPA/5.0 product defect.',
    defaultSeverity: 'infrastructure',
    shortTitle: 'Requested feature not wired in test env',
    label: 'test-config-gap',
  },
  {
    id: 'capi_not_installed',
    pattern:
      /(capi|cluster[^\n]{0,80}?api)[^\n]{0,200}?(not found|does not exist|no[^\n]{0,80}?running)/i,
    category: 'capi_setup',
    rootCause: 'CAPI/CAPA controllers not installed or running',
    defaultSeverity: 'upstream_breakage',
    shortTitle: 'CAPI/CAPA controllers not running',
  },
  {
    id: 'api_rate_limit',
    pattern:
      /^(?![\s\S]*(?:Pattern matched|Issue detected|Fix applied|Monitor|Remediation|RETRYING|retries left))[\s\S]*?(?:HTTP[^\n]{0,80}?429|rate.limit.exceed|throttl[^\n]{0,80}?request|too.many.requests[^\n]{0,80}?api)/i,
    category: 'aws_infrastructure',
    rootCause: 'API rate limiting encountered',
    defaultSeverity: 'infrastructure',
    shortTitle: 'API rate limited',
  },
  {
    id: 'resource_quota_exceeded',
    pattern: /(quota|limit)[^\n]{0,200}?exceed/i,
    category: 'aws_infrastructure',
    rootCause: 'Resource quota or limit exceeded',
    defaultSeverity: 'infrastructure',
    shortTitle: 'Resource quota exceeded',
  },
  {
    id: 'rosacontrolplane_stuck_deletion',
    pattern:
      /FAILED - RETRYING[^\n]{0,200}?(?:rosacontrolplane|ROSAControlPlane)[^\n]{0,200}?(?:delet|still exists)|FAILED - RETRYING[^\n]{0,200}?(?:delet)[^\n]{0,200}?(?:rosacontrolplane|ROSAControlPlane)/i,
    category: 'rosa_lifecycle',
    rootCause:
      'ROSAControlPlane stuck in deletion state due to finalizers or AWS resource cleanup',
    defaultSeverity: 'infrastructure',
    shortTitle: 'ROSAControlPlane stuck deleting',
  },
  {
    id: 'rosanetwork_stuck_deletion',
    pattern:
      /FAILED - RETRYING[^\n]{0,200}?(?:rosanetwork|ROSANetwork)[^\n]{0,200}?(?:delet|still exists)|FAILED - RETRYING[^\n]{0,200}?(?:delet)[^\n]{0,200}?(?:rosanetwork|ROSANetwork)/i,
    category: 'rosa_lifecycle',
    rootCause:
      'ROSANetwork stuck in deletion state due to finalizers or VPC dependencies',
    defaultSeverity: 'infrastructure',
    shortTitle: 'ROSANetwork stuck deleting',
  },
  {
    id: 'rosaroleconfig_stuck_deletion',
    pattern:
      /FAILED - RETRYING[^\n]{0,200}?(?:rosaroleconfig|ROSARoleConfig)[^\n]{0,200}?(?:delet|still exists)|FAILED - RETRYING[^\n]{0,200}?(?:delet)[^\n]{0,200}?(?:rosaroleconfig|ROSARoleConfig)/i,
    category: 'rosa_lifecycle',
    rootCause:
      'ROSARoleConfig stuck in deletion state due to finalizers or IAM cleanup',
    defaultSeverity: 'infrastructure',
    shortTitle: 'ROSARoleConfig stuck deleting',
  },
  {
    id: 'vpc_deletion_failure',
    pattern:
      /vpc[^\n]{0,200}?(has dependencies|cannot be deleted|delete[^\n]{0,80}?fail|DELETE_FAILED)/i,
    category: 'aws_infrastructure',
    rootCause: 'VPC deletion failure due to orphaned dependencies',
    defaultSeverity: 'infrastructure',
    shortTitle: 'VPC deletion failed',
  },
  {
    id: 'networking_configuration_error',
    pattern:
      /(?:subnet|vpc)[^\n]{0,200}?(?:invalid|not found|does not exist|no route|unreachable)/i,
    category: 'aws_infrastructure',
    rootCause: 'Network configuration error',
    defaultSeverity: 'infrastructure',
    shortTitle: 'Network configuration error',
  },
  {
    id: 'repeated_timeouts',
    pattern:
      /^(?![\s\S]*(?:Pattern matched|Issue detected|RETRYING))[\s\S]*?(?:timed?.out|timeout[^\n]{0,80}?(?:waiting|exceeded|expired))/i,
    category: 'infrastructure_timeout',
    rootCause: 'Operation timing out repeatedly',
    defaultSeverity: 'infrastructure',
    shortTitle: 'Operation timed out repeatedly',
  },
  {
    id: 'iam_permission_error',
    pattern:
      /(?:access denied|not authorized|AccessDenied|UnauthorizedAccess|iam.*(?:error|fail|denied))/i,
    category: 'aws_iam',
    rootCause: 'IAM permission or role error',
    defaultSeverity: 'infrastructure',
    shortTitle: 'IAM permission denied',
  },
];
