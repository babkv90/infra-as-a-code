import { getSecretValue, putSecret } from '../services/secretsManagerService.js';
import { resolveServiceId, sensitiveKeysForServiceId } from './sensitiveOutputKeys.js';

// Called once, right after a fresh `deployment.outputs` is captured from Terraform (see
// terraformDeploymentRunner.js / githubTerraformRunner.js). Moves every sensitive attribute value
// into Secrets Manager and replaces it in place with a `{ __secretRef: true }` marker, recording the
// real reference in the returned secretRefs map. Mutates `rawOutputs` in place and also returns it,
// so a caller can use either the return value or the object it already held a reference to.
//
// Never throws: a field that fails to migrate (Secrets Manager disabled/unreachable) is simply left
// as its original raw value rather than failing the whole deploy or discarding a value that, for a
// generated EC2 key pair, only ever exists once. It just stays as exposed as it always was until the
// opt-in migration script (scripts/migrateSecretsToSecretsManager.js) or a later successful apply
// moves it — callers should surface `warnings` (e.g. as a deployment.logs entry) so that's visible.
export async function migrateSensitiveOutputsToSecretsManager(deployment, rawOutputs) {
  const outputs = rawOutputs && typeof rawOutputs === 'object' ? rawOutputs : {};
  const secretRefs = {};
  const warnings = [];

  for (const [resourceKey, group] of Object.entries(outputs)) {
    if (!group || typeof group !== 'object') continue;
    const serviceId = resolveServiceId(group);
    const sensitiveKeys = sensitiveKeysForServiceId(serviceId);
    if (!sensitiveKeys.length) continue;

    for (const fieldKey of sensitiveKeys) {
      const value = group[fieldKey];
      if (value === undefined || value === null || value === '' || typeof value === 'object') continue;

      try {
        const name = `infraflow/${deployment.workspace}/${deployment._id}/${resourceKey}/${fieldKey}`;
        const arn = await putSecret(name, String(value));
        group[fieldKey] = { __secretRef: true };
        secretRefs[resourceKey] = { ...(secretRefs[resourceKey] ?? {}), [fieldKey]: { arn } };
      } catch (error) {
        warnings.push(
          `Could not move ${resourceKey}.${fieldKey} into Secrets Manager: ${error.message ?? String(error)}. ` +
            'It is stored in the deployment record as before — rerun the secrets migration script once Secrets Manager is reachable.',
        );
      }
    }
  }

  return { outputs, secretRefs, warnings };
}

// Applied to deployment.outputs before it's sent to any client (every deployment JSON response in
// deploymentController.js) — defense in depth for deployments applied before this feature existed,
// or before Secrets Manager was reachable, whose sensitive fields may still be raw strings sitting in
// Mongo. Never mutates the source objects; returns a plain, redacted copy safe to res.json().
export function redactOutputsForResponse(outputs, secretRefs, revealBasePath) {
  const source = outputs && typeof outputs === 'object' ? outputs : {};
  const refs = secretRefs && typeof secretRefs === 'object' ? secretRefs : {};
  const result = {};

  for (const [resourceKey, group] of Object.entries(source)) {
    if (!group || typeof group !== 'object') {
      result[resourceKey] = group;
      continue;
    }

    const serviceId = resolveServiceId(group);
    const sensitiveKeys = sensitiveKeysForServiceId(serviceId);
    const nextGroup = { ...group };

    for (const fieldKey of sensitiveKeys) {
      const value = group[fieldKey];
      if (value === undefined || value === null || value === '') continue;

      if (value && typeof value === 'object' && value.__secretRef) {
        const hasRef = Boolean(refs?.[resourceKey]?.[fieldKey]?.arn);
        nextGroup[fieldKey] = {
          __secretPlaceholder: true,
          revealPath: hasRef ? `${revealBasePath}/output/${encodeURIComponent(resourceKey)}/${encodeURIComponent(fieldKey)}` : null,
        };
        continue;
      }

      if (typeof value === 'string') {
        // Legacy plaintext never migrated — still hide it from the payload, but there is no
        // secretRefs entry to reveal it through until the opt-in migration script runs.
        nextGroup[fieldKey] = { __secretPlaceholder: true, revealPath: null };
      }
    }

    result[resourceKey] = nextGroup;
  }

  return result;
}

// Resolves a single sensitive field's live value for the reveal broker endpoint. Returns undefined
// (never throws for "not found") when there is no secretRefs entry — the caller turns that into a
// 404. A Secrets Manager error (unreachable/disabled) propagates so the caller can return a clear
// 502 instead of a crash.
export async function getSensitiveOutputValue(deployment, resourceKey, fieldKey) {
  const ref = deployment.secretRefs?.[resourceKey]?.[fieldKey];
  if (!ref?.arn) return undefined;
  return getSecretValue(ref.arn);
}
