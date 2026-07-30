import { mkdir, rm, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { env } from '../config/env.js';
import { storage } from '../storage/index.js';
import { getPluginCacheDir, runProcess, stageLambdaZipUploads } from './terraformDeploymentRunner.js';

// Layer 2 of the deployment validation pipeline: after JSON -> Terraform generation, actually run
// `terraform validate` against the generated HCL. The structural checks in terraformValidator.js
// (brace balance, duplicate resource addresses) can't catch type mismatches, invalid argument
// combinations, or invalid enum values — this is the only layer that asks the real Terraform
// provider schema whether the generated config is valid, independent of what AWS itself would say
// at apply time (that's Layer 3's job, in terraformDeploymentRunner.js).
//
// Runs in a disposable scratch directory, never a deployment's real work directory — this can run
// for a diagram that has no Deployment record yet (or ever will). No AWS credentials or backend are
// needed: `terraform validate` only checks configuration against provider schemas, it never talks to
// AWS or reads/writes state.
export async function validateTerraformWithCli(terraform, lambdaZipUploadIds = []) {
  const scratchDir = await storage.getWorkingDirectory(`validate-${crypto.randomUUID()}`);

  try {
    await mkdir(scratchDir, { recursive: true });
    await writeFile(path.join(scratchDir, 'main.tf'), terraform, 'utf8');

    // A Lambda's source_code_hash = filebase64sha256("<uploadId>.zip") is a literal function call,
    // so `terraform validate` evaluates it immediately and needs the actual file on disk — without
    // staging it here the same way a real deploy does, every diagram with an uploaded Lambda zip
    // would fail validation with a false "file not found", even when the zip is genuinely fine.
    await stageLambdaZipUploads(lambdaZipUploadIds, scratchDir);

    const terraformEnv = {
      ...process.env,
      TF_IN_AUTOMATION: 'true',
      TF_PLUGIN_CACHE_DIR: await getPluginCacheDir(),
    };

    // -backend=false: this is a syntax/schema check, not a real run — no state or backend needed,
    // and skipping it keeps this fast (no backend handshake) and safe (nothing it could touch).
    await runProcess(env.TERRAFORM_BIN, ['init', '-input=false', '-backend=false'], scratchDir, terraformEnv);

    // terraform validate exits non-zero when the config is invalid, but still writes the JSON
    // diagnostics to stdout — runProcess captures that combined output into the rejection's message,
    // so the .catch here recovers it exactly the same way a clean pass would resolve it.
    const output = await runProcess(env.TERRAFORM_BIN, ['validate', '-json'], scratchDir, terraformEnv).catch((error) => error.message);
    const parsed = JSON.parse(output || '{}');

    if (parsed.valid === true) return [];
    return terraformValidateDiagnosticsToIssues(parsed.diagnostics);
  } catch (error) {
    // Fail closed: if we can't even determine whether the config is valid (terraform binary
    // missing, init failed, unparseable output), block the deployment rather than let it through on
    // the assumption that "no confirmed error" means "safe."
    return [
      {
        severity: 'error',
        message: `Automated Terraform validation could not run, so this deployment cannot be confirmed safe: ${error.message ?? String(error)}`,
      },
    ];
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}

// Shared with terraformValidateCallbackController.js, which receives this same `terraform validate
// -json` diagnostics array from terraform-validate.yml (the Lambda executor's async equivalent of
// this file's inline CLI call) — one implementation of "diagnostic -> blocking issue" so the two
// paths can never format this differently.
export function terraformValidateDiagnosticsToIssues(diagnostics) {
  const list = Array.isArray(diagnostics) ? diagnostics : [];
  if (!list.length) {
    return [{ severity: 'error', message: 'terraform validate reported the generated configuration as invalid but returned no diagnostic detail.' }];
  }

  return list
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => {
      const line = diagnostic.range?.start?.line;
      const summary = diagnostic.summary ?? 'Invalid Terraform configuration.';
      const detail = diagnostic.detail ? ` — ${diagnostic.detail}` : '';
      return { severity: 'error', message: `terraform validate: ${summary}${detail}${line ? ` (line ${line})` : ''}` };
    });
}
