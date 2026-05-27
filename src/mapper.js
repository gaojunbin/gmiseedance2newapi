import { HttpError } from './http.js';

const RATIO_VALUES = new Set(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive']);
const RESOLUTION_VALUES = new Set(['480p', '720p', '1080p']);

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function firstDefined(obj, keys) {
  for (const key of keys) {
    if (hasOwn(obj, key) && obj[key] !== undefined && obj[key] !== '') {
      return obj[key];
    }
  }
  return undefined;
}

function toInteger(value, fieldName) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) {
    throw new HttpError(400, `${fieldName} must be an integer`);
  }
  return parsed;
}

function toBoolean(value, fieldName) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  throw new HttpError(400, `${fieldName} must be a boolean`);
}

function mediaUrl(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.url === 'string') return value.url;
  if (typeof value.URL === 'string') return value.URL;
  if (typeof value.uri === 'string') return value.uri;
  return '';
}

function asStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value)) return [mediaUrl(value)].filter(Boolean);
  return value.map(mediaUrl).filter(Boolean);
}

function pushIfPresent(target, value) {
  const url = mediaUrl(value);
  if (url) target.push(url);
}

function extractContent(content) {
  const result = {
    texts: [],
    images: [],
    videos: [],
    audios: []
  };
  if (!Array.isArray(content)) return result;

  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.text === 'string' && item.text.trim()) {
      result.texts.push(item.text.trim());
    }
    pushIfPresent(result.images, item.image_url);
    pushIfPresent(result.videos, item.video_url);
    pushIfPresent(result.audios, item.audio_url);
  }
  return result;
}

function cleanObject(value) {
  if (Array.isArray(value)) {
    return value.map(cleanObject).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') return value;

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    const cleaned = cleanObject(item);
    if (cleaned === undefined) continue;
    if (Array.isArray(cleaned) && cleaned.length === 0) continue;
    output[key] = cleaned;
  }
  return output;
}

function setIfDefined(obj, key, value) {
  if (value !== undefined) obj[key] = value;
}

function parseSize(size) {
  if (!size || typeof size !== 'string') return null;
  const match = size.trim().match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) return null;
  return {
    width: Number.parseInt(match[1], 10),
    height: Number.parseInt(match[2], 10)
  };
}

function gcd(a, b) {
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

function inferRatioFromSize(size) {
  const parsed = parseSize(size);
  if (!parsed) return undefined;
  const d = gcd(parsed.width, parsed.height);
  const ratio = `${parsed.width / d}:${parsed.height / d}`;
  if (RATIO_VALUES.has(ratio)) return ratio;

  const aspect = parsed.width / parsed.height;
  const candidates = [
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4],
    ['1:1', 1],
    ['21:9', 21 / 9]
  ];
  candidates.sort((a, b) => Math.abs(a[1] - aspect) - Math.abs(b[1] - aspect));
  return candidates[0][0];
}

function inferResolutionFromSize(size) {
  const parsed = parseSize(size);
  if (!parsed) return undefined;
  const maxSide = Math.max(parsed.width, parsed.height);
  if (maxSide >= 1700) return '1080p';
  if (maxSide >= 900) return '720p';
  return '480p';
}

function normalizeResolution(value, size) {
  const raw = value || inferResolutionFromSize(size);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const normalized = String(raw).toLowerCase();
  if (!RESOLUTION_VALUES.has(normalized)) {
    throw new HttpError(400, `resolution must be one of ${[...RESOLUTION_VALUES].join(', ')}`);
  }
  return normalized;
}

function normalizeRatio(value, size) {
  const raw = value || inferRatioFromSize(size);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const normalized = String(raw);
  if (!RATIO_VALUES.has(normalized)) {
    throw new HttpError(400, `ratio must be one of ${[...RATIO_VALUES].join(', ')}`);
  }
  return normalized;
}

export function normalizeModel(model, config) {
  const requested = model || config.defaultModel;
  if (config.modelMap[requested]) return config.modelMap[requested];
  if (requested.startsWith('doubao-seedance-')) {
    return requested.replace(/^doubao-/, '');
  }
  return requested;
}

export function reverseModel(upstreamModel, config) {
  for (const [downstream, upstream] of Object.entries(config.modelMap)) {
    if (upstream === upstreamModel && downstream.startsWith('doubao-')) {
      return downstream;
    }
  }
  return upstreamModel;
}

function applyCommonPayloadFields(payload, raw) {
  const size = firstDefined(raw, ['size']);
  const duration = toInteger(firstDefined(raw, ['duration', 'seconds', 'durationSeconds']), 'duration');
  if (duration !== undefined && (duration < 4 || duration > 15)) {
    throw new HttpError(400, 'duration must be between 4 and 15 seconds');
  }

  const seed = toInteger(firstDefined(raw, ['seed']), 'seed');
  if (seed !== undefined && (seed < 0 || seed > 4294967295)) {
    throw new HttpError(400, 'seed must be between 0 and 4294967295');
  }

  setIfDefined(payload, 'duration', duration);
  setIfDefined(payload, 'resolution', normalizeResolution(firstDefined(raw, ['resolution']), size));
  setIfDefined(payload, 'ratio', normalizeRatio(firstDefined(raw, ['ratio', 'aspectRatio', 'aspect_ratio']), size));
  setIfDefined(payload, 'seed', seed);
  setIfDefined(payload, 'watermark', toBoolean(firstDefined(raw, ['watermark']), 'watermark'));
  setIfDefined(payload, 'generate_audio', toBoolean(firstDefined(raw, ['generate_audio', 'generateAudio']), 'generate_audio'));
  setIfDefined(payload, 'web_search', toBoolean(firstDefined(raw, ['web_search', 'webSearch']), 'web_search'));
}

function applyReferenceFields(payload, raw, content, config) {
  const images = [
    ...asStringArray(firstDefined(raw, ['images'])),
    ...content.images
  ];

  const explicitFirst = firstDefined(raw, ['first_frame', 'firstFrame', 'first_frame_image', 'image']);
  const explicitLast = firstDefined(raw, ['last_frame', 'lastFrame', 'last_frame_image', 'tail_frame']);
  const firstFrame = mediaUrl(explicitFirst) || images.shift();
  let lastFrame = mediaUrl(explicitLast);
  if (!lastFrame && config.allowSecondImageAsLastFrame && images.length > 0) {
    lastFrame = images.shift();
  }

  setIfDefined(payload, 'first_frame', firstFrame || undefined);
  setIfDefined(payload, 'last_frame', lastFrame || undefined);

  const referenceImages = [
    ...asStringArray(firstDefined(raw, ['reference_images', 'referenceImages', 'ref_images'])),
    ...images
  ];
  const referenceVideos = [
    ...asStringArray(firstDefined(raw, ['reference_videos', 'referenceVideos', 'ref_videos'])),
    ...content.videos
  ];
  const referenceAudios = [
    ...asStringArray(firstDefined(raw, ['reference_audios', 'referenceAudios', 'ref_audios'])),
    ...content.audios
  ];
  const referenceAssetIds = firstDefined(raw, ['reference_asset_ids', 'referenceAssetIds']);

  if (referenceImages.length) payload.reference_images = referenceImages;
  if (referenceVideos.length) payload.reference_videos = referenceVideos;
  if (referenceAudios.length) payload.reference_audios = referenceAudios;
  if (Array.isArray(referenceAssetIds) && referenceAssetIds.length) {
    payload.reference_asset_ids = referenceAssetIds;
  }
}

function applyToolFields(payload, raw) {
  if (payload.web_search !== undefined) return;
  if (!Array.isArray(raw.tools)) return;
  if (raw.tools.some((tool) => tool && tool.type === 'web_search')) {
    payload.web_search = true;
  }
}

export function buildGmiSubmitRequest(rawBody, config) {
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    throw new HttpError(400, 'request body must be a JSON object');
  }

  const downstreamModel = rawBody.model || config.defaultModel;
  const upstreamModel = normalizeModel(downstreamModel, config);

  if (rawBody.payload && typeof rawBody.payload === 'object' && !Array.isArray(rawBody.payload)) {
    const payload = cleanObject({ ...rawBody.payload });
    if (!payload.prompt || !String(payload.prompt).trim()) {
      throw new HttpError(400, 'payload.prompt is required');
    }
    return {
      downstreamModel,
      upstreamModel,
      gmiBody: {
        model: upstreamModel,
        payload
      },
      payload
    };
  }

  const content = extractContent(rawBody.content);
  const metadata = rawBody.metadata && typeof rawBody.metadata === 'object' ? rawBody.metadata : {};
  const merged = { ...metadata, ...rawBody };
  const prompt = firstDefined(merged, ['prompt']) || content.texts.join('\n');
  if (!prompt || !String(prompt).trim()) {
    throw new HttpError(400, 'prompt is required');
  }

  const payload = {
    prompt: String(prompt).trim()
  };
  applyCommonPayloadFields(payload, merged);
  applyReferenceFields(payload, merged, content, config);
  applyToolFields(payload, rawBody);

  return {
    downstreamModel,
    upstreamModel,
    gmiBody: {
      model: upstreamModel,
      payload: cleanObject(payload)
    },
    payload: cleanObject(payload)
  };
}

export function mapGmiStatusToVolc(status) {
  switch (String(status || '').toLowerCase()) {
    case 'queued':
    case 'pending':
    case 'dispatched':
      return 'queued';
    case 'processing':
    case 'running':
      return 'processing';
    case 'success':
    case 'succeeded':
    case 'completed':
      return 'succeeded';
    case 'failed':
    case 'error':
    case 'cancelled':
    case 'canceled':
      return 'failed';
    default:
      return 'processing';
  }
}

export function mapGmiStatusToOpenAI(status) {
  switch (mapGmiStatusToVolc(status)) {
    case 'queued':
      return 'queued';
    case 'processing':
      return 'in_progress';
    case 'succeeded':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return 'unknown';
  }
}

function errorMessageFromGmi(gmi) {
  if (!gmi) return '';
  if (typeof gmi.error === 'string') return gmi.error;
  if (gmi.error && typeof gmi.error.message === 'string') return gmi.error.message;
  if (typeof gmi.message === 'string') return gmi.message;
  if (typeof gmi.reason === 'string') return gmi.reason;
  return '';
}

function payloadValue(gmi, record, key) {
  if (gmi?.payload && hasOwn(gmi.payload, key)) return gmi.payload[key];
  if (record?.payload && hasOwn(record.payload, key)) return record.payload[key];
  return undefined;
}

function billingUnits(gmi, record, config) {
  if (!config || config.billingUsageMode === 'zero') return 0;
  if (config.billingUsageMode !== 'duration') return 0;

  const rawDuration = payloadValue(gmi, record, 'duration');
  let duration = Number(rawDuration);
  if (!Number.isFinite(duration) || duration <= 0) {
    duration = config.billingDefaultDuration || 5;
  }

  const resolution = payloadValue(gmi, record, 'resolution');
  const multiplier = Number(config.billingResolutionMultipliers?.[resolution] ?? 1);
  const units = duration * (Number.isFinite(multiplier) && multiplier >= 0 ? multiplier : 1);
  return Math.max(0, Math.ceil(units));
}

export function toVolcTaskResponse(gmi, record = null, config = null) {
  const status = mapGmiStatusToVolc(gmi?.status);
  const videoUrl = gmi?.outcome?.video_url || gmi?.outcome?.video || '';
  const errorMessage = errorMessageFromGmi(gmi) || (status === 'failed' ? 'task failed' : '');
  const upstreamModel = gmi?.model || record?.upstreamModel || '';
  const downstreamModel = record?.downstreamModel || (config ? reverseModel(upstreamModel, config) : upstreamModel);
  const usageUnits = status === 'succeeded' ? billingUnits(gmi, record, config) : 0;

  return cleanObject({
    id: gmi?.request_id || gmi?.id || record?.id,
    model: downstreamModel,
    status,
    content: {
      video_url: videoUrl
    },
    seed: payloadValue(gmi, record, 'seed'),
    resolution: payloadValue(gmi, record, 'resolution'),
    duration: payloadValue(gmi, record, 'duration'),
    ratio: payloadValue(gmi, record, 'ratio'),
    framespersecond: payloadValue(gmi, record, 'framespersecond'),
    service_tier: payloadValue(gmi, record, 'service_tier'),
    tools: record?.tools,
    usage: {
      completion_tokens: usageUnits,
      total_tokens: usageUnits,
      tool_usage: {
        web_search: payloadValue(gmi, record, 'web_search') ? 1 : 0
      }
    },
    error: {
      code: status === 'failed' ? 'upstream_failed' : '',
      message: errorMessage
    },
    created_at: gmi?.created_at || record?.gmiCreatedAt,
    updated_at: gmi?.updated_at,
    queued_at: gmi?.queued_at
  });
}

export function toOpenAIVideoResponse(gmi, record = null, config = null) {
  const status = mapGmiStatusToOpenAI(gmi?.status);
  const upstreamModel = gmi?.model || record?.upstreamModel || '';
  const downstreamModel = record?.downstreamModel || (config ? reverseModel(upstreamModel, config) : upstreamModel);
  const videoUrl = gmi?.outcome?.video_url || gmi?.outcome?.video || '';
  const response = cleanObject({
    id: gmi?.request_id || gmi?.id || record?.id,
    task_id: gmi?.request_id || gmi?.id || record?.id,
    object: 'video',
    model: downstreamModel,
    status,
    progress: status === 'completed' || status === 'failed' ? 100 : status === 'in_progress' ? 50 : 0,
    created_at: gmi?.created_at || record?.gmiCreatedAt || record?.createdAtUnix,
    completed_at: status === 'completed' || status === 'failed' ? gmi?.updated_at : undefined,
    seconds: payloadValue(gmi, record, 'duration') !== undefined ? String(payloadValue(gmi, record, 'duration')) : undefined,
    metadata: videoUrl ? { url: videoUrl } : undefined
  });
  if (status === 'failed') {
    response.error = {
      code: 'upstream_failed',
      message: errorMessageFromGmi(gmi) || 'task failed'
    };
  }
  return response;
}
