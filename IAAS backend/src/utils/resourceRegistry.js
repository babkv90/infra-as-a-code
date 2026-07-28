import { readFileSync } from 'node:fs';

const registry = JSON.parse(readSharedResourceRegistry());

function readSharedResourceRegistry() {
  const candidates = [
    new URL('../../shared/resourceRegistry.json', import.meta.url),
    new URL('../../../shared/resourceRegistry.json', import.meta.url),
  ];

  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  return readFileSync(candidates[0], 'utf8');
}

export const resourceRegistry = registry.resources;

export function getResourceRegistryEntry(serviceId) {
  return serviceId ? resourceRegistry[serviceId] : undefined;
}

export function terraformTypeForService(serviceId) {
  return getResourceRegistryEntry(serviceId)?.terraformType;
}

export function outputAttributesForService(serviceId) {
  return getResourceRegistryEntry(serviceId)?.outputs ?? ['id', 'arn'];
}

export function edgeResolvableFieldsForService(serviceId) {
  return getResourceRegistryEntry(serviceId)?.edgeResolvable ?? {};
}

export function deployableServiceIds() {
  return Object.keys(resourceRegistry);
}
