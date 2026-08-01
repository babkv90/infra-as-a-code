// Output attributes that grant live access to a resource (not just identify it) — these are the
// fields deployment.outputs entries route through Secrets Manager + the reveal broker instead of
// shipping in the deployment API response. Deliberately narrow and explicit rather than a regex over
// key names: a bare `endpoint` key also appears on eks (cluster API server address, paired with IAM
// auth rather than a bearer secret) and apigw (`api_endpoint`, already public by design) — treating
// every "endpoint"-shaped key as sensitive would have hidden those without reason. Keyed by serviceId,
// matched against the `service_id` field terraformGenerator.js stamps onto every output group.
export const SENSITIVE_OUTPUT_KEYS_BY_SERVICE = {
  ec2: ['ssh_private_key_pem'],
  rds: ['address', 'endpoint'],
  docdb: ['endpoint', 'reader_endpoint'],
  redshift: ['endpoint'],
  elasticache: ['cluster_address'],
};

// Fallback for output groups captured before terraformGenerator.js started stamping `service_id` in
// (a deployment whose Terraform state hasn't been re-applied since) — matches on the human-readable
// `service` display name (src/data/awsServices.ts's `name` argument) it always wrote instead.
const SERVICE_DISPLAY_NAME_TO_ID = {
  EC2: 'ec2',
  RDS: 'rds',
  'DocumentDB Cluster': 'docdb',
  ElastiCache: 'elasticache',
  Redshift: 'redshift',
};

export function resolveServiceId(outputGroup) {
  if (!outputGroup || typeof outputGroup !== 'object') return undefined;
  return outputGroup.service_id || SERVICE_DISPLAY_NAME_TO_ID[outputGroup.service] || undefined;
}

export function sensitiveKeysForServiceId(serviceId) {
  return SENSITIVE_OUTPUT_KEYS_BY_SERVICE[serviceId] ?? [];
}
