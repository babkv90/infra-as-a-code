export const requiredGithubScopes = Object.freeze(['repo', 'workflow']);

export const githubOAuthScope = requiredGithubScopes.join(' ');

export function normalizeGithubScopes(scopes = []) {
  const scopeValues = Array.isArray(scopes) ? scopes : [scopes];
  return Array.from(
    new Set(
      scopeValues
        .flatMap((scope) => String(scope ?? '').split(/[,\s]+/))
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ).sort();
}

export function missingGithubScopes(grantedScopes = [], requiredScopes = requiredGithubScopes) {
  const granted = new Set(normalizeGithubScopes(grantedScopes));
  return requiredScopes.filter((scope) => !granted.has(scope));
}

export function hasRequiredGithubScopes(grantedScopes = []) {
  return missingGithubScopes(grantedScopes).length === 0;
}

export function githubReconnectRequiredDetails(grantedScopes = []) {
  const granted = normalizeGithubScopes(grantedScopes);
  return {
    reconnectRequired: true,
    requiredScopes: [...requiredGithubScopes],
    grantedScopes: granted,
    missingScopes: missingGithubScopes(granted),
  };
}
