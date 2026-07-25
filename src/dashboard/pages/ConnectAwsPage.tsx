import { Plug, RefreshCw, Trash2 } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { connectAwsAccount, disconnectAwsAccount, syncAwsAccount, type AwsAccountRecord } from '../awsApi';
import { EmptyState, Panel } from '../components/DashPrimitives';
import { awsConnectionSteps } from '../dashboardData';

export function ConnectAwsPage({ accounts, regions, onAwsChanged }: { accounts: AwsAccountRecord[]; regions: string[]; onAwsChanged: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [roleArn, setRoleArn] = useState('');
  const [externalId, setExternalId] = useState('');
  const [defaultRegion, setDefaultRegion] = useState(regions[0] ?? 'ap-south-1');
  const [isConnecting, setIsConnecting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!regions.includes(defaultRegion) && regions[0]) setDefaultRegion(regions[0]);
  }, [defaultRegion, regions]);

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
        <Panel title="Connect AWS account" action="AssumeRole">
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
            {message && <div className="dash-form-success">{message}</div>}
            {error && <div className="dash-form-error">{error}</div>}
            <div className="dash-role-form-actions">
              <button className="dash-secondary-action" disabled={isConnecting}>
                <Plug size={16} />
                {isConnecting ? 'Connecting...' : 'Connect and sync'}
              </button>
            </div>
          </form>
        </Panel>
      </div>
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
