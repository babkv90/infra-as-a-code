import { dashboardNavItems, type DashboardPage } from '../dashboardData';

const descriptions: Partial<Record<DashboardPage, string>> = {
  terraform: 'Review the infrastructure code behind your architecture.',
  deployments: 'Track infrastructure changes, inspect runs, and manage deployed stacks.',
  'resource-info': 'Explore deployed resources, configuration, and connections.',
  'infra-pipeline': 'Manage delivery workflows for your infrastructure.',
  'app-pipeline': 'Connect your source code and configure how your application ships.',
  security: 'Review account findings and understand what needs attention.',
  'connect-aws': 'Connect your AWS account and manage its access to this workspace.',
  support: 'Get help, share feedback, and follow your support conversations.',
  'ai-agent': 'Ask questions about your architecture and review suggested changes.',
};

export function StudioPageHeading({ page }: { page: DashboardPage }) {
  const item = dashboardNavItems.find(item => item.id === page);
  if (!item || !descriptions[page]) return null;
  const Icon = item.icon;
  return <header className="studio-page-heading"><span className="studio-page-heading-icon" aria-hidden="true"><Icon size={17} /></span><div><h2>{item.label}</h2><p>{descriptions[page]}</p></div></header>;
}
