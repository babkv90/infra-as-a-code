// Marker the backend substitutes for a sensitive deployment-output value (SSH private keys, DB
// endpoints/addresses — see the backend's sensitiveOutputKeys.js) instead of shipping the real value
// in listDeployments/getDeployment's response. `revealPath` is a ready-to-fetch relative API path for
// the broker endpoint; null means there is no Secrets Manager reference to reveal yet (a legacy
// deployment whose secrets haven't been migrated — see migrateSecretsToSecretsManager.js).
export type SecretPlaceholder = { __secretPlaceholder: true; revealPath: string | null };

export function isSecretPlaceholder(value: unknown): value is SecretPlaceholder {
  return Boolean(value) && typeof value === 'object' && (value as Record<string, unknown>).__secretPlaceholder === true;
}
