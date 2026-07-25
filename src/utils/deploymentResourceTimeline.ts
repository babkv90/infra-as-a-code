import type { DeploymentRecord } from './deploymentApi';

export type ResourcePhase = 'pending' | 'refreshing' | 'creating' | 'created' | 'modifying' | 'modified' | 'destroying' | 'destroyed' | 'error';

export type ResourceProgress = {
  address: string;
  resourceType: string;
  resourceName: string;
  phase: ResourcePhase;
  elapsed?: string;
  awsId?: string;
  errorMessage?: string;
};

const RESOURCE_LINE = /^([a-zA-Z0-9_.\-]+\[[^\]]*\]|[a-zA-Z0-9_.\-]+):\s+(.+)$/;
const ELAPSED = /\[(\d+[ms]*s?\s*elapsed)\]/i;
const AWS_ID = /\[id=([^\]]+)\]/;
const DECLARED_RESOURCE = /^resource\s+"([a-zA-Z0-9_]+)"\s+"([a-zA-Z0-9_]+)"\s*\{/gm;
const ERROR_RESOURCE_HINT = /in resource "([a-zA-Z0-9_]+)" "([a-zA-Z0-9_]+)"/;
const ERROR_DELETE_HINT = /(?:deleting|creating|updating)\s+[A-Za-z ]+\s*\(([a-zA-Z0-9_.\-]+)\)/;

function splitAddress(address: string): { resourceType: string; resourceName: string } {
  const bare = address.replace(/\[[^\]]*\]$/, '');
  const dot = bare.indexOf('.');
  if (dot === -1) return { resourceType: bare, resourceName: '' };
  return { resourceType: bare.slice(0, dot), resourceName: bare.slice(dot + 1) };
}

// Walks a deployment's terraform HCL to seed every resource address that's ever going to appear —
// so the live monitor can show "3 of 7" and grey-out resources Terraform hasn't reached yet, instead
// of only ever showing resources after the fact.
export function declaredResourceAddresses(terraform: string): string[] {
  const addresses: string[] = [];
  for (const match of terraform.matchAll(DECLARED_RESOURCE)) {
    addresses.push(`${match[1]}.${match[2]}`);
  }
  return addresses;
}

// Turns a deployment's raw log stream (the same lines terraform apply/destroy prints, one per log
// entry — see terraformDeploymentRunner.js) into a per-resource timeline: what's pending, what's
// mid-flight, what finished, and — critically for troubleshooting — exactly which resource an error
// block belongs to, extracted from Terraform's own "on main.tf line N, in resource ..." diagnostic.
export function buildResourceTimeline(deployment: Pick<DeploymentRecord, 'terraform' | 'logs'>): ResourceProgress[] {
  const order: string[] = [];
  const byAddress = new Map<string, ResourceProgress>();

  function ensure(address: string): ResourceProgress {
    let entry = byAddress.get(address);
    if (!entry) {
      const { resourceType, resourceName } = splitAddress(address);
      entry = { address, resourceType, resourceName, phase: 'pending' };
      byAddress.set(address, entry);
      order.push(address);
    }
    return entry;
  }

  for (const declared of declaredResourceAddresses(deployment.terraform || '')) {
    ensure(declared);
  }

  for (const log of deployment.logs ?? []) {
    if (log.level === 'error') {
      const hint = log.message.match(ERROR_RESOURCE_HINT);
      const address = hint ? `${hint[1]}.${hint[2]}` : deleteHintAddress(log.message, order);
      const summary = log.message.split('\n').find((line) => line.trim().startsWith('Error:'))?.replace(/^Error:\s*/, '') ?? log.message.slice(0, 160);

      if (address) {
        const entry = ensure(address);
        entry.phase = 'error';
        entry.errorMessage = summary;
      } else {
        // Couldn't tie this error to one specific resource — still surface it, attached to whichever
        // resource is currently mid-flight (the most common real case: this error is why it stopped).
        const inFlight = order.map((addr) => byAddress.get(addr)!).find((r) => r.phase === 'creating' || r.phase === 'destroying' || r.phase === 'modifying');
        if (inFlight) {
          inFlight.phase = 'error';
          inFlight.errorMessage = summary;
        }
      }
      continue;
    }

    const match = log.message.match(RESOURCE_LINE);
    if (!match) continue;
    const [, address, rest] = match;
    // Guard against matching arbitrary "label: value" lines that aren't Terraform resource-action
    // output (e.g. a plain log message that happens to contain a colon) — only accept lines whose
    // right-hand side actually looks like one of Terraform's known progress verbs.
    if (!/^(Creating|Still creating|Creation complete|Modifying|Still modifying|Modifications complete|Destroying|Still destroying|Destruction complete|Refreshing state)\b/.test(rest)) {
      continue;
    }

    const entry = ensure(address);
    const elapsed = rest.match(ELAPSED)?.[1];
    const awsId = rest.match(AWS_ID)?.[1];
    if (elapsed) entry.elapsed = elapsed;
    if (awsId) entry.awsId = awsId;

    if (rest.startsWith('Refreshing state')) entry.phase = entry.phase === 'pending' ? 'refreshing' : entry.phase;
    else if (rest.startsWith('Creating')) entry.phase = 'creating';
    else if (rest.startsWith('Creation complete')) entry.phase = 'created';
    else if (rest.startsWith('Modifying')) entry.phase = 'modifying';
    else if (rest.startsWith('Modifications complete')) entry.phase = 'modified';
    else if (rest.startsWith('Destroying')) entry.phase = 'destroying';
    else if (rest.startsWith('Destruction complete')) entry.phase = 'destroyed';
  }

  return order.map((address) => byAddress.get(address)!);
}

function deleteHintAddress(message: string, knownOrder: string[]): string | undefined {
  const hint = message.match(ERROR_DELETE_HINT)?.[1];
  if (!hint) return undefined;
  // The delete/create hint gives a human name or id, not a resource address — fall back to matching
  // it against addresses we already know about (e.g. "infraflow-iaasnode-execution-role-..." often
  // contains the resource's own name fragment).
  return knownOrder.find((address) => hint.includes(address.split('.')[1]));
}
