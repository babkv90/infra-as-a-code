import { BadgeDollarSign, BrainCircuit, GitCommitVertical, ListChecks, RefreshCw, Rocket, Search, UserCheck, Users, Workflow } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getStoredUser } from '../../auth/authClient';
import { PageAlert } from '../../components/PageAlert';
import { BacklogTab } from '../components/BacklogTab';
import { ChangeLogTab } from '../components/ChangeLogTab';
import { EmptyState, Panel, TableSkeleton } from '../components/DashPrimitives';
import { getSuperAdminOverview, grantSuperAdminCredits, updateSuperAdminUserRole, type SuperAdminOverview, type SuperAdminUser } from '../superAdminApi';

const ADMIN_ROLE_OPTIONS = ['viewer', 'devops', 'architect', 'admin', 'owner', 'superadmin'];
const ADMIN_STATUS_OPTIONS = ['active', 'invited', 'disabled'];

type AdminTab = 'users' | 'changelog' | 'backlog';
const ADMIN_TABS: Array<{ id: AdminTab; label: string; icon: typeof Users }> = [
  { id: 'users', label: 'Users & Access', icon: Users },
  { id: 'changelog', label: 'Change Log', icon: GitCommitVertical },
  { id: 'backlog', label: 'Technical Backlog', icon: ListChecks },
];

export function SuperAdminPage() {
  const user = getStoredUser();
  const [overview, setOverview] = useState<SuperAdminOverview>();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [credits, setCredits] = useState('5');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activeTab, setActiveTab] = useState<AdminTab>('users');

  const users = overview?.users ?? [];
  const selectedUser = users.find((candidate) => candidate.id === selectedUserId) ?? users[0];

  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return users.filter((candidate) => {
      if (roleFilter !== 'all' && candidate.role !== roleFilter) return false;
      if (statusFilter !== 'all' && candidate.status !== statusFilter) return false;
      if (term && !`${candidate.name} ${candidate.email}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [users, searchTerm, roleFilter, statusFilter]);

  const kpis = useMemo(
    () => ({
      totalUsers: overview?.totals.users ?? 0,
      activeUsers: users.filter((candidate) => candidate.status === 'active').length,
      diagrams: overview?.totals.diagrams ?? 0,
      deployments: overview?.totals.deployments ?? 0,
      pendingCredits: overview?.totals.pendingCreditRequests ?? 0,
      aiEnabled: users.filter((candidate) => candidate.aiEnabled).length,
    }),
    [overview, users],
  );

  async function refreshOverview() {
    if (user?.role !== 'superadmin') return;
    setIsLoading(true);
    try {
      const data = await getSuperAdminOverview();
      setOverview(data);
      setSelectedUserId((current) => current || data.users[0]?.id || '');
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load super admin overview.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refreshOverview();
  }, []);

  if (user?.role !== 'superadmin') {
    return (
      <div className="dash-page">
        <Panel title="Super Admin" action="Restricted">
          <EmptyState>Only super admins can manage all users, credits, roles, and platform activity.</EmptyState>
        </Panel>
      </div>
    );
  }

  async function changeRole(target: SuperAdminUser, role: string) {
    setMessage('');
    setError('');
    try {
      await updateSuperAdminUserRole(target.id, role);
      await refreshOverview();
      setMessage(`${target.email} role changed to ${role}.`);
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : 'Unable to update role.');
    }
  }

  async function grantCredits(target: SuperAdminUser) {
    const parsedCredits = Number(credits);
    if (!Number.isInteger(parsedCredits) || parsedCredits < 0) {
      setError('Credits must be a non-negative whole number.');
      return;
    }

    setMessage('');
    setError('');
    try {
      await grantSuperAdminCredits(target.id, parsedCredits, note.trim() || undefined);
      await refreshOverview();
      setNote('');
      setMessage(`${target.email} now has ${parsedCredits} demo credits.`);
    } catch (creditError) {
      setError(creditError instanceof Error ? creditError.message : 'Unable to grant credits.');
    }
  }

  return (
    <div className="dash-page dash-page--admin">
      {message && <PageAlert message={message} onDismiss={() => setMessage('')} />}
      {error && <PageAlert message={error} tone="error" onDismiss={() => setError('')} />}
      <div className="dash-page-head-group">
        <header className="pipeline-console-header">
          <div>
            <span className="dash-eyebrow">Platform control</span>
            <h2>Super Admin</h2>
          </div>
          <div className="pipeline-header-badges">
            <span className="pipeline-badge">{kpis.totalUsers} users</span>
            {kpis.pendingCredits > 0 && <span className="pipeline-badge pipeline-badge--warning">{kpis.pendingCredits} credit requests</span>}
            <button className="pipeline-icon-action" disabled={isLoading} onClick={() => void refreshOverview()} title="Refresh" type="button">
              <RefreshCw size={15} />
            </button>
          </div>
        </header>
      </div>

      <nav className="admin-tab-bar" role="tablist">
        {ADMIN_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              className={`admin-tab ${activeTab === tab.id ? 'admin-tab--active' : ''}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              aria-selected={activeTab === tab.id}
              type="button"
            >
              <Icon size={15} />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {activeTab === 'changelog' && <ChangeLogTab />}
      {activeTab === 'backlog' && <BacklogTab />}

      {activeTab === 'users' && (
      <>
      <section className="admin-kpi-strip">
        <div className="admin-kpi-card">
          <span className="admin-kpi-icon">
            <Users size={16} />
          </span>
          <div>
            <span>Total users</span>
            <strong>{kpis.totalUsers}</strong>
          </div>
        </div>
        <div className="admin-kpi-card">
          <span className="admin-kpi-icon admin-kpi-icon--success">
            <UserCheck size={16} />
          </span>
          <div>
            <span>Active users</span>
            <strong>{kpis.activeUsers}</strong>
          </div>
        </div>
        <div className="admin-kpi-card">
          <span className="admin-kpi-icon">
            <Workflow size={16} />
          </span>
          <div>
            <span>Diagrams created</span>
            <strong>{kpis.diagrams}</strong>
          </div>
        </div>
        <div className="admin-kpi-card">
          <span className="admin-kpi-icon">
            <Rocket size={16} />
          </span>
          <div>
            <span>Deployments run</span>
            <strong>{kpis.deployments}</strong>
          </div>
        </div>
        <div className="admin-kpi-card">
          <span className="admin-kpi-icon admin-kpi-icon--warning">
            <BadgeDollarSign size={16} />
          </span>
          <div>
            <span>Pending credit requests</span>
            <strong>{kpis.pendingCredits}</strong>
          </div>
        </div>
        <div className="admin-kpi-card">
          <span className="admin-kpi-icon admin-kpi-icon--accent">
            <BrainCircuit size={16} />
          </span>
          <div>
            <span>AI-enabled users</span>
            <strong>{kpis.aiEnabled}</strong>
          </div>
        </div>
      </section>

      <div className="admin-console-grid">
        <section className="admin-users-panel">
          <header>
            <div className="admin-users-panel-title">
              <strong>All users and access</strong>
              <span>
                {filteredUsers.length} of {users.length} shown
              </span>
            </div>
            <div className="admin-users-filters">
              <label className="admin-search">
                <Search size={14} />
                <input onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search name or email" value={searchTerm} />
              </label>
              <select onChange={(event) => setRoleFilter(event.target.value)} value={roleFilter}>
                <option value="all">All roles</option>
                {ADMIN_ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              <select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
                <option value="all">All status</option>
                {ADMIN_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
          </header>
          <div className="admin-table-wrap">
            {isLoading && !overview ? (
              <TableSkeleton columnWidths={[2, 1, 1, 1, 1, 1, 1, 1]} />
            ) : (
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Workspace</th>
                  <th>Credits</th>
                  <th>Activity</th>
                  <th>Access</th>
                  <th>Last active</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((candidate) => (
                  <tr className={selectedUser?.id === candidate.id ? 'active' : ''} key={candidate.id} onClick={() => setSelectedUserId(candidate.id)}>
                    <td>
                      <strong>{candidate.name}</strong>
                      <span>{candidate.email}</span>
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <select onChange={(event) => void changeRole(candidate, event.target.value)} value={candidate.role}>
                        {ADMIN_ROLE_OPTIONS.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span className={`admin-status-pill admin-status-pill--${candidate.status}`}>{candidate.status}</span>
                    </td>
                    <td>
                      <strong>{candidate.workspace?.plan ?? 'free'}</strong>
                      <span>{candidate.workspace?.name ?? 'No workspace'}</span>
                    </td>
                    <td>
                      <strong>{candidate.demoCredits} credits</strong>
                      {candidate.creditRequest?.status === 'pending' ? (
                        <span className="admin-pending-tag">{candidate.creditRequest.requestedCredits} requested</span>
                      ) : (
                        <span>{candidate.creditRequest?.status ?? 'none'}</span>
                      )}
                    </td>
                    <td>
                      <strong>{candidate.diagramsCreated} diagrams</strong>
                      <span>
                        {candidate.deploymentsCreated} deployed, {candidate.successfulDeployments} live
                      </span>
                    </td>
                    <td>
                      <strong>{candidate.accessTier}</strong>
                      <span>
                        {candidate.allowedServices} services{candidate.aiEnabled ? ', AI' : ''}
                      </span>
                    </td>
                    <td>
                      <span>{formatAdminDate(candidate.lastActivityAt ?? candidate.lastLoginAt)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
            {!isLoading && !filteredUsers.length && <EmptyState>No users match these filters.</EmptyState>}
          </div>
        </section>

        <aside className="admin-side-col">
          <section className="admin-detail-panel">
            {selectedUser ? (
              <>
                <header className="admin-detail-header">
                  <div>
                    <strong>{selectedUser.name}</strong>
                    <span>{selectedUser.email}</span>
                  </div>
                  <div className="admin-detail-header-pills">
                    <span className={`admin-status-pill admin-status-pill--${selectedUser.status}`}>{selectedUser.status}</span>
                    <span className="admin-role-pill">{selectedUser.role}</span>
                  </div>
                </header>

                <div className="admin-meta-grid">
                  <div>
                    <span>Workspace</span>
                    <strong>{selectedUser.workspace?.name ?? 'No workspace'}</strong>
                  </div>
                  <div>
                    <span>Plan</span>
                    <strong>{selectedUser.workspace?.plan ?? 'free'}</strong>
                  </div>
                  <div>
                    <span>Access tier</span>
                    <strong>{selectedUser.accessTier}</strong>
                  </div>
                  <div>
                    <span>Services / AI</span>
                    <strong>
                      {selectedUser.allowedServices} services{selectedUser.aiEnabled ? ', AI on' : ', AI off'}
                    </strong>
                  </div>
                  <div>
                    <span>Joined</span>
                    <strong>{formatAdminDate(selectedUser.createdAt)}</strong>
                  </div>
                  <div>
                    <span>Last login</span>
                    <strong>{formatAdminDate(selectedUser.lastLoginAt)}</strong>
                  </div>
                  <div>
                    <span>Diagrams / deployments</span>
                    <strong>
                      {selectedUser.diagramsCreated} / {selectedUser.deploymentsCreated}
                    </strong>
                  </div>
                  <div>
                    <span>Last action</span>
                    <strong>{selectedUser.lastAction ?? 'No recent action'}</strong>
                  </div>
                </div>

                <div className={`admin-credit-card admin-credit-card--${selectedUser.creditRequest?.status ?? 'none'}`}>
                  <header>
                    <strong>Credit request</strong>
                    <span>{selectedUser.creditRequest?.status ?? 'none'}</span>
                  </header>
                  <p>{selectedUser.creditRequest?.reason || 'No request reason submitted.'}</p>
                  {selectedUser.creditRequest?.note && <p className="admin-credit-note">Admin note: {selectedUser.creditRequest.note}</p>}
                  <div className="admin-credit-dates">
                    {selectedUser.creditRequest?.requestedAt && <span>Requested {formatAdminDate(selectedUser.creditRequest.requestedAt)}</span>}
                    {selectedUser.creditRequest?.reviewedAt && <span>Reviewed {formatAdminDate(selectedUser.creditRequest.reviewedAt)}</span>}
                  </div>
                </div>

                <div className="admin-form-row">
                  <label className="pipeline-field">
                    <span>Demo credits</span>
                    <input min={0} onChange={(event) => setCredits(event.target.value)} type="number" value={credits} />
                  </label>
                  <label className="pipeline-field pipeline-field--wide">
                    <span>Admin note</span>
                    <textarea onChange={(event) => setNote(event.target.value)} placeholder="Optional note for this credit grant" rows={2} value={note} />
                  </label>
                </div>
                <button className="pipeline-primary-compact admin-grant-button" onClick={() => void grantCredits(selectedUser)} type="button">
                  Grant credits
                </button>
              </>
            ) : (
              <EmptyState>Select a user to manage role and demo credits.</EmptyState>
            )}
          </section>

          <section className="admin-activity-panel">
            <header>
              <strong>Recent activity</strong>
              <span>Audit log</span>
            </header>
            <div className="admin-activity-list">
              {overview?.recentActivities.length ? (
                overview.recentActivities.map((activity) => (
                  <div className="admin-activity-item" key={activity.id}>
                    <div>
                      <strong>{activity.actor?.email ?? 'System'}</strong>
                      <span>
                        {activity.action} on {activity.resourceType}
                      </span>
                    </div>
                    <em>{activity.createdAt ? formatAdminDate(activity.createdAt) : 'Recent'}</em>
                  </div>
                ))
              ) : (
                <EmptyState>No user activity found.</EmptyState>
              )}
            </div>
          </section>
        </aside>
      </div>
      </>
      )}
    </div>
  );
}

function formatAdminDate(value?: string) {
  return value ? new Date(value).toLocaleString() : 'Never';
}
