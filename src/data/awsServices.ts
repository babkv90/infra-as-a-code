import type { AwsField, AwsService, GroupKind } from '../types';

const regions = ['us-east-1', 'us-east-2', 'us-west-2', 'eu-west-1', 'ap-south-1', 'ap-southeast-1'];
const statuses = ['running', 'stopped', 'unknown'];
const instanceTypes = ['t3.micro', 't3.small', 't3.medium', 'm6i.large', 'c7g.large'];
const dbEngines = ['mysql', 'postgres', 'aurora-postgresql', 'aurora-mysql'];
const documentDbEngines = ['docdb'];
const booleanOptions = ['true', 'false'];
const apiProtocols = ['HTTP', 'WEBSOCKET'];
const versioningStatuses = ['Enabled', 'Suspended'];
const loadBalancerProtocols = ['HTTP', 'HTTPS', 'TCP', 'TLS'];

const commonFields: AwsField[] = [
  { key: 'region', label: 'Region', type: 'select' as const, options: regions },
  { key: 'status', label: 'Status', type: 'select' as const, options: statuses },
];

const nameField: AwsField = { key: 'name', label: 'AWS name', type: 'text' };

export const groupKinds: GroupKind[] = ['Terraform stack', 'Region', 'Module', 'VPC', 'Availability Zone', 'Public Subnet', 'Private Subnet', 'Security Group'];

export const groupStyles: Record<GroupKind, { color: string; bg: string }> = {
  'Terraform stack': { color: '#334155', bg: 'rgba(51, 65, 85, 0.055)' },
  Region: { color: '#0f766e', bg: 'rgba(15, 118, 110, 0.055)' },
  Module: { color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.06)' },
  VPC: { color: '#2563eb', bg: 'rgba(37, 99, 235, 0.07)' },
  'Availability Zone': { color: '#64748b', bg: 'rgba(100, 116, 139, 0.08)' },
  'Public Subnet': { color: '#16a34a', bg: 'rgba(22, 163, 74, 0.07)' },
  'Private Subnet': { color: '#15803d', bg: 'rgba(21, 128, 61, 0.08)' },
  'Security Group': { color: '#dc2626', bg: 'rgba(220, 38, 38, 0.07)' },
};

export const awsServices: AwsService[] = [
  service('ec2', 'EC2', 'EC2', 'Compute', 'Server', '#f97316', ['SSH', 'HTTP'], ['ENI', 'Logs'], 'aws_instance', { name: '', ami: '', instance_type: '', subnet_id: '', vpc_security_group_ids: '', associate_public_ip_address: '', iam_role_arn: '', iam_instance_profile: '' }, [
    ...commonFields,
    nameField,
    { key: 'ami', label: 'AMI ID', type: 'text' },
    { key: 'instance_type', label: 'Instance type', type: 'select', options: instanceTypes },
    { key: 'subnet_id', label: 'Subnet ID expression', type: 'text' },
    { key: 'vpc_security_group_ids', label: 'Security group IDs expression', type: 'text' },
    { key: 'associate_public_ip_address', label: 'Associate public IP', type: 'select', options: booleanOptions },
    { key: 'iam_role_arn', label: 'IAM role ARN', type: 'text' },
    { key: 'iam_instance_profile', label: 'Instance profile name', type: 'text' },
  ]),
  service('lambda', 'Lambda', 'Lambda', 'Compute', 'Function', '#f59e0b', ['Event'], ['Result', 'Logs'], 'aws_lambda_function', { function_name: '', role_arn: '', filename: '', source_code_hash: '', handler: '', runtime: '', memory_size: '', timeout: '' }, [
    ...commonFields,
    { key: 'function_name', label: 'Function name', type: 'text' },
    { key: 'role_arn', label: 'Execution role ARN', type: 'text' },
    { key: 'filename', label: 'Deployment zip path', type: 'text' },
    { key: 'source_code_hash', label: 'Source code hash expression', type: 'text' },
    { key: 'handler', label: 'Handler', type: 'text' },
    { key: 'runtime', label: 'Runtime', type: 'select', options: ['nodejs20.x', 'python3.12', 'java21', 'go1.x'] },
    { key: 'memory_size', label: 'Memory MB', type: 'number' },
    { key: 'timeout', label: 'Timeout seconds', type: 'number' },
  ]),
  service('ecs', 'ECS/Fargate', 'ECS', 'Compute', 'Boxes', '#ea580c', ['HTTP', 'Task'], ['Service', 'Logs'], 'aws_ecs_service', { name: '', cluster: '', task_definition: '', desired_count: '', launch_type: '' }, [
    ...commonFields,
    nameField,
    { key: 'cluster', label: 'Cluster ARN/name', type: 'text' },
    { key: 'task_definition', label: 'Task definition ARN', type: 'text' },
    { key: 'desired_count', label: 'Desired count', type: 'number' },
    { key: 'launch_type', label: 'Launch type', type: 'select', options: ['FARGATE', 'EC2'] },
  ]),
  service('eks', 'EKS', 'EKS', 'Compute', 'Network', '#2563eb', ['API'], ['Pods', 'Logs'], 'aws_eks_cluster', { name: '', role_arn: '', version: '', subnet_ids: '' }, [
    ...commonFields,
    nameField,
    { key: 'role_arn', label: 'Cluster role ARN', type: 'text' },
    { key: 'version', label: 'Kubernetes version', type: 'text' },
    { key: 'subnet_ids', label: 'Subnet IDs expression', type: 'text' },
  ]),
  service('beanstalk', 'Elastic Beanstalk', 'EB', 'Compute', 'Sprout', '#65a30d', ['HTTP'], ['App'], 'aws_elastic_beanstalk_environment', { name: '', application: '', solution_stack_name: '', tier: '' }, [
    ...commonFields,
    nameField,
    { key: 'application', label: 'Application name', type: 'text' },
    { key: 'solution_stack_name', label: 'Solution stack', type: 'text' },
    { key: 'tier', label: 'Tier', type: 'text' },
  ]),
  service('vpc', 'VPC', 'VPC', 'Networking', 'Globe2', '#2563eb', ['CIDR'], ['Subnets'], 'aws_vpc', { name: '', cidr_block: '', enable_dns_hostnames: '', enable_dns_support: '' }, [
    ...commonFields,
    nameField,
    { key: 'cidr_block', label: 'CIDR block', type: 'text' },
    { key: 'enable_dns_hostnames', label: 'DNS hostnames', type: 'select', options: booleanOptions },
    { key: 'enable_dns_support', label: 'DNS support', type: 'select', options: booleanOptions },
  ]),
  service('subnet', 'Subnet', 'Subnet', 'Networking', 'Network', '#16a34a', ['VPC'], ['ENI', 'Route'], 'aws_subnet', { name: '', vpc_id: '', cidr_block: '', availability_zone: '', map_public_ip_on_launch: '' }, [
    ...commonFields,
    nameField,
    { key: 'vpc_id', label: 'VPC ID expression', type: 'text' },
    { key: 'cidr_block', label: 'CIDR block', type: 'text' },
    { key: 'availability_zone', label: 'Availability zone', type: 'text' },
    { key: 'map_public_ip_on_launch', label: 'Auto-assign public IP', type: 'select', options: booleanOptions },
  ]),
  service('igw', 'Internet Gateway', 'IGW', 'Networking', 'Router', '#0891b2', ['VPC'], ['Internet'], 'aws_internet_gateway', { name: '', vpc_id: '' }, [
    ...commonFields,
    nameField,
    { key: 'vpc_id', label: 'VPC ID expression', type: 'text' },
  ]),
  service('route-table', 'Route Table', 'RT', 'Networking', 'Map', '#0f766e', ['VPC'], ['Routes'], 'aws_route_table', { name: '', vpc_id: '' }, [
    ...commonFields,
    nameField,
    { key: 'vpc_id', label: 'VPC ID expression', type: 'text' },
  ]),
  service('route', 'Route', 'Route', 'Networking', 'Route', '#0f766e', ['Route table'], ['Target'], 'aws_route', { route_table_id: '', destination_cidr_block: '0.0.0.0/0', gateway_id: '' }, [
    ...commonFields,
    { key: 'route_table_id', label: 'Route table ID expression', type: 'text' },
    { key: 'destination_cidr_block', label: 'Destination CIDR', type: 'text' },
    { key: 'gateway_id', label: 'Gateway ID expression', type: 'text' },
  ]),
  service('route-association', 'Route Association', 'RTA', 'Networking', 'Link2', '#14b8a6', ['Subnet', 'Route table'], ['Association'], 'aws_route_table_association', { subnet_id: '', route_table_id: '' }, [
    ...commonFields,
    { key: 'subnet_id', label: 'Subnet ID expression', type: 'text' },
    { key: 'route_table_id', label: 'Route table ID expression', type: 'text' },
  ]),
  service('security-group', 'Security Group', 'SG', 'Security', 'Shield', '#dc2626', ['VPC'], ['Rules'], 'aws_security_group', { name: '', description: '', vpc_id: '', ingress_ports: '', ingress_cidr_blocks: '', egress_cidr_blocks: '0.0.0.0/0' }, [
    ...commonFields,
    nameField,
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'vpc_id', label: 'VPC ID expression', type: 'text' },
    { key: 'ingress_ports', label: 'Ingress TCP ports', type: 'text' },
    { key: 'ingress_cidr_blocks', label: 'Ingress CIDR blocks', type: 'text' },
    { key: 'egress_cidr_blocks', label: 'Egress CIDR blocks', type: 'text' },
  ]),
  service('alb', 'ALB/NLB', 'LB', 'Networking', 'GitBranch', '#0ea5e9', ['HTTP', 'TCP'], ['Target'], 'aws_lb', { name: '', load_balancer_type: '', subnets: '', security_groups: '', internal: '' }, [
    ...commonFields,
    nameField,
    { key: 'load_balancer_type', label: 'Load balancer type', type: 'select', options: ['application', 'network', 'gateway'] },
    { key: 'subnets', label: 'Subnets expression', type: 'text' },
    { key: 'security_groups', label: 'Security groups expression', type: 'text' },
    { key: 'internal', label: 'Internal', type: 'select', options: booleanOptions },
  ]),
  service('lb-target-group', 'Target Group', 'TG', 'Networking', 'Crosshair', '#0284c7', ['Traffic'], ['Targets'], 'aws_lb_target_group', { name: '', port: '', protocol: '', vpc_id: '' }, [
    ...commonFields,
    nameField,
    { key: 'port', label: 'Port', type: 'number' },
    { key: 'protocol', label: 'Protocol', type: 'select', options: loadBalancerProtocols },
    { key: 'vpc_id', label: 'VPC ID expression', type: 'text' },
  ]),
  service('lb-target-attachment', 'Target Attachment', 'Attach', 'Networking', 'PlugZap', '#0369a1', ['Target group', 'Instance'], ['Registered target'], 'aws_lb_target_group_attachment', { target_group_arn: '', target_id: '', port: '' }, [
    ...commonFields,
    { key: 'target_group_arn', label: 'Target group ARN expression', type: 'text' },
    { key: 'target_id', label: 'Target ID expression', type: 'text' },
    { key: 'port', label: 'Port', type: 'number' },
  ]),
  service('lb-listener', 'Load Balancer Listener', 'Listener', 'Networking', 'RadioTower', '#38bdf8', ['Load balancer'], ['Target group'], 'aws_lb_listener', { load_balancer_arn: '', port: '', protocol: '', target_group_arn: '' }, [
    ...commonFields,
    { key: 'load_balancer_arn', label: 'Load balancer ARN expression', type: 'text' },
    { key: 'port', label: 'Port', type: 'number' },
    { key: 'protocol', label: 'Protocol', type: 'select', options: loadBalancerProtocols },
    { key: 'target_group_arn', label: 'Target group ARN expression', type: 'text' },
  ]),
  service('apigw', 'API Gateway', 'API', 'Networking', 'Webhook', '#8b5cf6', ['Client'], ['Route'], 'aws_api_gateway_rest_api', { name: '', protocol_type: '' }, [
    ...commonFields,
    nameField,
    { key: 'protocol_type', label: 'Protocol type', type: 'select', options: apiProtocols },
  ]),
  service('cloudfront', 'CloudFront', 'CDN', 'Networking', 'RadioTower', '#38bdf8', ['Viewer'], ['Origin'], 'aws_cloudfront_distribution', { enabled: '', comment: '', default_root_object: '', price_class: '' }, [
    ...commonFields,
    { key: 'enabled', label: 'Enabled', type: 'select', options: booleanOptions },
    { key: 'comment', label: 'Comment', type: 'text' },
    { key: 'default_root_object', label: 'Default root object', type: 'text' },
    { key: 'price_class', label: 'Price class', type: 'select', options: ['PriceClass_100', 'PriceClass_200', 'PriceClass_All'] },
  ]),
  service('route53', 'Route 53', 'DNS', 'Networking', 'MapPin', '#16a34a', ['Domain'], ['Record'], 'aws_route53_record', { zone_id: '', name: '', type: '', ttl: '', records: '' }, [
    ...commonFields,
    { key: 'zone_id', label: 'Hosted zone ID', type: 'text' },
    nameField,
    { key: 'type', label: 'Record type', type: 'select', options: ['A', 'AAAA', 'CNAME', 'TXT', 'MX'] },
    { key: 'ttl', label: 'TTL', type: 'number' },
    { key: 'records', label: 'Records expression', type: 'text' },
  ]),
  service('waf', 'WAF', 'WAF', 'Networking', 'Shield', '#dc2626', ['Traffic'], ['Filtered'], 'aws_wafv2_web_acl', { name: '', scope: '', default_action: '', metric_name: '' }, [
    ...commonFields,
    nameField,
    { key: 'scope', label: 'Scope', type: 'select', options: ['REGIONAL', 'CLOUDFRONT'] },
    { key: 'default_action', label: 'Default action', type: 'select', options: ['allow', 'block'] },
    { key: 'metric_name', label: 'CloudWatch metric name', type: 'text' },
  ]),
  service('nat', 'NAT Gateway', 'NAT', 'Networking', 'Router', '#0891b2', ['Private'], ['Internet'], 'aws_nat_gateway', { allocation_id: '', subnet_id: '', connectivity_type: '' }, [
    ...commonFields,
    { key: 'allocation_id', label: 'Allocation ID', type: 'text' },
    { key: 'subnet_id', label: 'Subnet ID', type: 'text' },
    { key: 'connectivity_type', label: 'Connectivity type', type: 'select', options: ['public', 'private'] },
  ]),
  service('s3', 'S3', 'S3', 'Storage', 'HardDrive', '#16a34a', ['Object'], ['Event', 'Object'], 'aws_s3_bucket', { bucket: '', versioning: '' }, [
    ...commonFields,
    { key: 'bucket', label: 'Bucket name', type: 'text' },
    { key: 'versioning', label: 'Versioning status', type: 'select', options: versioningStatuses },
  ]),
  service('efs', 'EFS', 'EFS', 'Storage', 'DatabaseZap', '#059669', ['Mount'], ['Files'], 'aws_efs_file_system', { creation_token: '', encrypted: '', performance_mode: '', throughput_mode: '' }, [
    ...commonFields,
    { key: 'creation_token', label: 'Creation token', type: 'text' },
    { key: 'encrypted', label: 'Encrypted', type: 'select', options: booleanOptions },
    { key: 'performance_mode', label: 'Performance mode', type: 'select', options: ['generalPurpose', 'maxIO'] },
    { key: 'throughput_mode', label: 'Throughput mode', type: 'select', options: ['bursting', 'provisioned', 'elastic'] },
  ]),
  service('ebs', 'EBS', 'EBS', 'Storage', 'Disc3', '#22c55e', ['Attach'], ['Volume'], 'aws_ebs_volume', { availability_zone: '', size: '', type: '', encrypted: '' }, [
    ...commonFields,
    { key: 'availability_zone', label: 'Availability zone', type: 'text' },
    { key: 'size', label: 'Size GB', type: 'number' },
    { key: 'type', label: 'Volume type', type: 'select', options: ['gp3', 'gp2', 'io1', 'io2', 'st1', 'sc1'] },
    { key: 'encrypted', label: 'Encrypted', type: 'select', options: booleanOptions },
  ]),
  service('rds', 'RDS', 'RDS', 'DB', 'Database', '#2563eb', ['SQL'], ['Replica', 'Metrics'], 'aws_db_instance', { identifier: '', engine: '', instance_class: '', allocated_storage: '', username: '', password: '', db_name: '', skip_final_snapshot: '' }, [
    ...commonFields,
    { key: 'identifier', label: 'DB identifier', type: 'text' },
    { key: 'engine', label: 'Engine', type: 'select', options: dbEngines },
    { key: 'instance_class', label: 'Instance class', type: 'text' },
    { key: 'allocated_storage', label: 'Allocated storage GB', type: 'number' },
    { key: 'username', label: 'Master username', type: 'text' },
    { key: 'password', label: 'Master password', type: 'text' },
    { key: 'db_name', label: 'Database name', type: 'text' },
    { key: 'skip_final_snapshot', label: 'Skip final snapshot', type: 'select', options: booleanOptions },
  ]),
  service('docdb-subnet-group', 'DocumentDB Subnet Group', 'DocDB SG', 'DB', 'Network', '#0f766e', ['Subnets'], ['DocumentDB'], 'aws_docdb_subnet_group', { name: '', subnet_ids: '' }, [
    ...commonFields,
    nameField,
    { key: 'subnet_ids', label: 'Subnet IDs expression', type: 'text' },
  ]),
  service('docdb', 'DocumentDB Cluster', 'DocDB', 'DB', 'Database', '#2563eb', ['App'], ['Documents'], 'aws_docdb_cluster', { cluster_identifier: '', engine: '', db_subnet_group_name: '', vpc_security_group_ids: '', master_username: '', master_password: '' }, [
    ...commonFields,
    { key: 'cluster_identifier', label: 'Cluster identifier', type: 'text' },
    { key: 'engine', label: 'Engine', type: 'select', options: documentDbEngines },
    { key: 'db_subnet_group_name', label: 'Subnet group expression', type: 'text' },
    { key: 'vpc_security_group_ids', label: 'Security group IDs expression', type: 'text' },
    { key: 'master_username', label: 'Master username', type: 'text' },
    { key: 'master_password', label: 'Master password', type: 'text' },
  ]),
  service('docdb-instance', 'DocumentDB Instance', 'DocDB I', 'DB', 'DatabaseBackup', '#1d4ed8', ['Cluster'], ['Instance'], 'aws_docdb_cluster_instance', { identifier: '', cluster_identifier: '', instance_class: '', engine: '' }, [
    ...commonFields,
    { key: 'identifier', label: 'Instance identifier', type: 'text' },
    { key: 'cluster_identifier', label: 'Cluster identifier expression', type: 'text' },
    { key: 'instance_class', label: 'Instance class', type: 'text' },
    { key: 'engine', label: 'Engine', type: 'select', options: documentDbEngines },
  ]),
  service('dynamodb', 'DynamoDB', 'DDB', 'DB', 'Table2', '#1d4ed8', ['Item'], ['Stream'], 'aws_dynamodb_table', { name: '', billing_mode: '', hash_key: '', hash_key_type: '', read_capacity: '', write_capacity: '' }, [
    ...commonFields,
    nameField,
    { key: 'billing_mode', label: 'Billing mode', type: 'select', options: ['PAY_PER_REQUEST', 'PROVISIONED'] },
    { key: 'hash_key', label: 'Hash key', type: 'text' },
    { key: 'hash_key_type', label: 'Hash key type', type: 'select', options: ['S', 'N', 'B'] },
    { key: 'read_capacity', label: 'Read capacity', type: 'number' },
    { key: 'write_capacity', label: 'Write capacity', type: 'number' },
  ]),
  service('elasticache', 'ElastiCache', 'Cache', 'DB', 'MemoryStick', '#dc2626', ['TCP'], ['Cache'], 'aws_elasticache_cluster', { cluster_id: '', engine: '', node_type: '', num_cache_nodes: '', port: '' }, [
    ...commonFields,
    { key: 'cluster_id', label: 'Cluster ID', type: 'text' },
    { key: 'engine', label: 'Engine', type: 'select', options: ['redis', 'memcached'] },
    { key: 'node_type', label: 'Node type', type: 'text' },
    { key: 'num_cache_nodes', label: 'Cache nodes', type: 'number' },
    { key: 'port', label: 'Port', type: 'number' },
  ]),
  service('redshift', 'Redshift', 'RS', 'DB', 'ChartNoAxesCombined', '#7c3aed', ['SQL'], ['Query'], 'aws_redshift_cluster', { cluster_identifier: '', node_type: '', master_username: '', master_password: '', database_name: '' }, [
    ...commonFields,
    { key: 'cluster_identifier', label: 'Cluster identifier', type: 'text' },
    { key: 'node_type', label: 'Node type', type: 'text' },
    { key: 'master_username', label: 'Master username', type: 'text' },
    { key: 'master_password', label: 'Master password', type: 'text' },
    { key: 'database_name', label: 'Database name', type: 'text' },
  ]),
  service('sqs', 'SQS', 'SQS', 'Messaging', 'Inbox', '#c026d3', ['Message'], ['Consumer'], 'aws_sqs_queue', { name: '', fifo_queue: '', visibility_timeout_seconds: '', message_retention_seconds: '' }, [
    ...commonFields,
    nameField,
    { key: 'fifo_queue', label: 'FIFO queue', type: 'select', options: booleanOptions },
    { key: 'visibility_timeout_seconds', label: 'Visibility timeout seconds', type: 'number' },
    { key: 'message_retention_seconds', label: 'Retention seconds', type: 'number' },
  ]),
  service('sns', 'SNS', 'SNS', 'Messaging', 'BellRing', '#db2777', ['Publish'], ['Topic'], 'aws_sns_topic', { name: '', display_name: '' }, [
    ...commonFields,
    nameField,
    { key: 'display_name', label: 'Display name', type: 'text' },
  ]),
  service('eventbridge', 'EventBridge', 'EVB', 'Messaging', 'CalendarClock', '#9333ea', ['Event'], ['Rule'], 'aws_cloudwatch_event_rule', { name: '', event_pattern: '', schedule_expression: '' }, [
    ...commonFields,
    nameField,
    { key: 'event_pattern', label: 'Event pattern expression', type: 'text' },
    { key: 'schedule_expression', label: 'Schedule expression', type: 'text' },
  ]),
  service('kinesis', 'Kinesis', 'KIN', 'Messaging', 'Activity', '#7c2d12', ['Record'], ['Shard'], 'aws_kinesis_stream', { name: '', shard_count: '', retention_period: '' }, [
    ...commonFields,
    nameField,
    { key: 'shard_count', label: 'Shard count', type: 'number' },
    { key: 'retention_period', label: 'Retention hours', type: 'number' },
  ]),
  service('iam', 'IAM Role', 'IAM', 'Security', 'KeyRound', '#d97706', ['Assume'], ['Policy'], 'aws_iam_role', { name: '', assume_role_policy: '' }, [
    ...commonFields,
    nameField,
    { key: 'assume_role_policy', label: 'Assume role policy expression', type: 'text' },
  ]),
  service('secrets', 'Secrets Manager', 'Secret', 'Security', 'LockKeyhole', '#b45309', ['Read'], ['Secret'], 'aws_secretsmanager_secret', { name: '', description: '', recovery_window_in_days: '' }, [
    ...commonFields,
    nameField,
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'recovery_window_in_days', label: 'Recovery window days', type: 'number' },
  ]),
  service('kms', 'KMS', 'KMS', 'Security', 'KeySquare', '#ca8a04', ['Encrypt'], ['Key'], 'aws_kms_key', { description: '', key_usage: '', deletion_window_in_days: '', enable_key_rotation: '' }, [
    ...commonFields,
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'key_usage', label: 'Key usage', type: 'select', options: ['ENCRYPT_DECRYPT', 'SIGN_VERIFY', 'GENERATE_VERIFY_MAC'] },
    { key: 'deletion_window_in_days', label: 'Deletion window days', type: 'number' },
    { key: 'enable_key_rotation', label: 'Enable key rotation', type: 'select', options: booleanOptions },
  ]),
  service('cognito', 'Cognito', 'Auth', 'Security', 'UsersRound', '#0891b2', ['User'], ['Token'], 'aws_cognito_user_pool', { name: '', mfa_configuration: '' }, [
    ...commonFields,
    nameField,
    { key: 'mfa_configuration', label: 'MFA configuration', type: 'select', options: ['OFF', 'ON', 'OPTIONAL'] },
  ]),
  service('codepipeline', 'CodePipeline', 'Pipe', 'DevOps', 'Workflow', '#475569', ['Source'], ['Deploy'], 'aws_codepipeline', { name: '', role_arn: '', pipeline_type: '' }, [
    ...commonFields,
    nameField,
    { key: 'role_arn', label: 'Pipeline role ARN', type: 'text' },
    { key: 'pipeline_type', label: 'Pipeline type', type: 'select', options: ['V1', 'V2'] },
  ]),
  service('codebuild', 'CodeBuild', 'Build', 'DevOps', 'Hammer', '#334155', ['Repo'], ['Image'], 'aws_codebuild_project', { name: '', service_role: '', compute_type: '', image: '', type: '' }, [
    ...commonFields,
    nameField,
    { key: 'service_role', label: 'Service role ARN', type: 'text' },
    { key: 'compute_type', label: 'Compute type', type: 'text' },
    { key: 'image', label: 'Build image', type: 'text' },
    { key: 'type', label: 'Environment type', type: 'text' },
  ]),
  service('ecr', 'ECR', 'ECR', 'DevOps', 'Package', '#0f766e', ['Image'], ['Pull'], 'aws_ecr_repository', { name: '', image_tag_mutability: '', scan_on_push: '' }, [
    ...commonFields,
    nameField,
    { key: 'image_tag_mutability', label: 'Image tag mutability', type: 'select', options: ['MUTABLE', 'IMMUTABLE'] },
    { key: 'scan_on_push', label: 'Scan on push', type: 'select', options: booleanOptions },
  ]),
  service('cloudwatch', 'CloudWatch', 'CW', 'Analytics', 'LineChart', '#0284c7', ['Metric', 'Log'], ['Alarm'], 'aws_cloudwatch_metric_alarm', { alarm_name: '', comparison_operator: '', evaluation_periods: '', metric_name: '', namespace: '', period: '', statistic: '', threshold: '' }, [
    ...commonFields,
    { key: 'alarm_name', label: 'Alarm name', type: 'text' },
    { key: 'comparison_operator', label: 'Comparison operator', type: 'text' },
    { key: 'evaluation_periods', label: 'Evaluation periods', type: 'number' },
    { key: 'metric_name', label: 'Metric name', type: 'text' },
    { key: 'namespace', label: 'Namespace', type: 'text' },
    { key: 'period', label: 'Period seconds', type: 'number' },
    { key: 'statistic', label: 'Statistic', type: 'text' },
    { key: 'threshold', label: 'Threshold', type: 'number' },
  ]),
  service('xray', 'X-Ray', 'Trace', 'Analytics', 'ScanSearch', '#7c3aed', ['Trace'], ['Segment'], 'aws_xray_group', { group_name: '', filter_expression: '' }, [
    ...commonFields,
    { key: 'group_name', label: 'Group name', type: 'text' },
    { key: 'filter_expression', label: 'Filter expression', type: 'text' },
  ]),
];

export const categories = ['Compute', 'Networking', 'Storage', 'DB', 'Messaging', 'Security', 'DevOps', 'Analytics'] as const;

export const serviceById = Object.fromEntries(awsServices.map((svc) => [svc.id, svc])) as Record<string, AwsService>;

function service(
  id: string,
  name: string,
  shortName: string,
  category: AwsService['category'],
  icon: string,
  color: string,
  inputs: string[],
  outputs: string[],
  terraformType: string,
  defaultConfig: Record<string, string | number>,
  fields = commonFields,
): AwsService {
  return {
    id,
    name,
    shortName,
    category,
    icon,
    color,
    subLabel: 'ap-south-1',
    ports: { inputs, outputs },
    fields,
    terraformType,
    defaultConfig: { region: 'ap-south-1', status: 'running', ...defaultConfig },
  };
}
