import {
  Activity,
  AlertTriangle,
  BadgeDollarSign,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  Cloud,
  Code2,
  Database,
  GitBranch,
  KeyRound,
  Layers3,
  LineChart,
  LockKeyhole,
  Network,
  Rocket,
  Server,
  ShieldCheck,
  Sparkles,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';

// Change the public product name here.
export const APP_NAME = 'InfraPilot AI';

// Change app navigation routes here.
export const DASHBOARD_ROUTE = '/dashboard';
export const REFERENCE_DOCS_ROUTE = '/references';
export const LOGIN_ROUTE = '/login';
export const REGISTER_ROUTE = '/register';

export type IconItem = {
  title: string;
  description: string;
  icon: LucideIcon;
};

export type DiagramNode = {
  id: string;
  label: string;
  status: string;
  icon: LucideIcon;
  x: number;
  y: number;
  color: string;
};

export type DiagramEdge = {
  from: string;
  to: string;
  bend?: number;
};

export const navItems = ['Product', 'Visual Builder', 'AI Agent', 'Terraform Export', /* 'Pricing', */ 'Docs'];

export const problemCards: IconItem[] = [
  {
    title: 'Manual AWS setup is slow',
    description: 'Creating Lambda, IAM roles, API Gateway, S3, and monitoring manually takes time and creates mistakes.',
    icon: Zap,
  },
  {
    title: 'Terraform is powerful but hard to visualize',
    description: 'Teams often struggle to understand what their Terraform code will actually create.',
    icon: Code2,
  },
  {
    title: 'Billing surprises happen',
    description: 'Unused resources, idle services, and misconfigured infrastructure can increase AWS cost.',
    icon: BadgeDollarSign,
  },
  {
    title: 'Cloud visibility is scattered',
    description: 'Billing, resources, logs, security, and deployment status are usually spread across multiple AWS screens.',
    icon: Layers3,
  },
];

export const solutionCards: IconItem[] = [
  {
    title: 'Drag-and-drop AWS builder',
    description: 'Design infrastructure using visual AWS nodes and connections. Build serverless flows, event-driven architecture, APIs, storage, and jobs visually.',
    icon: Workflow,
  },
  {
    title: 'Generate Terraform automatically',
    description: 'Convert your architecture diagram into clean, reusable Terraform modules that can be exported, reviewed, and deployed.',
    icon: Code2,
  },
  {
    title: 'AI Agent for AWS insights',
    description: 'Ask why your bill increased, which Lambda is failing, what resources are unused, or how to reduce cost this month.',
    icon: BrainCircuit,
  },
];

// Change the hero and builder mock diagram nodes here.
export const heroDiagramNodes: DiagramNode[] = [
  { id: 'api', label: 'API Gateway', status: 'Public Endpoint', icon: Network, x: 17, y: 30, color: '#22d3ee' },
  { id: 'events', label: 'EventBridge', status: 'Scheduler', icon: GitBranch, x: 17, y: 60, color: '#f472b6' },
  { id: 'lambda', label: 'Lambda', status: 'Runtime .NET 8', icon: Zap, x: 42, y: 45, color: '#a78bfa' },
  { id: 'ddb', label: 'DynamoDB', status: 'NoSQL Table', icon: Database, x: 66, y: 22, color: '#60a5fa' },
  { id: 's3', label: 'S3 Bucket', status: 'Object Storage', icon: Boxes, x: 66, y: 43, color: '#34d399' },
  { id: 'watch', label: 'CloudWatch', status: 'Awaiting sync', icon: LineChart, x: 61, y: 68, color: '#38bdf8' },
  { id: 'billing', label: 'AWS Billing', status: 'No live sync', icon: BadgeDollarSign, x: 37, y: 76, color: '#fbbf24' },
  { id: 'agent', label: 'AI Agent', status: 'Awaiting data', icon: BrainCircuit, x: 84, y: 73, color: '#22c55e' },
];

export const heroDiagramEdges: DiagramEdge[] = [
  { from: 'api', to: 'lambda' },
  { from: 'lambda', to: 'ddb' },
  { from: 'lambda', to: 's3' },
  { from: 'events', to: 'lambda' },
  { from: 'watch', to: 'agent' },
  { from: 'billing', to: 'agent' },
];

export const floatingBadges = ['Terraform Ready', 'AWS Connected', 'AI Cost Advisor', 'Secure IAM Check'];

export const builderServices = ['Lambda', 'API Gateway', 'S3', 'DynamoDB', 'SQS', 'EventBridge', 'IAM', 'CloudWatch', 'VPC', 'RDS'];

export const aiBullets = [
  'Real-time AWS billing insights',
  'Resource inventory',
  'Lambda health monitoring',
  'Cost optimization suggestions',
  'IAM risk detection',
  'Unused resource discovery',
  'CloudWatch log summary',
  'Terraform drift detection',
  'Architecture improvement suggestions',
];

// Change the Terraform preview code here.
export const terraformPreview = `resource "aws_lambda_function" "order_processor" {
  function_name = "order-processor"
  runtime       = "dotnet8"
  memory_size   = 512
  timeout       = 30
}

resource "aws_apigatewayv2_api" "api" {
  name          = "orders-api"
  protocol_type = "HTTP"
}`;

// Change AWS metric dummy data here.
export const awsMetrics = [
  { label: 'Monthly Spend', value: '$0.00', icon: BadgeDollarSign, tone: 'cyan' },
  { label: 'Active Lambda Functions', value: '0', icon: Zap, tone: 'violet' },
  { label: 'S3 Buckets', value: '0', icon: Boxes, tone: 'emerald' },
  { label: 'EC2 Instances', value: '0', icon: Server, tone: 'blue' },
  { label: 'Idle Resources Found', value: '0', icon: AlertTriangle, tone: 'amber' },
  { label: 'Estimated Savings', value: '$0/mo', icon: CheckCircle2, tone: 'emerald' },
  { label: 'Failed Invocations', value: '0', icon: Activity, tone: 'rose' },
  { label: 'Security Warnings', value: '0', icon: ShieldCheck, tone: 'amber' },
];

export const useCases = [
  'Serverless application builder',
  'Startup infrastructure planning',
  'DevOps automation',
  'Terraform learning and generation',
  'AWS cost monitoring',
  'Cloud architecture documentation',
  'AI-assisted cloud operations',
  'Internal platform engineering',
];

export const securityItems = [
  'Read-only AWS account connection for insights',
  'IAM role-based access',
  'Least privilege recommendations',
  'No hardcoded AWS keys',
  'Encrypted secrets',
  'Terraform review before deployment',
  'Audit logs',
  'Role-based dashboard access',
];

// Change pricing values and plan features here.
export const pricingPlans = [
  {
    name: 'Free',
    price: '$0',
    description: 'Explore visual infrastructure design.',
    features: ['Visual builder', '3 diagrams', 'Basic Terraform export', 'Community support'],
    cta: 'Start Free',
  },
  {
    name: 'Pro',
    price: '$29',
    description: 'For builders connecting real AWS accounts.',
    features: ['Unlimited diagrams', 'AWS account connection', 'AI agent', 'Billing insights', 'Terraform export', 'Resource monitoring'],
    cta: 'Upgrade to Pro',
    featured: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    description: 'Controls for platform teams and enterprises.',
    features: ['SSO', 'Team workspaces', 'Audit logs', 'Custom AWS policies', 'Private deployment', 'Priority support'],
    cta: 'Contact Sales',
  },
];

export const footerColumns = {
  Product: ['Visual Builder', 'AI Agent', 'Terraform Export', 'AWS Insights'],
  Resources: ['Docs', 'Tutorials', 'API Reference', 'Terraform Guide'],
  Company: ['About', /* 'Pricing', */ 'Contact', 'Blog'],
  Legal: ['Privacy', 'Terms', 'Security'],
};

export const heroStats = [
  { label: 'Terraform resources generated', value: '0' },
  { label: 'Potential monthly savings found', value: '$0' },
  { label: 'AWS services supported', value: '0' },
];

export const howItWorks = [
  { title: 'Design', description: 'Drag AWS services onto the visual canvas.', icon: Workflow },
  { title: 'Validate', description: 'Check missing IAM permissions, invalid connections, and deployment risks.', icon: ShieldCheck },
  { title: 'Generate', description: 'Export Terraform code from the diagram.', icon: Code2 },
  { title: 'Monitor', description: 'Connect AWS and ask the AI agent about billing, resources, and optimization.', icon: BrainCircuit },
];

export const chartLabels = ['Billing usage trend', 'Resource usage breakdown', 'Lambda invocation graph', 'Cost by service'];

export const trustSignals = [
  { label: 'Read-only IAM mode', icon: LockKeyhole },
  { label: 'Terraform review gate', icon: ShieldCheck },
  { label: 'Live AWS telemetry', icon: Cloud },
  { label: 'AI architecture advisor', icon: Sparkles },
  { label: 'One-click deploy path', icon: Rocket },
  { label: 'Secrets-aware workflows', icon: KeyRound },
];
