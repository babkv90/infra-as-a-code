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
  type: 'text' | 'select' | 'number' | 'json' | 'iam-role';
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

export type DiagramViewMode = 'topology' | 'dependencies' | 'security';

export type EdgeConnectionType = 'data' | 'event' | 'security' | 'monitoring';

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
};

export type AwsEdgeData = {
  label: string;
  connectionType: EdgeConnectionType;
  protocol: string;
  port: string;
  hiddenCount?: number;
  references?: string[];
};

export type AwsNode = Node<AwsNodeData>;
export type AwsEdge = Edge<AwsEdgeData>;

export type DiagramSnapshot = {
  nodes: AwsNode[];
  edges: AwsEdge[];
};
