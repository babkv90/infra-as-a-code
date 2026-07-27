const LOCAL_API_BASE_URL = 'http://127.0.0.1:4001/api/v1';
const PRODUCTION_API_BASE_URL = 'https://cjgutvxvh2.execute-api.ap-south-1.amazonaws.com/api/v1';
const DEFAULT_API_BASE_URL = import.meta.env.DEV ? LOCAL_API_BASE_URL : PRODUCTION_API_BASE_URL;

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

export const API_BASE_URL = (configuredApiBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
