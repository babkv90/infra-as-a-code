// Opt-in, manual migration for deployments that captured sensitive Terraform outputs (SSH private
// keys, DB endpoints/addresses — see sensitiveOutputKeys.js) before Secrets Manager was wired in, or
// while SECRETS_MANAGER_ENABLED was off. New deployments migrate these automatically on every apply
// (see secretRedaction.js); this script backfills existing ones. NOT run automatically — invoke by
// hand:
//
//   node src/scripts/migrateSecretsToSecretsManager.js            # migrate every deployment
//   node src/scripts/migrateSecretsToSecretsManager.js --dry-run  # report only, no writes
//   node src/scripts/migrateSecretsToSecretsManager.js --deployment=<id>
//   node src/scripts/migrateSecretsToSecretsManager.js --rollback --deployment=<id>
//
// --rollback reads the value back OUT of Secrets Manager and writes it back into deployment.outputs
// as plaintext (does not delete the Secrets Manager entry) — an explicit, opt-in reversal, not a
// safety net; running it re-creates the exact exposure this migration exists to close.
import { connectDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { Deployment } from '../models/Deployment.js';
import { getSecretValue } from '../services/secretsManagerService.js';
import { migrateSensitiveOutputsToSecretsManager } from '../utils/secretRedaction.js';
import { resolveServiceId, sensitiveKeysForServiceId } from '../utils/sensitiveOutputKeys.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const rollback = args.includes('--rollback');
const deploymentIdArg = args.find((arg) => arg.startsWith('--deployment='))?.split('=')[1];

if (!env.SECRETS_MANAGER_ENABLED) {
  console.error('SECRETS_MANAGER_ENABLED is not set to true on this backend — nothing to migrate to/from. Set it first.');
  process.exit(1);
}

await connectDatabase();

const query = deploymentIdArg ? { _id: deploymentIdArg } : {};
const deployments = await Deployment.find(query);
console.log(`Found ${deployments.length} deployment(s) to check.`);

let migratedFields = 0;
let checkedDeployments = 0;

for (const deployment of deployments) {
  if (rollback) {
    migratedFields += await rollbackDeployment(deployment);
  } else {
    migratedFields += await migrateDeployment(deployment);
  }
  checkedDeployments += 1;
}

console.log(
  `${rollback ? 'Rolled back' : 'Migrated'} ${migratedFields} field(s) across ${checkedDeployments} deployment(s).${dryRun ? ' (dry run — nothing was written)' : ''}`,
);

await Deployment.db.close();

async function migrateDeployment(deployment) {
  const plaintextFields = findPlaintextSensitiveFields(deployment.outputs);
  if (!plaintextFields.length) return 0;

  console.log(`Deployment ${deployment._id} (${deployment.name}): ${plaintextFields.length} plaintext sensitive field(s).`);
  if (dryRun) {
    for (const field of plaintextFields) console.log(`  would migrate ${field.resourceKey}.${field.fieldKey}`);
    return plaintextFields.length;
  }

  const migrated = await migrateSensitiveOutputsToSecretsManager(deployment, deployment.outputs);
  deployment.outputs = migrated.outputs;
  deployment.secretRefs = { ...deployment.secretRefs, ...migrated.secretRefs };
  await deployment.save();

  for (const warning of migrated.warnings) console.warn(`  ${warning}`);
  const migratedCount = plaintextFields.length - migrated.warnings.length;
  console.log(`  migrated ${migratedCount}/${plaintextFields.length} field(s).`);
  return migratedCount;
}

async function rollbackDeployment(deployment) {
  const refs = deployment.secretRefs && typeof deployment.secretRefs === 'object' ? deployment.secretRefs : {};
  let count = 0;

  for (const [resourceKey, fields] of Object.entries(refs)) {
    for (const [fieldKey, ref] of Object.entries(fields ?? {})) {
      if (!ref?.arn) continue;
      console.log(`Deployment ${deployment._id}: rolling back ${resourceKey}.${fieldKey}`);
      if (dryRun) {
        count += 1;
        continue;
      }
      const value = await getSecretValue(ref.arn);
      if (deployment.outputs?.[resourceKey]) {
        deployment.outputs[resourceKey][fieldKey] = value;
      }
      count += 1;
    }
  }

  if (!dryRun && count > 0) {
    deployment.markModified('outputs');
    await deployment.save();
  }
  return count;
}

function findPlaintextSensitiveFields(outputs) {
  const found = [];
  for (const [resourceKey, group] of Object.entries(outputs ?? {})) {
    if (!group || typeof group !== 'object') continue;
    const serviceId = resolveServiceId(group);
    for (const fieldKey of sensitiveKeysForServiceId(serviceId)) {
      const value = group[fieldKey];
      if (typeof value === 'string' && value.trim()) found.push({ resourceKey, fieldKey });
    }
  }
  return found;
}
