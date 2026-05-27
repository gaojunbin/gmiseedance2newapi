import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_MODEL_MAP = {
  'doubao-seedance-2-0-260128': 'seedance-2-0-260128',
  'doubao-seedance-2-0-fast-260128': 'seedance-2-0-fast-260128',
  'seedance-2-0-260128': 'seedance-2-0-260128',
  'seedance-2-0-fast-260128': 'seedance-2-0-fast-260128'
};

export const DEFAULT_DOWNSTREAM_MODELS = Object.keys(DEFAULT_MODEL_MAP);

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be an integer`);
  }
  return parsed;
}

function parseBoolean(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function parseModelMap() {
  const raw = process.env.MODEL_MAP_JSON;
  if (!raw) return { ...DEFAULT_MODEL_MAP };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`MODEL_MAP_JSON is not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MODEL_MAP_JSON must be an object');
  }
  return { ...DEFAULT_MODEL_MAP, ...parsed };
}

function parseNumberMap(name, fallback = {}) {
  const raw = process.env[name];
  if (!raw) return { ...fallback };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be an object`);
  }

  const result = {};
  for (const [key, value] of Object.entries(parsed)) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`${name}.${key} must be a non-negative number`);
    }
    result[key] = n;
  }
  return result;
}

export function loadConfig({ cwd = process.cwd() } = {}) {
  loadDotEnv(path.join(cwd, '.env'));

  const port = parseInteger('PORT', 3001);
  const dataDir = process.env.DATA_DIR || path.join(cwd, 'data');

  return {
    port,
    serviceName: 'gmiseedance2newapi',
    gmiApiBaseUrl: process.env.GMI_API_BASE_URL || 'https://console.gmicloud.ai',
    gmiApiKey: process.env.GMI_API_KEY || '',
    gmiOrgId: process.env.GMI_ORG_ID || '',
    dataDir,
    taskStorePath: path.join(dataDir, 'tasks.json'),
    upstreamTimeoutMs: parseInteger('UPSTREAM_TIMEOUT_MS', 60000),
    modelMap: parseModelMap(),
    defaultModel: process.env.DEFAULT_MODEL || 'seedance-2-0-260128',
    allowSecondImageAsLastFrame: parseBoolean('SECOND_IMAGE_AS_LAST_FRAME', true),
    cors: parseBoolean('ENABLE_CORS', true),
    validationMode: process.env.VALIDATION_MODE || 'strict',
    billingUsageMode: process.env.BILLING_USAGE_MODE || 'duration',
    billingDefaultDuration: parseInteger('BILLING_DEFAULT_DURATION', 5),
    billingResolutionMultipliers: parseNumberMap('BILLING_RESOLUTION_MULTIPLIERS_JSON')
  };
}
