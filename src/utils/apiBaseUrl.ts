const LOCAL_API_BASE_URL = 'http://127.0.0.1:4001/api/v1';
const DEFAULT_API_BASE_URL = import.meta.env.DEV ? LOCAL_API_BASE_URL : '';
const LEGACY_API_GATEWAY_HOSTS: string[] = [];
const LEGACY_API_GATEWAY_STAGE_NAMES = ['iaasNodestage'];

const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || import.meta.env.INFRAFLOW_API_BASE_URL)?.trim();

function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');

  try {
    const url = new URL(trimmed);
    const isExecuteApiHost = /\.execute-api\.[^.]+\.amazonaws\.com$/i.test(url.hostname);
    if (!isExecuteApiHost) return trimmed;

    const pathParts = url.pathname.split('/').filter(Boolean);
    const normalizedParts = LEGACY_API_GATEWAY_STAGE_NAMES.includes(pathParts[0] ?? '')
      ? pathParts.slice(1)
      : pathParts;

    url.pathname = `/${(normalizedParts.length ? normalizedParts : ['api', 'v1']).join('/')}`;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return trimmed;
  }
}

const apiBaseUrl = configuredApiBaseUrl || DEFAULT_API_BASE_URL;

if (!apiBaseUrl) {
  throw new Error('VITE_API_BASE_URL or INFRAFLOW_API_BASE_URL is required for production builds. Set it to the current API Gateway /api/v1 URL.');
}

export const API_BASE_URL = normalizeApiBaseUrl(apiBaseUrl);
