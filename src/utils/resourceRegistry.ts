import registry from '../../shared/resourceRegistry.json';

export type ResourceRegistryEntry = {
  terraformType: string;
  required?: string[];
  recommended?: string[];
  sensitive?: string[];
  outputs?: string[];
  edgeResolvable?: Record<string, string>;
};

export const resourceRegistry = registry.resources as Record<string, ResourceRegistryEntry>;

export function getResourceRegistryEntry(serviceId?: string): ResourceRegistryEntry | undefined {
  return serviceId ? resourceRegistry[serviceId] : undefined;
}

export function terraformTypeForService(serviceId?: string): string | undefined {
  return getResourceRegistryEntry(serviceId)?.terraformType;
}

export function outputAttributesForService(serviceId?: string): string[] {
  return getResourceRegistryEntry(serviceId)?.outputs ?? ['id', 'arn'];
}

export function edgeResolvableFieldsForService(serviceId?: string): Record<string, string> {
  return getResourceRegistryEntry(serviceId)?.edgeResolvable ?? {};
}
