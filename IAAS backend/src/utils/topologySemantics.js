const boundaryKeyByKind = {
  Region: 'regionId',
  VPC: 'vpcId',
  'Availability Zone': 'availabilityZoneId',
  'Public Subnet': 'subnetId',
  'Private Subnet': 'subnetId',
};

export function withTopologySemantics(node, parent) {
  return {
    ...node,
    data: {
      ...node.data,
      visual: nodeVisualState(node),
      infrastructure: nodeInfrastructureState(node, parent),
    },
  };
}

function nodeVisualState(node) {
  return {
    x: node.position?.x ?? 0,
    y: node.position?.y ?? 0,
    width: numberValue(node.width ?? node.style?.width),
    height: numberValue(node.height ?? node.style?.height),
  };
}

function nodeInfrastructureState(node, parent) {
  const current = node.data?.infrastructure ?? {};
  const boundaryKind = node.type === 'groupBox' ? node.data?.groupKind : current.boundaryKind;
  const parentKey = parent?.data?.groupKind ? boundaryKeyByKind[parent.data.groupKind] : undefined;

  return {
    ...current,
    resourceType: node.data?.serviceId ?? current.resourceType,
    boundaryKind,
    parentId: parent?.id,
    boundaryId: parent?.id ?? current.boundaryId,
    ...(parentKey ? { [parentKey]: parent.id } : {}),
  };
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
