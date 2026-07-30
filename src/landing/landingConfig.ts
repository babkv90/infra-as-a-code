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
export const APP_NAME = 'infraflow';

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

export const navItems = ['Product', 'Visual Builder', 'AWS Insights', 'Terraform', /* 'Pricing', */ 'Workflow'];

export const problemCards: IconItem[] = [
  {
    title: 'Manual AWS setup is slow',
    description: 'Creating Lambda, IAM, API Gateway, S3, queues, and monitoring by hand is repetitive and easy to misconfigure.',
    icon: Zap,
  },
  {
    title: 'Terraform is hard to reason about visually',
    description: 'Infrastructure code is reviewable, but teams still need a clear diagram of what it creates and connects.',
    icon: Code2,
  },
  {
    title: 'Billing surprises happen',
    description: 'Unused resources, idle services, and misconfigured infrastructure can increase AWS cost.',
    icon: BadgeDollarSign,
  },
  {
    title: 'Cloud visibility is scattered',
    description: 'Inventory, billing, CloudWatch, CloudTrail, IAM, and deployment status are split across different operational views.',
    icon: Layers3,
  },
];

export const solutionCards: IconItem[] = [
  {
    title: 'Visual AWS architecture builder',
    description: 'Model AWS infrastructure with nodes, connections, groups, labels, editable properties, and validation before deploy.',
    icon: Workflow,
  },
  {
    title: 'Terraform generated from diagrams',
    description: 'Generate reviewable Terraform for supported AWS services, export it, copy it, or use the built-in deployment flow.',
    icon: Code2,
  },
  {
    title: 'AWS insight workspace',
    description: 'Connect an AWS role to sync cost, inventory, CloudWatch, CloudTrail, IAM, and resource signals in one dashboard.',
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

export const builderServices = ['Lambda', 'API Gateway', 'S3', 'DynamoDB', 'SQS', 'EventBridge', 'IAM', 'CloudWatch', 'VPC', 'RDS'];

export const aiBullets = [
  'Cost Explorer summaries',
  'AWS resource inventory',
  'CloudWatch and Lambda signals',
  'Cost optimization suggestions',
  'IAM account visibility',
  'Unused resource discovery',
  'CloudTrail recent events',
  'Terraform-managed drift checks',
  'Architecture guidance context',
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
  'Serverless app infrastructure',
  'AWS architecture planning',
  'DevOps deployment workflows',
  'Terraform generation and review',
  'Cloud cost visibility',
  'Infrastructure documentation',
  'Workspace-scoped AWS operations',
  'Platform engineering enablement',
];

export const securityItems = [
  'Workspace-level data isolation',
  'IAM role-based access',
  'Least-privilege role guidance',
  'No hardcoded AWS keys',
  'Secrets-aware configuration',
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
  Product: ['Visual Builder', 'AWS Insights', 'Terraform Export', 'Deployments'],
  Resources: ['Workflow', 'AWS Connection', 'Terraform Guide', 'Support'],
  Company: ['About Developer', /* 'Pricing', */ 'Contact'],
  Legal: ['Privacy Policy', 'Terms of Service', 'Security'],
};

export const heroStats = [
  { label: 'Deployable AWS services', value: '12' },
  { label: 'AWS sync categories', value: '15+' },
  { label: 'Export formats', value: '4' },
];

export const howItWorks = [
  { title: 'Design', description: 'Drag AWS services onto the visual canvas and connect the architecture flow.', icon: Workflow },
  { title: 'Validate', description: 'Check diagram structure, missing configuration, and deployment readiness.', icon: ShieldCheck },
  { title: 'Generate', description: 'Create Terraform from the diagram for review, export, GitHub, or deployment.', icon: Code2 },
  { title: 'Operate', description: 'Sync AWS inventory, cost, security, logs, deployment status, and drift context.', icon: BrainCircuit },
];

export const chartLabels = ['Billing usage trend', 'Resource usage breakdown', 'Lambda invocation graph', 'Cost by service'];

export const trustSignals = [
  { label: 'STS role connection', icon: LockKeyhole },
  { label: 'Terraform review gate', icon: ShieldCheck },
  { label: 'AWS live sync', icon: Cloud },
  { label: 'AI-assisted context', icon: Sparkles },
  { label: 'Terraform deploy path', icon: Rocket },
  { label: 'Audit-ready actions', icon: KeyRound },
];
