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
  LifeBuoy,
  LineChart,
  LockKeyhole,
  Network,
  Rocket,
  SearchCheck,
  Server,
  Settings,
  SlidersHorizontal,
  ShieldCheck,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { MarkerType } from 'reactflow';
import { serviceById } from '../data/awsServices';
import type { AwsEdge, AwsNode, DiagramSnapshot, EdgeConnectionType } from '../types';

// Change dashboard navigation items here.
export type DashboardPage =
  | 'overview'
  | 'builder'
  | 'terraform'
  | 'ai-agent'
  | 'deployments'
  | 'resource-info'
  | 'app-pipeline'
  | 'security'
  | 'runtime-lab'
  | 'connect-aws'
  | 'support'
  | 'super-admin';

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
  { id: 'deployments', label: 'Deployments', icon: Rocket },
  { id: 'resource-info', label: 'Resource Info', icon: Database },
  { id: 'app-pipeline', label: 'App Pipeline', icon: GitBranch },
  { id: 'security', label: 'Security Review', icon: ShieldCheck },
  // { id: 'runtime-lab', label: 'Runtime Lab', icon: Cpu, badge: 'Node' },
  { id: 'connect-aws', label: 'Connect AWS', icon: CloudCog },
  { id: 'support', label: 'Support', icon: LifeBuoy },
  { id: 'super-admin', label: 'Super Admin', icon: SlidersHorizontal },
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
    title: 'Live AWS and Cost Overview',
    description: 'Track Lambda, EC2, S3, RDS, CloudWatch, cost, idle resources, and security signals in one overview.',
    icon: LineChart,
    page: 'overview' as DashboardPage,
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

export const commonDeploymentTemplates = [
  {
    id: 'react-spa-production',
    name: 'React free-tier static site on S3',
    compatibility: 'Vite React, Create React App, static React dashboards, admin portals',
    infrastructure: 'S3 static website hosting only',
    deploymentPath: 'Build the React app, sync dist/ or build/ to the S3 website bucket, and use the returned website endpoint.',
  },
  {
    id: 'static-spa-cdn',
    name: 'React / Vue / Angular static frontend',
    compatibility: 'Single page apps, static sites, dashboards, docs portals',
    infrastructure: 'S3 website bucket, CloudFront CDN, WAF, CloudWatch alarm',
    deploymentPath: 'Build the app, upload the artifact to S3, then serve it through CloudFront.',
  },
  {
    id: 'nextjs-node-web',
    name: 'Next.js / Node.js web application',
    compatibility: 'SSR web apps, API-backed dashboards, full-stack JavaScript apps',
    infrastructure: 'ECS Fargate, Application Load Balancer, ECR, RDS, Secrets Manager',
    deploymentPath: 'Build and push a container image to ECR, then update the ECS service.',
  },
  {
    id: 'rest-api-serverless',
    name: 'Serverless REST API',
    compatibility: 'Lightweight APIs, webhook receivers, mobile app backends',
    infrastructure: 'API Gateway, Lambda, DynamoDB, CloudWatch, IAM',
    deploymentPath: 'Package Lambda handlers, publish function versions, and update API Gateway routes.',
  },
  {
    id: 'python-fastapi-container',
    name: 'Python FastAPI / Flask service',
    compatibility: 'Python APIs, ML-adjacent services, internal automation endpoints',
    infrastructure: 'ECS Fargate, ECR, Application Load Balancer, RDS or DynamoDB',
    deploymentPath: 'Build the Python service image, push to ECR, then roll the ECS task definition.',
  },
  {
    id: 'java-springboot-service',
    name: 'Java Spring Boot service',
    compatibility: 'Enterprise APIs, scheduled jobs, high-throughput backend services',
    infrastructure: 'ECS Fargate or EC2 Auto Scaling, ALB, RDS, ElastiCache, CloudWatch',
    deploymentPath: 'Publish the JVM container or JAR image, then deploy through ECS or EC2 rolling updates.',
  },
  {
    id: 'php-wordpress-cms',
    name: 'PHP / WordPress CMS',
    compatibility: 'WordPress, Laravel, PHP content sites, admin portals',
    infrastructure: 'EC2 Auto Scaling, ALB, RDS MySQL, EFS, CloudFront',
    deploymentPath: 'Deploy code to EC2 instances, attach shared media on EFS, and serve through the ALB/CDN.',
  },
  {
    id: 'kubernetes-microservices',
    name: 'Kubernetes microservices platform',
    compatibility: 'Multi-service systems, service mesh apps, teams deploying independent services',
    infrastructure: 'EKS, ECR, ALB Ingress, RDS, ElastiCache, CloudWatch',
    deploymentPath: 'Push service images to ECR, apply Kubernetes manifests or Helm charts, and update ingress.',
  },
  {
    id: 'realtime-websocket-app',
    name: 'Real-time WebSocket application',
    compatibility: 'Chat apps, collaboration tools, live notifications, realtime dashboards',
    infrastructure: 'API Gateway WebSocket, Lambda, DynamoDB, EventBridge',
    deploymentPath: 'Deploy Lambda route handlers and bind WebSocket routes to the API Gateway stage.',
  },
  {
    id: 'event-worker-pipeline',
    name: 'Background worker and event processor',
    compatibility: 'Queue workers, async jobs, image processing, email and notification systems',
    infrastructure: 'SQS, Lambda or ECS workers, EventBridge, S3, CloudWatch',
    deploymentPath: 'Deploy worker code, connect queues and schedules, then tune concurrency limits.',
  },
  {
    id: 'data-analytics-lake',
    name: 'Data lake and analytics workload',
    compatibility: 'ETL jobs, reporting pipelines, batch analytics, BI data foundations',
    infrastructure: 'S3, Glue, Athena, Lambda, EventBridge, IAM',
    deploymentPath: 'Deploy ingestion jobs, create catalog tables, and run scheduled transforms over S3 data.',
  },
  {
    id: 'fullstack-react-node',
    name: 'Full-stack app (React frontend + Node.js API)',
    compatibility: 'React/Vite frontend with a separate Node.js/Express API backend, MERN-style full-stack apps',
    infrastructure: 'S3 + CloudFront + WAF (React frontend), ECS Fargate + ALB + ECR (Node API), Secrets Manager, CloudWatch',
    deploymentPath: 'One deployment provisions both stacks: build the frontend and sync dist/ to S3/CloudFront, and build the API image, push to ECR, and roll the ECS service.',
  },
  {
    id: 'apigateway-lambda-iam',
    name: 'API Gateway + Lambda + IAM role',
    compatibility: 'Lightweight single-function APIs, webhooks, cron-triggered jobs, quick backend endpoints',
    infrastructure: 'API Gateway (HTTP API), Lambda function, IAM execution role',
    deploymentPath: 'Package the function code into a zip, deploy — API Gateway proxies every request straight to the Lambda function, which assumes the IAM role automatically.',
  },
];

export type CommonInfraTemplate = (typeof commonDeploymentTemplates)[number] & {
  snapshot: DiagramSnapshot;
};

type TemplateNodeInput = {
  id: string;
  serviceId: string;
  label: string;
  x: number;
  y: number;
  config?: Record<string, string | number>;
};

type TemplateEdgeInput = {
  source: string;
  target: string;
  label: string;
  connectionType?: EdgeConnectionType;
  protocol?: string;
  port?: string;
};

function templateNode({ id, serviceId, label, x, y, config = {} }: TemplateNodeInput): AwsNode {
  const service = serviceById[serviceId];

  return {
    id,
    type: 'awsService',
    position: { x, y },
    data: {
      serviceId,
      serviceName: service.name,
      label,
      region: String(config.region ?? service.defaultConfig.region ?? 'ap-south-1'),
      arn: '',
      status: 'unknown',
      color: service.color,
      icon: service.icon,
      subLabel: service.subLabel,
      ports: service.ports,
      config: { ...service.defaultConfig, ...config },
    },
  };
}

function templateEdge({ source, target, label, connectionType = 'data', protocol = 'HTTPS', port = '' }: TemplateEdgeInput): AwsEdge {
  return {
    id: `template-edge-${source}-${target}`,
    source,
    target,
    type: 'flowEdge',
    animated: false,
    markerEnd: { type: MarkerType.ArrowClosed },
    data: { label, connectionType, protocol, port },
  };
}

function templateSnapshot(nodes: TemplateNodeInput[], edges: TemplateEdgeInput[]): DiagramSnapshot {
  return {
    nodes: nodes.map(templateNode),
    edges: edges.map(templateEdge),
  };
}

export const commonInfraTemplates: CommonInfraTemplate[] = commonDeploymentTemplates.map((template) => {
  const snapshots: Record<string, DiagramSnapshot> = {
    'react-spa-production': templateSnapshot(
      [
        {
          id: 'tpl-react-s3',
          serviceId: 's3',
          label: 'React website bucket',
          x: 260,
          y: 120,
          config: {
            bucket_prefix: 'infraflow-react-',
            website_index_document: 'index.html',
            website_error_document: 'index.html',
            public_read: 'true',
          },
        },
      ],
      [],
    ),
    'static-spa-cdn': templateSnapshot(
      [
        {
          id: 'tpl-static-cloudfront',
          serviceId: 'cloudfront',
          label: 'Global CDN',
          x: 160,
          y: 120,
          config: { enabled: 'true', comment: 'Static frontend CDN', default_root_object: 'index.html', price_class: 'PriceClass_100' },
        },
        {
          id: 'tpl-static-s3',
          serviceId: 's3',
          label: 'Frontend build bucket',
          x: 500,
          y: 120,
          config: {
            bucket_prefix: 'infraflow-static-',
            website_index_document: 'index.html',
            website_error_document: 'index.html',
            public_read: 'true',
          },
        },
        {
          id: 'tpl-static-waf',
          serviceId: 'waf',
          label: 'Edge WAF',
          x: 160,
          y: 310,
          config: { scope: 'CLOUDFRONT', default_action: 'allow', metric_name: 'StaticFrontendWebAcl' },
        },
        {
          id: 'tpl-static-cloudwatch',
          serviceId: 'cloudwatch',
          label: 'CDN 5xx alarm',
          x: 500,
          y: 310,
          config: {
            comparison_operator: 'GreaterThanThreshold',
            evaluation_periods: 2,
            metric_name: '5xxErrorRate',
            namespace: 'AWS/CloudFront',
            period: 300,
            statistic: 'Average',
            threshold: 1,
          },
        },
      ],
      [
        { source: 'tpl-static-cloudfront', target: 'tpl-static-s3', label: 'origin', protocol: 'HTTPS', port: '443' },
        { source: 'tpl-static-waf', target: 'tpl-static-cloudfront', label: 'edge protection', connectionType: 'security', protocol: 'HTTPS', port: '443' },
        { source: 'tpl-static-cloudfront', target: 'tpl-static-cloudwatch', label: 'metrics', connectionType: 'monitoring', protocol: 'CloudWatch' },
      ],
    ),
    'nextjs-node-web': templateSnapshot(
      [
        { id: 'tpl-node-sg', serviceId: 'security-group', label: 'App security group', x: 70, y: 260, config: { description: 'Allows inbound HTTP traffic to the load balancer and app', vpc_id: 'data.aws_vpc.default.id', ingress_ports: '80,3000', ingress_cidr_blocks: '0.0.0.0/0', egress_cidr_blocks: '0.0.0.0/0' } },
        { id: 'tpl-node-alb', serviceId: 'alb', label: 'Public app load balancer', x: 330, y: 150, config: { load_balancer_type: 'application', internal: 'false', subnets: 'data.aws_subnets.default.ids' } },
        { id: 'tpl-node-listener', serviceId: 'lb-listener', label: 'HTTP listener', x: 330, y: 330, config: { port: 80, protocol: 'HTTP' } },
        { id: 'tpl-node-target-group', serviceId: 'lb-target-group', label: 'App target group', x: 470, y: 330, config: { port: 3000, protocol: 'HTTP', target_type: 'ip', vpc_id: 'data.aws_vpc.default.id', health_check_path: '/' } },
        { id: 'tpl-node-ecs', serviceId: 'ecs', label: 'Next.js ECS service', x: 610, y: 150, config: { desired_count: 2, launch_type: 'FARGATE', container_port: 3000, cpu: 256, memory: 512, subnets: 'data.aws_subnets.default.ids', secret_env_var_name: 'DATABASE_URL' } },
        { id: 'tpl-node-ecr', serviceId: 'ecr', label: 'Container registry', x: 610, y: 330, config: { image_tag_mutability: 'IMMUTABLE', scan_on_push: 'true' } },
        { id: 'tpl-node-rds', serviceId: 'rds', label: 'Application database', x: 890, y: 150, config: { engine: 'postgres', instance_class: 'db.t3.micro', allocated_storage: 20, username: 'appuser', password: 'replace-with-a-strong-database-password', skip_final_snapshot: 'true' } },
        { id: 'tpl-node-secrets', serviceId: 'secrets', label: 'App secrets', x: 890, y: 330, config: { description: 'Runtime environment secrets' } },
      ],
      [
        { source: 'tpl-node-alb', target: 'tpl-node-sg', label: 'protected by', connectionType: 'security', protocol: 'VPC' },
        { source: 'tpl-node-listener', target: 'tpl-node-alb', label: 'listens on', protocol: 'HTTP', port: '80' },
        { source: 'tpl-node-listener', target: 'tpl-node-target-group', label: 'forwards to', protocol: 'HTTP' },
        { source: 'tpl-node-ecs', target: 'tpl-node-target-group', label: 'registers with', protocol: 'HTTP', port: '3000' },
        { source: 'tpl-node-ecs', target: 'tpl-node-sg', label: 'protected by', connectionType: 'security', protocol: 'VPC' },
        { source: 'tpl-node-ecr', target: 'tpl-node-ecs', label: 'image pull', protocol: 'ECR' },
        { source: 'tpl-node-ecs', target: 'tpl-node-rds', label: 'SQL', protocol: 'Postgres', port: '5432' },
        { source: 'tpl-node-rds', target: 'tpl-node-sg', label: 'protected by', connectionType: 'security', protocol: 'VPC' },
        { source: 'tpl-node-secrets', target: 'tpl-node-ecs', label: 'env secrets', connectionType: 'security', protocol: 'IAM' },
      ],
    ),
    'rest-api-serverless': templateSnapshot(
      [
        { id: 'tpl-api-apigw', serviceId: 'apigw', label: 'REST API endpoint', x: 100, y: 160, config: { protocol_type: 'HTTP' } },
        { id: 'tpl-api-lambda', serviceId: 'lambda', label: 'API handler', x: 380, y: 160, config: { runtime: 'nodejs20.x', handler: 'index.handler', memory_size: 512, timeout: 30, role_arn: 'var.lambda_role_arn', filename: 'dist/api.zip' } },
        { id: 'tpl-api-dynamodb', serviceId: 'dynamodb', label: 'API table', x: 670, y: 160, config: { billing_mode: 'PAY_PER_REQUEST', hash_key: 'id', hash_key_type: 'S' } },
        { id: 'tpl-api-iam', serviceId: 'iam', label: 'Lambda role', x: 380, y: 340, config: { assume_role_policy: 'data.aws_iam_policy_document.lambda_assume_role.json' } },
        { id: 'tpl-api-cloudwatch', serviceId: 'cloudwatch', label: 'API alarms', x: 670, y: 340, config: { metric_name: 'Errors', namespace: 'AWS/Lambda' } },
      ],
      [
        { source: 'tpl-api-apigw', target: 'tpl-api-lambda', label: 'invoke', connectionType: 'event', protocol: 'HTTP' },
        { source: 'tpl-api-lambda', target: 'tpl-api-dynamodb', label: 'read/write', protocol: 'DynamoDB' },
        { source: 'tpl-api-iam', target: 'tpl-api-lambda', label: 'execution role', connectionType: 'security', protocol: 'IAM' },
        { source: 'tpl-api-lambda', target: 'tpl-api-cloudwatch', label: 'logs/metrics', connectionType: 'monitoring', protocol: 'CloudWatch' },
      ],
    ),
    'python-fastapi-container': templateSnapshot(
      [
        { id: 'tpl-fastapi-alb', serviceId: 'alb', label: 'API load balancer', x: 100, y: 160, config: { load_balancer_type: 'application', internal: 'false' } },
        { id: 'tpl-fastapi-ecs', serviceId: 'ecs', label: 'FastAPI service', x: 380, y: 160, config: { desired_count: 2, launch_type: 'FARGATE' } },
        { id: 'tpl-fastapi-ecr', serviceId: 'ecr', label: 'FastAPI image repo', x: 380, y: 340, config: { scan_on_push: 'true' } },
        { id: 'tpl-fastapi-rds', serviceId: 'rds', label: 'Postgres database', x: 670, y: 160, config: { engine: 'postgres', instance_class: 'db.t3.micro', allocated_storage: 20, username: 'appuser', password: 'var.db_password', skip_final_snapshot: 'true' } },
        { id: 'tpl-fastapi-secrets', serviceId: 'secrets', label: 'Runtime secrets', x: 670, y: 340, config: {} },
      ],
      [
        { source: 'tpl-fastapi-alb', target: 'tpl-fastapi-ecs', label: 'HTTP API', protocol: 'HTTP', port: '80' },
        { source: 'tpl-fastapi-ecr', target: 'tpl-fastapi-ecs', label: 'image pull', protocol: 'ECR' },
        { source: 'tpl-fastapi-ecs', target: 'tpl-fastapi-rds', label: 'SQL', protocol: 'Postgres', port: '5432' },
        { source: 'tpl-fastapi-secrets', target: 'tpl-fastapi-ecs', label: 'env secrets', connectionType: 'security', protocol: 'IAM' },
      ],
    ),
    'java-springboot-service': templateSnapshot(
      [
        { id: 'tpl-java-alb', serviceId: 'alb', label: 'Service load balancer', x: 100, y: 160, config: { load_balancer_type: 'application', internal: 'false' } },
        { id: 'tpl-java-ecs', serviceId: 'ecs', label: 'Spring Boot service', x: 380, y: 160, config: { desired_count: 2, launch_type: 'FARGATE' } },
        { id: 'tpl-java-rds', serviceId: 'rds', label: 'Transactional database', x: 670, y: 160, config: { engine: 'postgres', instance_class: 'db.t3.micro', allocated_storage: 30, username: 'appuser', password: 'var.db_password', skip_final_snapshot: 'true' } },
        { id: 'tpl-java-cache', serviceId: 'elasticache', label: 'Redis cache', x: 670, y: 340, config: { engine: 'redis', node_type: 'cache.t3.micro', num_cache_nodes: 1, port: 6379 } },
        { id: 'tpl-java-cloudwatch', serviceId: 'cloudwatch', label: 'JVM alarms', x: 380, y: 340, config: { metric_name: 'CPUUtilization', namespace: 'AWS/ECS' } },
      ],
      [
        { source: 'tpl-java-alb', target: 'tpl-java-ecs', label: 'HTTP traffic', protocol: 'HTTP', port: '80' },
        { source: 'tpl-java-ecs', target: 'tpl-java-rds', label: 'SQL', protocol: 'Postgres', port: '5432' },
        { source: 'tpl-java-ecs', target: 'tpl-java-cache', label: 'cache', protocol: 'Redis', port: '6379' },
        { source: 'tpl-java-ecs', target: 'tpl-java-cloudwatch', label: 'metrics', connectionType: 'monitoring', protocol: 'CloudWatch' },
      ],
    ),
    'php-wordpress-cms': templateSnapshot(
      [
        { id: 'tpl-php-route53', serviceId: 'route53', label: 'Site DNS', x: 60, y: 160, config: { name: 'cms.example.com', type: 'A' } },
        { id: 'tpl-php-alb', serviceId: 'alb', label: 'CMS load balancer', x: 310, y: 160, config: { load_balancer_type: 'application', internal: 'false' } },
        { id: 'tpl-php-ec2', serviceId: 'ec2', label: 'PHP web server', x: 570, y: 160, config: { name: 'cms-web', instance_type: 't3.small', key_name: 'app-keypair', associate_public_ip_address: 'false' } },
        { id: 'tpl-php-rds', serviceId: 'rds', label: 'MySQL database', x: 830, y: 160, config: { engine: 'mysql', instance_class: 'db.t3.micro', allocated_storage: 20, username: 'wordpress', password: 'var.db_password', skip_final_snapshot: 'true' } },
        { id: 'tpl-php-efs', serviceId: 'efs', label: 'Shared uploads', x: 570, y: 340, config: { creation_token: 'cms-uploads', encrypted: 'true', performance_mode: 'generalPurpose', throughput_mode: 'bursting' } },
      ],
      [
        { source: 'tpl-php-route53', target: 'tpl-php-alb', label: 'DNS alias', protocol: 'DNS' },
        { source: 'tpl-php-alb', target: 'tpl-php-ec2', label: 'HTTP traffic', protocol: 'HTTP', port: '80' },
        { source: 'tpl-php-ec2', target: 'tpl-php-rds', label: 'SQL', protocol: 'MySQL', port: '3306' },
        { source: 'tpl-php-ec2', target: 'tpl-php-efs', label: 'shared files', protocol: 'NFS', port: '2049' },
      ],
    ),
    'kubernetes-microservices': templateSnapshot(
      [
        { id: 'tpl-eks-route53', serviceId: 'route53', label: 'Service DNS', x: 60, y: 150, config: { name: 'api.example.com', type: 'A' } },
        { id: 'tpl-eks-alb', serviceId: 'alb', label: 'Ingress load balancer', x: 310, y: 150, config: { load_balancer_type: 'application', internal: 'false' } },
        { id: 'tpl-eks-cluster', serviceId: 'eks', label: 'EKS cluster', x: 580, y: 150, config: { version: '1.30', role_arn: 'var.eks_role_arn' } },
        { id: 'tpl-eks-ecr', serviceId: 'ecr', label: 'Service images', x: 580, y: 330, config: { scan_on_push: 'true' } },
        { id: 'tpl-eks-rds', serviceId: 'rds', label: 'Shared database', x: 850, y: 150, config: { engine: 'postgres', instance_class: 'db.t3.small', allocated_storage: 30, username: 'appuser', password: 'var.db_password', skip_final_snapshot: 'true' } },
        { id: 'tpl-eks-cache', serviceId: 'elasticache', label: 'Shared cache', x: 850, y: 330, config: { engine: 'redis', node_type: 'cache.t3.micro', num_cache_nodes: 1, port: 6379 } },
      ],
      [
        { source: 'tpl-eks-route53', target: 'tpl-eks-alb', label: 'DNS alias', protocol: 'DNS' },
        { source: 'tpl-eks-alb', target: 'tpl-eks-cluster', label: 'ingress', protocol: 'HTTPS', port: '443' },
        { source: 'tpl-eks-ecr', target: 'tpl-eks-cluster', label: 'image pull', protocol: 'ECR' },
        { source: 'tpl-eks-cluster', target: 'tpl-eks-rds', label: 'SQL', protocol: 'Postgres', port: '5432' },
        { source: 'tpl-eks-cluster', target: 'tpl-eks-cache', label: 'cache', protocol: 'Redis', port: '6379' },
      ],
    ),
    'realtime-websocket-app': templateSnapshot(
      [
        { id: 'tpl-ws-apigw', serviceId: 'apigw', label: 'WebSocket API', x: 100, y: 160, config: { protocol_type: 'WEBSOCKET' } },
        { id: 'tpl-ws-lambda', serviceId: 'lambda', label: 'Socket route handler', x: 380, y: 160, config: { runtime: 'nodejs20.x', handler: 'index.handler', memory_size: 512, timeout: 30, role_arn: 'var.lambda_role_arn', filename: 'dist/websocket.zip' } },
        { id: 'tpl-ws-ddb', serviceId: 'dynamodb', label: 'Connections table', x: 670, y: 160, config: { billing_mode: 'PAY_PER_REQUEST', hash_key: 'connectionId', hash_key_type: 'S' } },
        { id: 'tpl-ws-eventbridge', serviceId: 'eventbridge', label: 'Realtime events', x: 380, y: 340, config: { event_pattern: 'var.event_pattern' } },
      ],
      [
        { source: 'tpl-ws-apigw', target: 'tpl-ws-lambda', label: 'route invoke', connectionType: 'event', protocol: 'WebSocket' },
        { source: 'tpl-ws-lambda', target: 'tpl-ws-ddb', label: 'connections', protocol: 'DynamoDB' },
        { source: 'tpl-ws-eventbridge', target: 'tpl-ws-lambda', label: 'push event', connectionType: 'event', protocol: 'EventBridge' },
      ],
    ),
    'event-worker-pipeline': templateSnapshot(
      [
        { id: 'tpl-worker-s3', serviceId: 's3', label: 'Job input bucket', x: 90, y: 160, config: { bucket_prefix: 'infraflow-worker-', versioning: 'Enabled' } },
        { id: 'tpl-worker-eventbridge', serviceId: 'eventbridge', label: 'Job scheduler', x: 340, y: 160, config: { schedule_expression: 'rate(5 minutes)' } },
        { id: 'tpl-worker-sqs', serviceId: 'sqs', label: 'Work queue', x: 590, y: 160, config: { fifo_queue: 'false', visibility_timeout_seconds: 60, message_retention_seconds: 345600 } },
        { id: 'tpl-worker-lambda', serviceId: 'lambda', label: 'Worker function', x: 840, y: 160, config: { runtime: 'python3.12', handler: 'handler.main', memory_size: 1024, timeout: 120, role_arn: 'var.lambda_role_arn', filename: 'dist/worker.zip' } },
        { id: 'tpl-worker-cloudwatch', serviceId: 'cloudwatch', label: 'Queue alarms', x: 590, y: 340, config: { metric_name: 'ApproximateNumberOfMessagesVisible', namespace: 'AWS/SQS' } },
      ],
      [
        { source: 'tpl-worker-s3', target: 'tpl-worker-sqs', label: 'object event', connectionType: 'event', protocol: 'S3 Event' },
        { source: 'tpl-worker-eventbridge', target: 'tpl-worker-sqs', label: 'scheduled job', connectionType: 'event', protocol: 'EventBridge' },
        { source: 'tpl-worker-sqs', target: 'tpl-worker-lambda', label: 'consume', connectionType: 'event', protocol: 'SQS' },
        { source: 'tpl-worker-sqs', target: 'tpl-worker-cloudwatch', label: 'metrics', connectionType: 'monitoring', protocol: 'CloudWatch' },
      ],
    ),
    'data-analytics-lake': templateSnapshot(
      [
        { id: 'tpl-data-s3-raw', serviceId: 's3', label: 'Raw data lake', x: 90, y: 150, config: { bucket_prefix: 'infraflow-analytics-raw-', versioning: 'Enabled' } },
        { id: 'tpl-data-eventbridge', serviceId: 'eventbridge', label: 'ETL schedule', x: 340, y: 150, config: { schedule_expression: 'rate(1 day)' } },
        { id: 'tpl-data-lambda', serviceId: 'lambda', label: 'ETL transform job', x: 590, y: 150, config: { runtime: 'python3.12', handler: 'handler.main', memory_size: 2048, timeout: 300, role_arn: 'var.lambda_role_arn', filename: 'dist/etl.zip' } },
        { id: 'tpl-data-s3-curated', serviceId: 's3', label: 'Curated data bucket', x: 840, y: 150, config: { bucket_prefix: 'infraflow-analytics-curated-', versioning: 'Enabled' } },
        { id: 'tpl-data-kinesis', serviceId: 'kinesis', label: 'Streaming ingest', x: 90, y: 330, config: { shard_count: 1, retention_period: 24 } },
        { id: 'tpl-data-cloudwatch', serviceId: 'cloudwatch', label: 'Pipeline alarms', x: 590, y: 330, config: { metric_name: 'Errors', namespace: 'AWS/Lambda' } },
      ],
      [
        { source: 'tpl-data-eventbridge', target: 'tpl-data-lambda', label: 'schedule', connectionType: 'event', protocol: 'EventBridge' },
        { source: 'tpl-data-s3-raw', target: 'tpl-data-lambda', label: 'raw input', protocol: 'S3' },
        { source: 'tpl-data-kinesis', target: 'tpl-data-lambda', label: 'stream input', connectionType: 'event', protocol: 'Kinesis' },
        { source: 'tpl-data-lambda', target: 'tpl-data-s3-curated', label: 'curated output', protocol: 'S3' },
        { source: 'tpl-data-lambda', target: 'tpl-data-cloudwatch', label: 'logs/metrics', connectionType: 'monitoring', protocol: 'CloudWatch' },
      ],
    ),
    'fullstack-react-node': templateSnapshot(
      [
        // --- Networking ---
        { id: 'tpl-full-vpc', serviceId: 'vpc', label: 'App VPC', x: 40, y: 500, config: { cidr_block: '10.0.0.0/16', enable_dns_hostnames: 'true', enable_dns_support: 'true' } },
        { id: 'tpl-full-subnet-pub-a', serviceId: 'subnet', label: 'Public subnet A', x: 280, y: 420, config: { cidr_block: '10.0.0.0/24', availability_zone: 'ap-south-1a', map_public_ip_on_launch: 'true' } },
        { id: 'tpl-full-subnet-pub-b', serviceId: 'subnet', label: 'Public subnet B', x: 280, y: 500, config: { cidr_block: '10.0.1.0/24', availability_zone: 'ap-south-1b', map_public_ip_on_launch: 'true' } },
        { id: 'tpl-full-subnet-priv-a', serviceId: 'subnet', label: 'Private subnet A (database)', x: 280, y: 580, config: { cidr_block: '10.0.10.0/24', availability_zone: 'ap-south-1a', map_public_ip_on_launch: 'false' } },
        { id: 'tpl-full-subnet-priv-b', serviceId: 'subnet', label: 'Private subnet B (database)', x: 280, y: 660, config: { cidr_block: '10.0.11.0/24', availability_zone: 'ap-south-1b', map_public_ip_on_launch: 'false' } },
        { id: 'tpl-full-igw', serviceId: 'igw', label: 'Internet gateway', x: 40, y: 420, config: {} },
        { id: 'tpl-full-rt', serviceId: 'route-table', label: 'Public route table', x: 520, y: 420, config: {} },
        { id: 'tpl-full-route', serviceId: 'route', label: 'Route to internet', x: 520, y: 340, config: { destination_cidr_block: '0.0.0.0/0' } },
        { id: 'tpl-full-rta-a', serviceId: 'route-association', label: 'Public subnet A association', x: 520, y: 500, config: {} },
        { id: 'tpl-full-rta-b', serviceId: 'route-association', label: 'Public subnet B association', x: 520, y: 580, config: {} },
        { id: 'tpl-full-sg-alb', serviceId: 'security-group', label: 'ALB security group', x: 780, y: 40, config: { description: 'Allows inbound HTTP/HTTPS from the internet', ingress_ports: '80,443', ingress_cidr_blocks: '0.0.0.0/0', egress_cidr_blocks: '0.0.0.0/0' } },
        { id: 'tpl-full-sg-ecs', serviceId: 'security-group', label: 'API security group', x: 1040, y: 40, config: { description: 'Allows inbound API traffic from inside the VPC only', ingress_ports: '8080', ingress_cidr_blocks: '10.0.0.0/16', egress_cidr_blocks: '0.0.0.0/0' } },
        { id: 'tpl-full-sg-docdb', serviceId: 'security-group', label: 'Database security group', x: 1300, y: 580, config: { description: 'Allows inbound MongoDB traffic from inside the VPC only', ingress_ports: '27017', ingress_cidr_blocks: '10.0.0.0/16', egress_cidr_blocks: '0.0.0.0/0' } },

        // --- Frontend ---
        {
          id: 'tpl-full-s3',
          serviceId: 's3',
          label: 'React frontend bucket',
          x: 40,
          y: 120,
          config: {
            bucket_prefix: 'infraflow-fullstack-web-',
            website_index_document: 'index.html',
            website_error_document: 'index.html',
            public_read: 'true',
          },
        },
        { id: 'tpl-full-cloudfront', serviceId: 'cloudfront', label: 'Frontend CDN', x: 280, y: 120, config: { enabled: 'true', comment: 'Full-stack app frontend CDN', default_root_object: 'index.html', price_class: 'PriceClass_100' } },
        { id: 'tpl-full-waf', serviceId: 'waf', label: 'Edge WAF', x: 40, y: 220, config: { scope: 'CLOUDFRONT', default_action: 'allow', metric_name: 'FullStackWebAcl' } },
        {
          id: 'tpl-full-cloudwatch',
          serviceId: 'cloudwatch',
          label: 'CDN 5xx alarm',
          x: 280,
          y: 220,
          config: {
            comparison_operator: 'GreaterThanThreshold',
            evaluation_periods: 2,
            metric_name: '5xxErrorRate',
            namespace: 'AWS/CloudFront',
            period: 300,
            statistic: 'Average',
            threshold: 1,
          },
        },

        // --- Backend API ---
        { id: 'tpl-full-alb', serviceId: 'alb', label: 'API load balancer', x: 780, y: 120, config: { load_balancer_type: 'application', internal: 'false' } },
        { id: 'tpl-full-listener', serviceId: 'lb-listener', label: 'HTTP listener', x: 1040, y: 120, config: { port: 80, protocol: 'HTTP' } },
        { id: 'tpl-full-target-group', serviceId: 'lb-target-group', label: 'API target group', x: 1040, y: 220, config: { port: 8080, protocol: 'HTTP', target_type: 'ip', health_check_path: '/health' } },
        { id: 'tpl-full-ecs', serviceId: 'ecs', label: 'Node.js API service', x: 1300, y: 120, config: { desired_count: 2, launch_type: 'FARGATE', container_port: 8080, cpu: 256, memory: 512, secret_env_var_name: 'MONGODB_URI' } },
        { id: 'tpl-full-ecr', serviceId: 'ecr', label: 'API container registry', x: 1300, y: 220, config: { image_tag_mutability: 'IMMUTABLE', scan_on_push: 'true' } },
        { id: 'tpl-full-secrets', serviceId: 'secrets', label: 'API runtime secrets', x: 1300, y: 40, config: { description: 'MongoDB connection string, JWT secrets, and other API env vars' } },

        // --- Database ---
        { id: 'tpl-full-docdb-subnets', serviceId: 'docdb-subnet-group', label: 'Database subnet group', x: 1040, y: 580, config: {} },
        { id: 'tpl-full-docdb', serviceId: 'docdb', label: 'MongoDB-compatible cluster', x: 1300, y: 500, config: { engine: 'docdb', master_username: 'docdbadmin', master_password: 'replace-with-a-strong-database-password', skip_final_snapshot: 'true' } },
        { id: 'tpl-full-docdb-instance', serviceId: 'docdb-instance', label: 'Database instance', x: 1300, y: 660, config: { instance_class: 'db.t3.medium', engine: 'docdb' } },
      ],
      [
        // Frontend wiring
        { source: 'tpl-full-cloudfront', target: 'tpl-full-s3', label: 'origin', protocol: 'HTTPS', port: '443' },
        { source: 'tpl-full-waf', target: 'tpl-full-cloudfront', label: 'edge protection', connectionType: 'security', protocol: 'HTTPS', port: '443' },
        { source: 'tpl-full-cloudfront', target: 'tpl-full-cloudwatch', label: 'metrics', connectionType: 'monitoring', protocol: 'CloudWatch' },
        // Frontend calls backend directly (separate origin, CORS) — not a CloudFront path route
        { source: 'tpl-full-cloudfront', target: 'tpl-full-alb', label: 'API calls (CORS, browser-side)', connectionType: 'data', protocol: 'HTTPS', port: '443' },

        // Networking wiring
        { source: 'tpl-full-subnet-pub-a', target: 'tpl-full-vpc', label: 'in VPC', protocol: 'VPC' },
        { source: 'tpl-full-subnet-pub-b', target: 'tpl-full-vpc', label: 'in VPC', protocol: 'VPC' },
        { source: 'tpl-full-subnet-priv-a', target: 'tpl-full-vpc', label: 'in VPC', protocol: 'VPC' },
        { source: 'tpl-full-subnet-priv-b', target: 'tpl-full-vpc', label: 'in VPC', protocol: 'VPC' },
        { source: 'tpl-full-igw', target: 'tpl-full-vpc', label: 'attached to', protocol: 'VPC' },
        { source: 'tpl-full-rt', target: 'tpl-full-vpc', label: 'in VPC', protocol: 'VPC' },
        { source: 'tpl-full-route', target: 'tpl-full-rt', label: 'in route table', protocol: 'VPC' },
        { source: 'tpl-full-route', target: 'tpl-full-igw', label: 'via', protocol: 'VPC' },
        { source: 'tpl-full-rta-a', target: 'tpl-full-subnet-pub-a', label: 'associates', protocol: 'VPC' },
        { source: 'tpl-full-rta-a', target: 'tpl-full-rt', label: 'associates', protocol: 'VPC' },
        { source: 'tpl-full-rta-b', target: 'tpl-full-subnet-pub-b', label: 'associates', protocol: 'VPC' },
        { source: 'tpl-full-rta-b', target: 'tpl-full-rt', label: 'associates', protocol: 'VPC' },
        { source: 'tpl-full-sg-alb', target: 'tpl-full-vpc', label: 'in VPC', connectionType: 'security', protocol: 'VPC' },
        { source: 'tpl-full-sg-ecs', target: 'tpl-full-vpc', label: 'in VPC', connectionType: 'security', protocol: 'VPC' },
        { source: 'tpl-full-sg-docdb', target: 'tpl-full-vpc', label: 'in VPC', connectionType: 'security', protocol: 'VPC' },

        // Backend API wiring: ALB -> listener -> target group -> ECS
        { source: 'tpl-full-alb', target: 'tpl-full-subnet-pub-a', label: 'placed in', protocol: 'VPC' },
        { source: 'tpl-full-alb', target: 'tpl-full-subnet-pub-b', label: 'placed in', protocol: 'VPC' },
        { source: 'tpl-full-alb', target: 'tpl-full-sg-alb', label: 'protected by', connectionType: 'security', protocol: 'VPC' },
        { source: 'tpl-full-listener', target: 'tpl-full-alb', label: 'listens on', protocol: 'HTTP', port: '80' },
        { source: 'tpl-full-listener', target: 'tpl-full-target-group', label: 'forwards to', protocol: 'HTTP' },
        { source: 'tpl-full-target-group', target: 'tpl-full-vpc', label: 'in VPC', protocol: 'VPC' },
        { source: 'tpl-full-ecs', target: 'tpl-full-target-group', label: 'registers with', protocol: 'HTTP', port: '8080' },
        { source: 'tpl-full-ecs', target: 'tpl-full-subnet-pub-a', label: 'placed in', protocol: 'VPC' },
        { source: 'tpl-full-ecs', target: 'tpl-full-subnet-pub-b', label: 'placed in', protocol: 'VPC' },
        { source: 'tpl-full-ecs', target: 'tpl-full-sg-ecs', label: 'protected by', connectionType: 'security', protocol: 'VPC' },
        { source: 'tpl-full-ecr', target: 'tpl-full-ecs', label: 'image pull', protocol: 'ECR' },
        { source: 'tpl-full-secrets', target: 'tpl-full-ecs', label: 'env secrets (Mongo URI)', connectionType: 'security', protocol: 'IAM' },
        { source: 'tpl-full-ecs', target: 'tpl-full-docdb', label: 'MongoDB driver connection', protocol: 'MongoDB', port: '27017' },

        // Database wiring
        { source: 'tpl-full-docdb-subnets', target: 'tpl-full-subnet-priv-a', label: 'uses', protocol: 'VPC' },
        { source: 'tpl-full-docdb-subnets', target: 'tpl-full-subnet-priv-b', label: 'uses', protocol: 'VPC' },
        { source: 'tpl-full-docdb', target: 'tpl-full-docdb-subnets', label: 'placed in', protocol: 'VPC' },
        { source: 'tpl-full-docdb', target: 'tpl-full-sg-docdb', label: 'protected by', connectionType: 'security', protocol: 'VPC' },
        { source: 'tpl-full-docdb-instance', target: 'tpl-full-docdb', label: 'instance of', protocol: 'DocumentDB' },
      ],
    ),
    'apigateway-lambda-iam': templateSnapshot(
      [
        { id: 'tpl-al-iam', serviceId: 'iam', label: 'iaasNode execution role', x: 100, y: 260, config: {} },
        { id: 'tpl-al-lambda', serviceId: 'lambda', label: 'iaasNode', x: 380, y: 150, config: { runtime: 'nodejs20.x', handler: 'index.handler', filename: 'dist/iaasNode.zip', memory_size: 256, timeout: 15 } },
        { id: 'tpl-al-apigw', serviceId: 'apigw', label: 'iaasNode API', x: 660, y: 150, config: { protocol_type: 'HTTP' } },
      ],
      [
        { source: 'tpl-al-iam', target: 'tpl-al-lambda', label: 'execution role', connectionType: 'security', protocol: 'IAM' },
        { source: 'tpl-al-apigw', target: 'tpl-al-lambda', label: 'invoke', connectionType: 'event', protocol: 'HTTP' },
      ],
    ),
  };

  return { ...template, snapshot: snapshots[template.id] };
});

export const securityFindings: { severity: string; title: string; resource: string; fix: string }[] = [];

export const costRecommendations: { title: string; savings: string; effort: string; icon: LucideIcon }[] = [];

export const awsConnectionSteps = [
  { title: 'Create deployment IAM role', description: 'Use a least-privilege role with AWS inventory reads plus Terraform permissions for selected services.', icon: LockKeyhole },
  { title: 'Paste role ARN', description: 'infraflow assumes the role securely without storing long-lived access keys.', icon: KeyRound },
  { title: 'Run first sync', description: 'Pull resource inventory, billing trends, security posture, and deployment drift signals.', icon: CloudCog },
  { title: 'Enable agent context', description: 'Let the AI agent answer questions using live AWS metadata and your diagrams.', icon: BrainCircuit },
];
