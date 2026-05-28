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

function toNonNegativeInteger(value, fieldName) {
  const parsed = toInteger(value, fieldName);
  if (parsed !== undefined && parsed < 0) {
    throw new HttpError(400, `${fieldName} must be a non-negative integer`);
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

function normalizeRole(role) {
  const normalized = String(role || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  switch (normalized) {
    case 'firstframe':
    case 'first_frame':
    case 'first_frame_image':
    case 'start_frame':
    case 'start_image':
      return 'first_frame';
    case 'lastframe':
    case 'last_frame':
    case 'last_frame_image':
    case 'tail_frame':
    case 'end_frame':
    case 'end_image':
      return 'last_frame';
    case 'reference':
    case 'reference_image':
    case 'reference_images':
    case 'ref_image':
      return 'reference_image';
    case 'reference_video':
    case 'reference_videos':
    case 'ref_video':
      return 'reference_video';
    case 'reference_audio':
    case 'reference_audios':
    case 'ref_audio':
      return 'reference_audio';
    default:
      return '';
  }
}

function extractContent(content) {
  const result = {
    texts: [],
    images: [],
    firstFrames: [],
    lastFrames: [],
    referenceImages: [],
    videos: [],
    referenceVideos: [],
    audios: [],
    referenceAudios: []
  };
  if (!Array.isArray(content)) return result;

  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.text === 'string' && item.text.trim()) {
      result.texts.push(item.text.trim());
    }

    const role = normalizeRole(item.role);
    const imageUrl = mediaUrl(item.image_url);
    if (imageUrl) {
      if (role === 'first_frame') result.firstFrames.push(imageUrl);
      else if (role === 'last_frame') result.lastFrames.push(imageUrl);
      else if (role === 'reference_image') result.referenceImages.push(imageUrl);
      else result.images.push(imageUrl);
    }

    const videoUrl = mediaUrl(item.video_url);
    if (videoUrl) {
      if (role === 'reference_video') result.referenceVideos.push(videoUrl);
      else result.videos.push(videoUrl);
    }

    const audioUrl = mediaUrl(item.audio_url);
    if (audioUrl) {
      if (role === 'reference_audio') result.referenceAudios.push(audioUrl);
      else result.audios.push(audioUrl);
    }
  }
  return result;
}

function mergeContentArrays(...values) {
  const result = [];
  for (const value of values) {
    if (Array.isArray(value)) result.push(...value);
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

  const frames = toNonNegativeInteger(firstDefined(raw, ['frames']), 'frames');
  const framesPerSecond = toNonNegativeInteger(
    firstDefined(raw, ['framespersecond', 'framesPerSecond', 'frames_per_second', 'fps']),
    'framespersecond'
  );
  const executionExpiresAfter = toNonNegativeInteger(
    firstDefined(raw, ['execution_expires_after', 'executionExpiresAfter']),
    'execution_expires_after'
  );

  setIfDefined(payload, 'duration', duration);
  setIfDefined(payload, 'resolution', normalizeResolution(firstDefined(raw, ['resolution']), size));
  setIfDefined(payload, 'ratio', normalizeRatio(firstDefined(raw, ['ratio', 'aspectRatio', 'aspect_ratio']), size));
  setIfDefined(payload, 'seed', seed);
  setIfDefined(payload, 'frames', frames);
  setIfDefined(payload, 'framespersecond', framesPerSecond);
  setIfDefined(payload, 'service_tier', firstDefined(raw, ['service_tier', 'serviceTier']));
  setIfDefined(payload, 'execution_expires_after', executionExpiresAfter);
  setIfDefined(payload, 'watermark', toBoolean(firstDefined(raw, ['watermark']), 'watermark'));
  setIfDefined(payload, 'generate_audio', toBoolean(firstDefined(raw, ['generate_audio', 'generateAudio']), 'generate_audio'));
  setIfDefined(payload, 'web_search', toBoolean(firstDefined(raw, ['web_search', 'webSearch']), 'web_search'));
  setIfDefined(payload, 'return_last_frame', toBoolean(firstDefined(raw, ['return_last_frame', 'returnLastFrame']), 'return_last_frame'));
  setIfDefined(payload, 'draft', toBoolean(firstDefined(raw, ['draft']), 'draft'));
  setIfDefined(payload, 'camera_fixed', toBoolean(firstDefined(raw, ['camera_fixed', 'cameraFixed']), 'camera_fixed'));
}

function applyReferenceFields(payload, raw, content, config) {
  const images = [
    ...asStringArray(firstDefined(raw, ['images'])),
    ...content.images
  ];
  const firstFrames = [...content.firstFrames];
  const lastFrames = [...content.lastFrames];

  const explicitFirst = firstDefined(raw, ['first_frame', 'firstFrame', 'first_frame_image', 'image']);
  const explicitLast = firstDefined(raw, ['last_frame', 'lastFrame', 'last_frame_image', 'tail_frame']);
  const firstFrame = mediaUrl(explicitFirst) || firstFrames.shift() || images.shift();
  let lastFrame = mediaUrl(explicitLast) || lastFrames.shift();
  if (!lastFrame && config.allowSecondImageAsLastFrame && images.length > 0) {
    lastFrame = images.shift();
  }

  setIfDefined(payload, 'first_frame', firstFrame || undefined);
  setIfDefined(payload, 'last_frame', lastFrame || undefined);

  const referenceImages = [
    ...asStringArray(firstDefined(raw, ['reference_images', 'referenceImages', 'ref_images'])),
    ...content.referenceImages,
    ...images
  ];
  const referenceVideos = [
    ...asStringArray(firstDefined(raw, ['reference_videos', 'referenceVideos', 'ref_videos'])),
    ...content.referenceVideos,
    ...content.videos
  ];
  const referenceAudios = [
    ...asStringArray(firstDefined(raw, ['reference_audios', 'referenceAudios', 'ref_audios'])),
    ...content.referenceAudios,
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

  const metadata = rawBody.metadata && typeof rawBody.metadata === 'object' ? rawBody.metadata : {};
  const content = extractContent(mergeContentArrays(rawBody.content, metadata.content));
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

function firstMediaUrl(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstMediaUrl(item);
      if (url) return url;
    }
    return '';
  }
  const direct = mediaUrl(value);
  if (direct) return direct;
  if (value && typeof value === 'object') {
    for (const key of ['video_url', 'videoUrl', 'image_url', 'imageUrl', 'file_url', 'fileUrl']) {
      if (!hasOwn(value, key)) continue;
      const url = firstMediaUrl(value[key]);
      if (url) return url;
    }
  }
  return '';
}

function mediaFromSources(sources, directKeys, arrayKeys = []) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of directKeys) {
      if (!hasOwn(source, key)) continue;
      const url = firstMediaUrl(source[key]);
      if (url) return url;
    }
    for (const key of arrayKeys) {
      if (!hasOwn(source, key)) continue;
      const url = firstMediaUrl(source[key]);
      if (url) return url;
    }
  }
  return '';
}

function gmiMedia(gmi) {
  const sources = [gmi?.outcome, gmi?.output, gmi?.result, gmi?.response, gmi];
  return {
    videoUrl: mediaFromSources(
      sources,
      ['video_url', 'videoUrl', 'video', 'url', 'uri', 'output_url', 'outputUrl'],
      ['videos', 'video_urls', 'videoUrls', 'outputs', 'files']
    ),
    lastFrameImage: mediaFromSources(
      sources,
      [
        'last_frame_image',
        'lastFrameImage',
        'last_frame_image_url',
        'lastFrameImageUrl',
        'last_frame',
        'lastFrame',
        'thumbnail_image_url',
        'thumbnailImageUrl',
        'thumbnail_url',
        'thumbnailUrl',
        'poster_url',
        'posterUrl',
        'cover_url',
        'coverUrl'
      ],
      ['images', 'thumbnails']
    )
  };
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

  const modelCandidates = [
    gmi?.model,
    record?.upstreamModel,
    record?.downstreamModel ? normalizeModel(record.downstreamModel, config) : undefined,
    record?.downstreamModel
  ].filter(Boolean);
  const modelMultiplier = modelCandidates
    .map((model) => Number(config.billingModelMultipliers?.[model]))
    .find((value) => Number.isFinite(value) && value >= 0);

  const resolution = payloadValue(gmi, record, 'resolution');
  const multiplier = modelMultiplier ?? Number(config.billingResolutionMultipliers?.[resolution] ?? 1);
  const units = duration * (Number.isFinite(multiplier) && multiplier >= 0 ? multiplier : 1);
  return Math.max(0, Math.ceil(units));
}

export function toVolcTaskResponse(gmi, record = null, config = null) {
  const status = mapGmiStatusToVolc(gmi?.status);
  const { videoUrl, lastFrameImage } = gmiMedia(gmi);
  const errorMessage = errorMessageFromGmi(gmi) || (status === 'failed' ? 'task failed' : '');
  const upstreamModel = gmi?.model || record?.upstreamModel || '';
  const downstreamModel = record?.downstreamModel || (config ? reverseModel(upstreamModel, config) : upstreamModel);
  const usageUnits = status === 'succeeded' ? billingUnits(gmi, record, config) : 0;

  return cleanObject({
    id: gmi?.request_id || gmi?.id || record?.id,
    model: downstreamModel,
    status,
    content: {
      video_url: videoUrl,
      last_frame_image: lastFrameImage
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
  const { videoUrl, lastFrameImage } = gmiMedia(gmi);
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
    metadata: videoUrl || lastFrameImage ? { url: videoUrl, last_frame_image: lastFrameImage } : undefined
  });
  if (status === 'failed') {
    response.error = {
      code: 'upstream_failed',
      message: errorMessageFromGmi(gmi) || 'task failed'
    };
  }
  return response;
}
