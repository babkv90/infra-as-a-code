import { Info, Plug, RefreshCw, Trash2, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { PageAlert } from '../../components/PageAlert';
import { connectAwsAccount, disconnectAwsAccount, getDeployerIdentity, syncAwsAccount, type AwsAccountRecord } from '../awsApi';
import { EmptyState, Panel } from '../components/DashPrimitives';
import { awsConnectionSteps } from '../dashboardData';
import { buildDeployRoleTrustPolicy, deployRolePermissionsPolicy } from '../deployRolePolicy';

export function ConnectAwsPage({ accounts, regions, onAwsChanged }: { accounts: AwsAccountRecord[]; regions: string[]; onAwsChanged: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [roleArn, setRoleArn] = useState('');
  const [externalId, setExternalId] = useState('');
  const [defaultRegion, setDefaultRegion] = useState(regions[0] ?? 'ap-south-1');
  const [isConnecting, setIsConnecting] = useState(false);
  const [deployerIdentity, setDeployerIdentity] = useState<{ arn: string; accountId: string }>();
  const [isLoadingIdentity, setIsLoadingIdentity] = useState(false);
  const [isRoleSetupOpen, setIsRoleSetupOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const trustPolicy = useMemo(
    () => (deployerIdentity ? JSON.stringify(buildDeployRoleTrustPolicy(deployerIdentity.arn, externalId || undefined), null, 2) : ''),
    [deployerIdentity, externalId],
  );
  const permissionsPolicy = useMemo(() => JSON.stringify(deployRolePermissionsPolicy, null, 2), []);

  useEffect(() => {
    if (!regions.includes(defaultRegion) && regions[0]) setDefaultRegion(regions[0]);
  }, [defaultRegion, regions]);

  useEffect(() => {
    let isMounted = true;
    setIsLoadingIdentity(true);
    getDeployerIdentity()
      .then((identity) => {
        if (isMounted) setDeployerIdentity(identity);
      })
      .catch((identityError: unknown) => {
        if (isMounted) setError(identityError instanceof Error ? identityError.message : 'Could not resolve infraflow AWS identity.');
      })
      .finally(() => {
        if (isMounted) setIsLoadingIdentity(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  function copyText(value: string, copiedMessage: string) {
    void navigator.clipboard?.writeText(value);
    setMessage(copiedMessage);
  }

  async function handleConnect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsConnecting(true);

    try {
      await connectAwsAccount({
        name,
        accountId,
        roleArn,
        externalId: externalId || undefined,
        defaultRegion,
      });
      setMessage('AWS account connected and synced successfully.');
      setName('');
      setAccountId('');
      setRoleArn('');
      setExternalId('');
      await onAwsChanged();
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'AWS connection failed');
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleSync(id: string) {
    setError('');
    setMessage('');
    setIsConnecting(true);
    try {
      await syncAwsAccount(id);
      setMessage('AWS account synced successfully.');
      await onAwsChanged();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'AWS sync failed');
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDisconnect(account: AwsAccountRecord) {
    const confirmed = window.confirm(`Disconnect ${account.name} from infraflow? Live AWS insights and sync will stop for this account.`);
    if (!confirmed) return;

    setError('');
    setMessage('');
    setIsConnecting(true);

    try {
      await disconnectAwsAccount(account._id);
      setMessage(`${account.name} disconnected successfully.`);
      await onAwsChanged();
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'AWS disconnect failed');
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <div className="dash-page">
      {message && <PageAlert message={message} onDismiss={() => setMessage('')} />}
      {error && <PageAlert message={error} tone="error" onDismiss={() => setError('')} />}
      <div className="dash-connect-layout">
        <Panel title="Connection steps" action="IAM setup">
          <div className="dash-connect-steps">
            {awsConnectionSteps.map((step, index) => {
              const Icon = step.icon;
              return (
                <div key={step.title}>
                  <span>{index + 1}</span>
                  <Icon size={19} />
                  <strong>{step.title}</strong>
                  <p>{step.description}</p>
                </div>
              );
            })}
          </div>
        </Panel>
        <Panel
          title="AWS role setup"
          action={
            deployerIdentity ? (
              <button className="dash-info-action" onClick={() => setIsRoleSetupOpen(true)} title="View AWS role setup details" type="button">
                <Info size={15} />
                Setup details
              </button>
            ) : (
              isLoadingIdentity ? 'Loading identity' : 'Missing backend credentials'
            )
          }
        >
          {deployerIdentity ? (
            <div className="dash-role-setup">
              <p>
                Create an IAM role in the AWS account you want to connect, then paste the role ARN into the form. Open setup details for the deployer ARN, trust policy, and permissions policy.
              </p>
              <button className="dash-role-setup-open" onClick={() => setIsRoleSetupOpen(true)} type="button">
                <Info size={16} />
                View AWS role setup data
              </button>
            </div>
          ) : (
            <EmptyState>
              Production backend must have INFRAFLOW_APP_AWS_ACCESS_KEY_ID, INFRAFLOW_APP_AWS_SECRET_ACCESS_KEY, and AWS_REGION set before AWS accounts can connect.
            </EmptyState>
          )}
        </Panel>
        <Panel title="Connect AWS account" action="AssumeRole">
          <p className="legal-inline-notice">
            By connecting your AWS account, you authorize infraflow to provision infrastructure on your behalf, per our{' '}
            <a href="/legal/terms" rel="noreferrer" target="_blank">
              Terms of Service
            </a>
            .
          </p>
          <form className="dash-role-form" onSubmit={handleConnect}>
            <label>
              Account name
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Production AWS" required />
            </label>
            <label>
              AWS Account ID
              <input value={accountId} onChange={(event) => setAccountId(event.target.value)} placeholder="123456789012" required />
            </label>
            <label>
              IAM Role ARN
              <input value={roleArn} onChange={(event) => setRoleArn(event.target.value)} placeholder="arn:aws:iam::123456789012:role/infraflowRole" required />
            </label>
            <label>
              External ID
              <input value={externalId} onChange={(event) => setExternalId(event.target.value)} placeholder="Optional but recommended" />
            </label>
            <label>
              Default region
              <select value={defaultRegion} onChange={(event) => setDefaultRegion(event.target.value)}>
                {regions.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </select>
            </label>
            <div className="dash-role-form-actions">
              <button className="dash-secondary-action" disabled={isConnecting}>
                <Plug size={16} />
                {isConnecting ? 'Connecting...' : 'Connect and sync'}
              </button>
            </div>
          </form>
        </Panel>
      </div>
      {deployerIdentity && isRoleSetupOpen && (
        <div className="dash-role-setup-modal-backdrop" role="presentation" onClick={() => setIsRoleSetupOpen(false)}>
          <section className="dash-role-setup-modal" role="dialog" aria-modal="true" aria-label="AWS role setup details" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span className="dash-eyebrow">IAM AssumeRole setup</span>
                <h2>AWS role setup data</h2>
                <p>Use these values in AWS IAM, then paste the created role ARN into the connection form.</p>
              </div>
              <button className="dash-icon-button" onClick={() => setIsRoleSetupOpen(false)} type="button" aria-label="Close AWS role setup details">
                <X size={17} />
              </button>
            </header>
            <div className="dash-role-setup-modal-body">
              <label className="dash-role-setup-field">
                <span>Infraflow deployer ARN</span>
                <div>
                  <input readOnly value={deployerIdentity.arn} />
                  <button className="dash-secondary-action" onClick={() => copyText(deployerIdentity.arn, 'Infraflow deployer ARN copied.')} type="button">
                    Copy
                  </button>
                </div>
              </label>
              <RolePolicyCard title="Trust policy" value={trustPolicy} onCopy={() => copyText(trustPolicy, 'Trust policy copied.')} />
              <RolePolicyCard title="Permissions policy" value={permissionsPolicy} onCopy={() => copyText(permissionsPolicy, 'Permissions policy copied.')} />
            </div>
          </section>
        </div>
      )}
      <Panel title="Connected accounts" action={`${accounts.length} accounts`}>
        <div className="dash-account-list">
          {accounts.length ? (
            accounts.map((account) => (
              <div className="dash-account-row" key={account._id}>
                <div>
                  <strong>{account.name}</strong>
                  <span>{account.accountId || 'Unknown account'} - {account.defaultRegion}</span>
                  {account.lastError && <small>{account.lastError}</small>}
                </div>
                <em className={`dash-account-status-pill dash-account-status-pill--${account.status}`}>{account.status}</em>
                <div className="dash-account-actions">
                  <button className="dash-secondary-action" disabled={isConnecting} onClick={() => void handleSync(account._id)}>
                    <RefreshCw size={15} />
                    Sync now
                  </button>
                  <button className="dash-secondary-action dash-danger-action" disabled={isConnecting} onClick={() => void handleDisconnect(account)}>
                    <Trash2 size={15} />
                    Disconnect
                  </button>
                </div>
              </div>
            ))
          ) : (
            <EmptyState>No AWS account connected yet.</EmptyState>
          )}
        </div>
      </Panel>
    </div>
  );
}

function RolePolicyCard({ title, value, onCopy }: { title: string; value: string; onCopy: () => void }) {
  return (
    <div className="dash-role-policy-card">
      <div>
        <strong>{title}</strong>
        <button className="dash-secondary-action" onClick={onCopy} type="button">
          Copy
        </button>
      </div>
      <pre>{value}</pre>
    </div>
  );
}
