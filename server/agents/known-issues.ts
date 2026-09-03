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
  },
  {
    id: 'ocm_auth_failure',
    pattern:
      /(ocm|openshift cluster manager)[^\n]{0,200}?(401|403|unauthorized|forbidden)/i,
    category: 'auth_credentials',
    rootCause: 'OpenShift Cluster Manager authentication failure',
    defaultSeverity: 'infrastructure',
  },
  {
    id: 'capi_not_installed',
    pattern:
      /(capi|cluster[^\n]{0,80}?api)[^\n]{0,200}?(not found|does not exist|no[^\n]{0,80}?running)/i,
    category: 'capi_setup',
    rootCause: 'CAPI/CAPA controllers not installed or running',
    defaultSeverity: 'upstream_breakage',
  },
  {
    id: 'api_rate_limit',
    pattern:
      /^(?![\s\S]*(?:Pattern matched|Issue detected|Fix applied|Monitor|Remediation|RETRYING|retries left))[\s\S]*?(?:HTTP[^\n]{0,80}?429|rate.limit.exceed|throttl[^\n]{0,80}?request|too.many.requests[^\n]{0,80}?api)/i,
    category: 'aws_infrastructure',
    rootCause: 'API rate limiting encountered',
    defaultSeverity: 'infrastructure',
  },
  {
    id: 'resource_quota_exceeded',
    pattern: /(quota|limit)[^\n]{0,200}?exceed/i,
    category: 'aws_infrastructure',
    rootCause: 'Resource quota or limit exceeded',
    defaultSeverity: 'infrastructure',
  },
  {
    id: 'rosacontrolplane_stuck_deletion',
    pattern:
      /FAILED - RETRYING[^\n]{0,200}?(?:rosacontrolplane|ROSAControlPlane)[^\n]{0,200}?(?:delet|still exists)|FAILED - RETRYING[^\n]{0,200}?(?:delet)[^\n]{0,200}?(?:rosacontrolplane|ROSAControlPlane)/i,
    category: 'rosa_lifecycle',
    rootCause:
      'ROSAControlPlane stuck in deletion state due to finalizers or AWS resource cleanup',
    defaultSeverity: 'infrastructure',
  },
  {
    id: 'rosanetwork_stuck_deletion',
    pattern:
      /FAILED - RETRYING[^\n]{0,200}?(?:rosanetwork|ROSANetwork)[^\n]{0,200}?(?:delet|still exists)|FAILED - RETRYING[^\n]{0,200}?(?:delet)[^\n]{0,200}?(?:rosanetwork|ROSANetwork)/i,
    category: 'rosa_lifecycle',
    rootCause:
      'ROSANetwork stuck in deletion state due to finalizers or VPC dependencies',
    defaultSeverity: 'infrastructure',
  },
  {
    id: 'rosaroleconfig_stuck_deletion',
    pattern:
      /FAILED - RETRYING[^\n]{0,200}?(?:rosaroleconfig|ROSARoleConfig)[^\n]{0,200}?(?:delet|still exists)|FAILED - RETRYING[^\n]{0,200}?(?:delet)[^\n]{0,200}?(?:rosaroleconfig|ROSARoleConfig)/i,
    category: 'rosa_lifecycle',
    rootCause:
      'ROSARoleConfig stuck in deletion state due to finalizers or IAM cleanup',
    defaultSeverity: 'infrastructure',
  },
  {
    id: 'vpc_deletion_failure',
    pattern:
      /vpc[^\n]{0,200}?(has dependencies|cannot be deleted|delete[^\n]{0,80}?fail|DELETE_FAILED)/i,
    category: 'aws_infrastructure',
    rootCause: 'VPC deletion failure due to orphaned dependencies',
    defaultSeverity: 'infrastructure',
  },
  {
    id: 'networking_configuration_error',
    pattern:
      /(?:subnet|vpc)[^\n]{0,200}?(?:invalid|not found|does not exist|no route|unreachable)/i,
    category: 'aws_infrastructure',
    rootCause: 'Network configuration error',
    defaultSeverity: 'infrastructure',
  },
  {
    id: 'repeated_timeouts',
    pattern:
      /^(?![\s\S]*(?:Pattern matched|Issue detected|RETRYING))[\s\S]*?(?:timed?.out|timeout[^\n]{0,80}?(?:waiting|exceeded|expired))/i,
    category: 'infrastructure_timeout',
    rootCause: 'Operation timing out repeatedly',
    defaultSeverity: 'infrastructure',
  },
  {
    id: 'iam_permission_error',
    pattern:
      /(?:access denied|not authorized|AccessDenied|UnauthorizedAccess|iam.*(?:error|fail|denied))/i,
    category: 'aws_iam',
    rootCause: 'IAM permission or role error',
    defaultSeverity: 'infrastructure',
  },
];
