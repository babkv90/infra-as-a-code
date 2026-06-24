import {
  Activity,
  AlertTriangle,
  BadgeDollarSign,
  BrainCircuit,
  CheckCircle2,
  CloudCog,
  Code2,
  Cpu,
  Database,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  LineChart,
  LockKeyhole,
  Network,
  Rocket,
  SearchCheck,
  Server,
  Settings,
  ShieldCheck,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';

// Change dashboard navigation items here.
export type DashboardPage =
  | 'overview'
  | 'builder'
  | 'terraform'
  | 'ai-agent'
  | 'aws-insights'
  | 'deployments'
  | 'security'
  | 'cost'
  | 'runtime-lab'
  | 'connect-aws';

export type DashboardNavItem = {
  id: DashboardPage;
  label: string;
  icon: LucideIcon;
  badge?: string;
};

export const dashboardNavItems: DashboardNavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'builder', label: 'Visual Builder', icon: Workflow },
  { id: 'terraform', label: 'Terraform Export', icon: Code2 },
  { id: 'ai-agent', label: 'AI Cloud Agent', icon: BrainCircuit, badge: 'AI' },
  { id: 'aws-insights', label: 'AWS Insights', icon: LineChart },
  { id: 'deployments', label: 'Deployments', icon: Rocket },
  { id: 'security', label: 'Security Review', icon: ShieldCheck },
  { id: 'cost', label: 'Cost Optimizer', icon: BadgeDollarSign },
  { id: 'runtime-lab', label: 'Runtime Lab', icon: Cpu, badge: 'Node' },
  { id: 'connect-aws', label: 'Connect AWS', icon: CloudCog },
];

// Change dashboard KPI dummy data here.
export const dashboardKpis = [
  { label: 'Monthly spend', value: '$0.00', change: 'No live sync', icon: BadgeDollarSign, tone: 'cyan' },
  { label: 'Active resources', value: '0', change: 'No live sync', icon: Server, tone: 'violet' },
  { label: 'Estimated savings', value: '$0/mo', change: 'No live sync', icon: CheckCircle2, tone: 'emerald' },
  { label: 'Security warnings', value: '0', change: 'No live sync', icon: AlertTriangle, tone: 'amber' },
];

// Change AWS overview graph dummy data here.
export const awsOverviewCharts = [
  {
    title: 'Cost by service',
    metric: '$0.00',
    caption: 'Current month AWS spend',
    tone: 'cyan',
    data: [
      { label: 'EC2', value: 0 },
      { label: 'RDS', value: 0 },
      { label: 'Lambda', value: 0 },
      { label: 'CloudWatch', value: 0 },
      { label: 'S3', value: 0 },
    ],
  },
  {
    title: 'Lambda invocations',
    metric: '0',
    caption: '7-day serverless traffic',
    tone: 'violet',
    data: [
      { label: 'Mon', value: 0 },
      { label: 'Tue', value: 0 },
      { label: 'Wed', value: 0 },
      { label: 'Thu', value: 0 },
      { label: 'Fri', value: 0 },
      { label: 'Sat', value: 0 },
      { label: 'Sun', value: 0 },
    ],
  },
  {
    title: 'Resource health',
    metric: '0%',
    caption: 'Healthy AWS resources',
    tone: 'emerald',
    data: [
      { label: 'Healthy', value: 0 },
      { label: 'Warning', value: 0 },
      { label: 'Critical', value: 0 },
    ],
  },
  {
    title: 'Optimization queue',
    metric: '$0/mo',
    caption: 'Estimated savings available',
    tone: 'amber',
    data: [
      { label: 'Idle EC2', value: 0 },
      { label: 'EBS cleanup', value: 0 },
      { label: 'Log retention', value: 0 },
      { label: 'RDS resize', value: 0 },
    ],
  },
];

// Change AWS account dummy data here.
export const connectedAccount = {
  accountName: 'No AWS account connected',
  accountId: '',
  region: '',
  role: '',
  syncStatus: 'No live sync yet',
};

export const dashboardFeatureCards = [
  {
    title: 'Visual Infrastructure Builder',
    description: 'Drag AWS services onto the canvas, connect services, validate architecture, and export deployable plans.',
    icon: Workflow,
    page: 'builder' as DashboardPage,
  },
  {
    title: 'Terraform Export',
    description: 'Review generated HCL, split resources into modules, copy code, and prepare GitHub commits.',
    icon: Code2,
    page: 'terraform' as DashboardPage,
  },
  {
    title: 'AI Cloud Agent',
    description: 'Ask natural-language questions about billing, resources, failures, IAM risks, and optimization.',
    icon: BrainCircuit,
    page: 'ai-agent' as DashboardPage,
  },
  {
    title: 'Live AWS Insights',
    description: 'Track Lambda, EC2, S3, RDS, CloudWatch, cost, idle resources, and security signals in one view.',
    icon: LineChart,
    page: 'aws-insights' as DashboardPage,
  },
  {
    title: 'One-click Deployment',
    description: 'Preview a deployment plan, run policy checks, and promote Terraform changes to AWS.',
    icon: Rocket,
    page: 'deployments' as DashboardPage,
  },
  {
    title: 'Security Review',
    description: 'Detect public buckets, broad IAM policies, missing encryption, open ports, and secret exposure.',
    icon: ShieldCheck,
    page: 'security' as DashboardPage,
  },
];

// Change resource inventory dummy data here.
export const resourceInventory = [
  { service: 'Lambda', count: 0, health: 'No live sync', spend: '$0.00', icon: Zap },
  { service: 'EC2', count: 0, health: 'No live sync', spend: '$0.00', icon: Server },
  { service: 'S3', count: 0, health: 'No live sync', spend: '$0.00', icon: Database },
  { service: 'RDS', count: 0, health: 'No live sync', spend: '$0.00', icon: Database },
  { service: 'CloudWatch', count: 0, health: 'No live sync', spend: '$0.00', icon: Activity },
];

export const activeDiagrams: { name: string; resources: number; status: string; updated: string }[] = [];

export const agentMessages: { role: 'user' | 'agent'; text: string }[] = [];

export const agentActions = [
  'Summarize billing changes',
  'Find idle resources',
  'Review IAM blast radius',
  'Explain Lambda failures',
  'Generate Terraform fix',
  'Detect drift from diagram',
];

// Change Terraform dashboard preview here.
export const terraformFiles: { name: string; status: string; lines: number }[] = [];

export const terraformCode = 'No Terraform has been generated yet. Build a diagram first.';

export const deploymentPipeline = [
  { label: 'Diagram validated', status: 'pending', icon: SearchCheck },
  { label: 'Terraform generated', status: 'pending', icon: Code2 },
  { label: 'Security checks', status: 'pending', icon: ShieldCheck },
  { label: 'Plan approval', status: 'pending', icon: GitBranch },
  { label: 'Deploy to AWS', status: 'pending', icon: Rocket },
];

export const deployments: { app: string; env: string; status: string; resources: number; drift: string }[] = [];

export const securityFindings: { severity: string; title: string; resource: string; fix: string }[] = [];

export const costRecommendations: { title: string; savings: string; effort: string; icon: LucideIcon }[] = [];

export const awsConnectionSteps = [
  { title: 'Create deployment IAM role', description: 'Use a least-privilege role with AWS inventory reads plus Terraform permissions for selected services.', icon: LockKeyhole },
  { title: 'Paste role ARN', description: 'InfraPilot AI assumes the role securely without storing long-lived access keys.', icon: KeyRound },
  { title: 'Run first sync', description: 'Pull resource inventory, billing trends, security posture, and deployment drift signals.', icon: CloudCog },
  { title: 'Enable agent context', description: 'Let the AI agent answer questions using live AWS metadata and your diagrams.', icon: BrainCircuit },
];
