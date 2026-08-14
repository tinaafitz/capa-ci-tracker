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
      /CloudFormation stack DELETE_FAILED:.*|FAILED - RETRYING.*cloudformation.*deletion/i,
    category: 'aws_infrastructure',
    rootCause:
      'AWS CloudFormation stack deletion failure -- ROSA creates security groups outside CF that block VPC deletion',
    defaultSeverity: 'infrastructure',
  },
  {
    id: 'ocm_auth_failure',
    pattern:
      /.*(ocm|openshift cluster manager).*(401|403|unauthorized|forbidden).*/i,
    category: 'auth_credentials',
    rootCause: 'OpenShift Cluster Manager authentication failure',
    defaultSeverity: 'infrastructure',
  },
  {
    id: 'capi_not_installed',
    pattern:
      /.*(capi|cluster.*api).*(not found|does not exist|no.*running).*/i,
    category: 'capi_setup',
    rootCause: 'CAPI/CAPA controllers not installed or running',
    defaultSeverity: 'upstream_breakage',
  },
  {
    id: 'api_rate_limit',
    pattern:
      /^(?!.*(?:Pattern matched|Issue detected|Fix applied|Monitor|Remediation|RETRYING|retries left)).*(?:HTTP.*429|rate.limit.exceed|throttl.*request|too.many.requests.*api).*/i,
    category: 'aws_infrastructure',
    rootCause: 'API rate limiting encountered',
    defaultSeverity: 'infrastructure',
  },
  {
    id: 'resource_quota_exceeded',
    pattern: /.*(quota|limit).*exceed.*/i,
    category: 'aws_infrastructure',
    rootCause: 'Resource quota or limit exceeded',
    defaultSeverity: 'infrastructure',
  },
  {
    id: 'rosacontrolplane_stuck_deletion',
    pattern:
      /FAILED - RETRYING.*(?:rosacontrolplane|ROSAControlPlane).*(?:delet|still exists)|FAILED - RETRYING.*(?:delet).*(?:rosacontrolplane|ROSAControlPlane)/i,
    category: 'rosa_lifecycle',
    rootCause:
      'ROSAControlPlane stuck in deletion state due to finalizers or AWS resource cleanup',
    defaultSeverity: 'infrastructure',
  },
  {
    id: 'rosanetwork_stuck_deletion',
    pattern:
      /FAILED - RETRYING.*(?:rosanetwork|ROSANetwork).*(?:delet|still exists)|FAILED - RETRYING.*(?:delet).*(?:rosanetwork|ROSANetwork)/i,
    category: 'rosa_lifecycle',
    rootCause:
      'ROSANetwork stuck in deletion state due to finalizers or VPC dependencies',
    defaultSeverity: 'infrastructure',
  },
  {
    id: 'rosaroleconfig_stuck_deletion',
    pattern:
      /FAILED - RETRYING.*(?:rosaroleconfig|ROSARoleConfig).*(?:delet|still exists)|FAILED - RETRYING.*(?:delet).*(?:rosaroleconfig|ROSARoleConfig)/i,
    category: 'rosa_lifecycle',
    rootCause:
      'ROSARoleConfig stuck in deletion state due to finalizers or IAM cleanup',
    defaultSeverity: 'infrastructure',
  },
  {
    id: 'vpc_deletion_failure',
    pattern:
      /.*vpc.*(has dependencies|cannot be deleted|delete.*fail|DELETE_FAILED).*/i,
    category: 'aws_infrastructure',
    rootCause: 'VPC deletion failure due to orphaned dependencies',
    defaultSeverity: 'infrastructure',
  },
  {
    id: 'networking_configuration_error',
    pattern:
      /(?:subnet|vpc).*(?:invalid|not found|does not exist|no route|unreachable)/i,
    category: 'aws_infrastructure',
    rootCause: 'Network configuration error',
    defaultSeverity: 'infrastructure',
  },
  {
    id: 'repeated_timeouts',
    pattern:
      /^(?!.*(?:Pattern matched|Issue detected|RETRYING)).*(?:timed?.out|timeout.*(?:waiting|exceeded|expired)).*/i,
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
