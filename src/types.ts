import type { Edge, Node } from 'reactflow';

export type ServiceCategory =
  | 'Compute'
  | 'Networking'
  | 'Storage'
  | 'DB'
  | 'Messaging'
  | 'Security'
  | 'DevOps'
  | 'Analytics';

export type PortType = 'input' | 'output';

export type AwsField = {
  key: string;
  label: string;
  type: 'text' | 'select' | 'number' | 'json' | 'iam-role' | 'file-path';
  options?: string[];
  required?: boolean;
};

export type AwsService = {
  id: string;
  name: string;
  shortName: string;
  category: ServiceCategory;
  icon: string;
  color: string;
  subLabel: string;
  ports: {
    inputs: string[];
    outputs: string[];
  };
  fields: AwsField[];
  terraformType: string;
  defaultConfig: Record<string, string | number>;
};

export type GroupKind = 'Terraform stack' | 'Region' | 'Module' | 'VPC' | 'Availability Zone' | 'Public Subnet' | 'Private Subnet' | 'Security Group';

export type ToolMode = 'select' | 'connect' | 'group' | 'label';

export type DiagramViewMode = 'application-flow' | 'network' | 'security' | 'monitoring' | 'deployment' | 'topology' | 'dependencies';

export type DiagramDetailMode = 'overview' | 'architecture' | 'full-topology';

export type EdgeConnectionType =
  | 'data-flow'
  | 'network-routing'
  | 'security'
  | 'containment'
  | 'dependency'
  | 'monitoring'
  | 'deployment'
  | 'data'
  | 'event';

export type InfrastructureRelationshipType =
  | 'contains'
  | 'deployed_in'
  | 'routes_to'
  | 'attached_to'
  | 'targets'
  | 'depends_on';

export type NodeVisualState = {
  x: number;
  y: number;
  width?: number;
  height?: number;
};

export type NodeInfrastructureState = {
  resourceType?: string;
  boundaryKind?: GroupKind;
  parentId?: string;
  boundaryId?: string;
  regionId?: string;
  vpcId?: string;
  availabilityZoneId?: string;
  subnetId?: string;
};

export type NodeBindingTargetKind = 'env' | 'property' | 'iam' | 'connection';

export type NodeBindingSourceKind = 'secret' | 'ssm' | 'variable' | 'local' | 'resourceAttr' | 'output';

export type NodeBinding = {
  id: string;
  targetPath: string;
  targetKind: NodeBindingTargetKind;
  source: {
    kind: NodeBindingSourceKind;
    id: string;
    attribute?: string;
  };
  required?: boolean;
  sensitive?: boolean;
};

export type AwsNodeData = {
  serviceId?: string;
  serviceName: string;
  label: string;
  region: string;
  arn: string;
  status: 'running' | 'stopped' | 'unknown';
  color: string;
  icon: string;
  subLabel: string;
  ports: {
    inputs: string[];
    outputs: string[];
  };
  config: Record<string, string | number>;
  note?: string;
  warning?: string;
  groupKind?: GroupKind;
  resourceAddress?: string;
  sourcePath?: string;
  resourceCount?: number;
  generated?: boolean;
  bindings?: NodeBinding[];
  visual?: NodeVisualState;
  infrastructure?: NodeInfrastructureState;
};

export type AwsEdgeData = {
  label: string;
  connectionType: EdgeConnectionType;
  protocol: string;
  port: string;
  hiddenCount?: number;
  references?: string[];
  semanticCategory?: Exclude<EdgeConnectionType, 'data' | 'event'>;
  highlighted?: boolean;
  bundleIndex?: number;
  bundleSize?: number;
};

export type AwsNode = Node<AwsNodeData>;
export type AwsEdge = Edge<AwsEdgeData>;

export type DiagramSnapshot = {
  schemaVersion?: number;
  activeRegion?: string;
  nodes: AwsNode[];
  edges: AwsEdge[];
};
