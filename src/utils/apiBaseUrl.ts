const LOCAL_API_BASE_URL = 'http://127.0.0.1:4001/api/v1';
const PRODUCTION_API_BASE_URL = 'https://v72gcv51pi.execute-api.ap-south-1.amazonaws.com/api/v1';
const DEFAULT_API_BASE_URL = import.meta.env.DEV ? LOCAL_API_BASE_URL : PRODUCTION_API_BASE_URL;
const LEGACY_API_GATEWAY_STAGE_NAMES = ['iaasNodestage'];

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

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

export const API_BASE_URL = normalizeApiBaseUrl(configuredApiBaseUrl || DEFAULT_API_BASE_URL);
