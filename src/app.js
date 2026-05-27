import { readJson, sendJson, sendText, getRequestAuthHeader, getOrgHeader, isHttpError, errorBody } from './http.js';
import { DEFAULT_DOWNSTREAM_MODELS } from './config.js';
import {
  buildGmiSubmitRequest,
  toOpenAIVideoResponse,
  toVolcTaskResponse
} from './mapper.js';

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function corsHeaders(config) {
  if (!config.cors) return {};
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-organization-id'
  };
}

function sendWithCors(req, res, config, status, body, headers = {}) {
  sendJson(res, status, body, { ...corsHeaders(config), ...headers });
}

function extractTaskId(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return '';
  const rest = pathname.slice(prefix.length);
  const taskId = rest.split('/')[0];
  return decodeURIComponent(taskId || '');
}

function upstreamContext(req, config) {
  return {
    authHeader: getRequestAuthHeader(req, config),
    orgId: getOrgHeader(req, config)
  };
}

function upstreamErrorBody(upstreamResponse) {
  if (upstreamResponse.json) return upstreamResponse.json;
  return {
    error: {
      message: upstreamResponse.text || 'upstream request failed',
      type: 'gmi_cloud_error',
      code: 'gmi_cloud_error'
    }
  };
}

async function ensureUpstreamOk(res, config, upstreamResponse) {
  if (upstreamResponse.ok) return true;
  sendWithCors(null, res, config, upstreamResponse.status, upstreamErrorBody(upstreamResponse));
  return false;
}

async function saveSubmittedTask(store, id, buildResult, gmiJson, source, rawBody) {
  await store.upsert(id, {
    source,
    downstreamModel: buildResult.downstreamModel,
    upstreamModel: buildResult.upstreamModel,
    payload: buildResult.payload,
    gmiCreatedAt: gmiJson.created_at,
    createdAtUnix: nowUnix(),
    tools: rawBody.tools
  });
}

async function submitVolcTask(req, res, { config, store, upstream }) {
  const rawBody = await readJson(req);
  const buildResult = buildGmiSubmitRequest(rawBody, config);
  const upstreamResponse = await upstream.submit(buildResult.gmiBody, upstreamContext(req, config));
  if (!(await ensureUpstreamOk(res, config, upstreamResponse))) return;

  const gmi = upstreamResponse.json;
  const id = gmi?.request_id || gmi?.id;
  if (!id) {
    sendWithCors(req, res, config, 502, {
      error: {
        message: 'GMICloud submit response did not contain request_id',
        type: 'invalid_upstream_response',
        code: 'invalid_upstream_response'
      }
    });
    return;
  }

  await saveSubmittedTask(store, id, buildResult, gmi, 'volc', rawBody);
  sendWithCors(req, res, config, 200, {
    id,
    request_id: id,
    model: buildResult.downstreamModel,
    status: 'queued',
    created_at: gmi.created_at || nowUnix(),
    updated_at: gmi.updated_at || gmi.created_at || nowUnix()
  });
}

async function fetchVolcTask(req, res, taskId, { config, store, upstream }) {
  const upstreamResponse = await upstream.getRequest(taskId, upstreamContext(req, config));
  if (!(await ensureUpstreamOk(res, config, upstreamResponse))) return;

  const record = store.get(taskId);
  const body = toVolcTaskResponse(upstreamResponse.json, record, config);
  await store.upsert(taskId, {
    ...(record || {}),
    lastStatus: body.status,
    lastVideoUrl: body.content?.video_url || ''
  });
  sendWithCors(req, res, config, 200, body);
}

async function submitOpenAIVideo(req, res, { config, store, upstream }) {
  const rawBody = await readJson(req);
  const buildResult = buildGmiSubmitRequest(rawBody, config);
  const upstreamResponse = await upstream.submit(buildResult.gmiBody, upstreamContext(req, config));
  if (!(await ensureUpstreamOk(res, config, upstreamResponse))) return;

  const gmi = upstreamResponse.json;
  const id = gmi?.request_id || gmi?.id;
  if (!id) {
    sendWithCors(req, res, config, 502, {
      error: {
        message: 'GMICloud submit response did not contain request_id',
        type: 'invalid_upstream_response',
        code: 'invalid_upstream_response'
      }
    });
    return;
  }

  await saveSubmittedTask(store, id, buildResult, gmi, 'openai-video', rawBody);
  sendWithCors(req, res, config, 200, toOpenAIVideoResponse({ ...gmi, status: gmi.status || 'queued' }, store.get(id), config));
}

async function fetchOpenAIVideo(req, res, taskId, { config, store, upstream }) {
  const upstreamResponse = await upstream.getRequest(taskId, upstreamContext(req, config));
  if (!(await ensureUpstreamOk(res, config, upstreamResponse))) return;

  const record = store.get(taskId);
  const body = toOpenAIVideoResponse(upstreamResponse.json, record, config);
  await store.upsert(taskId, {
    ...(record || {}),
    lastStatus: body.status,
    lastVideoUrl: body.metadata?.url || ''
  });
  sendWithCors(req, res, config, 200, body);
}

async function redirectVideoContent(req, res, taskId, deps) {
  const { config, store, upstream } = deps;
  const upstreamResponse = await upstream.getRequest(taskId, upstreamContext(req, config));
  if (!(await ensureUpstreamOk(res, config, upstreamResponse))) return;

  const record = store.get(taskId);
  const body = toOpenAIVideoResponse(upstreamResponse.json, record, config);
  const url = body.metadata?.url;
  if (!url) {
    sendWithCors(req, res, config, 404, {
      error: {
        message: 'video content is not available yet',
        type: 'not_ready',
        code: 'not_ready'
      }
    });
    return;
  }
  res.writeHead(302, {
    location: url,
    ...corsHeaders(config)
  });
  res.end();
}

async function nativeGmiProxy(req, res, url, deps) {
  const { config, store, upstream } = deps;
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readJson(req);
  const upstreamResponse = await upstream.request(`${url.pathname}${url.search}`, {
    method: req.method,
    body,
    ...upstreamContext(req, config)
  });

  if (req.method === 'POST' && url.pathname === '/api/v1/ie/requestqueue/apikey/requests' && upstreamResponse.ok) {
    const id = upstreamResponse.json?.request_id || upstreamResponse.json?.id;
    if (id) {
      await store.upsert(id, {
        source: 'gmi-native',
        downstreamModel: body?.model,
        upstreamModel: body?.model,
        payload: body?.payload,
        gmiCreatedAt: upstreamResponse.json?.created_at,
        createdAtUnix: nowUnix()
      });
    }
  }

  if (upstreamResponse.json) {
    sendWithCors(req, res, config, upstreamResponse.status, upstreamResponse.json);
  } else {
    sendText(res, upstreamResponse.status, upstreamResponse.text, corsHeaders(config));
  }
}

function listModels(req, res, config) {
  const models = [...new Set([...DEFAULT_DOWNSTREAM_MODELS, ...Object.keys(config.modelMap)])];
  sendWithCors(req, res, config, 200, {
    object: 'list',
    data: models.map((id) => ({
      id,
      object: 'model',
      owned_by: 'gmi-cloud'
    }))
  });
}

export function createServer(deps) {
  const { config } = deps;

  return async function app(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders(config));
        res.end();
        return;
      }

      if (req.method === 'GET' && pathname === '/healthz') {
        sendWithCors(req, res, config, 200, {
          ok: true,
          service: config.serviceName,
          upstream: config.gmiApiBaseUrl,
          modes: ['volcengine-doubao-video', 'openai-video', 'gmi-native-proxy']
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/v1/models') {
        listModels(req, res, config);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/v3/contents/generations/tasks') {
        await submitVolcTask(req, res, deps);
        return;
      }

      if (req.method === 'GET' && pathname.startsWith('/api/v3/contents/generations/tasks/')) {
        await fetchVolcTask(req, res, extractTaskId(pathname, '/api/v3/contents/generations/tasks/'), deps);
        return;
      }

      if (req.method === 'POST' && (pathname === '/v1/video/generations' || pathname === '/v1/videos')) {
        await submitOpenAIVideo(req, res, deps);
        return;
      }

      if (req.method === 'GET' && pathname.startsWith('/v1/video/generations/')) {
        await fetchOpenAIVideo(req, res, extractTaskId(pathname, '/v1/video/generations/'), deps);
        return;
      }

      if (req.method === 'GET' && pathname.startsWith('/v1/videos/') && pathname.endsWith('/content')) {
        const taskId = extractTaskId(pathname, '/v1/videos/');
        await redirectVideoContent(req, res, taskId, deps);
        return;
      }

      if (req.method === 'GET' && pathname.startsWith('/v1/videos/')) {
        await fetchOpenAIVideo(req, res, extractTaskId(pathname, '/v1/videos/'), deps);
        return;
      }

      if (pathname.startsWith('/api/v1/ie/requestqueue/apikey/')) {
        await nativeGmiProxy(req, res, url, deps);
        return;
      }

      sendWithCors(req, res, config, 404, {
        error: {
          message: `route not found: ${req.method} ${pathname}`,
          type: 'not_found',
          code: 'not_found'
        }
      });
    } catch (error) {
      const status = isHttpError(error) ? error.status : 500;
      sendWithCors(req, res, config, status, errorBody(error));
    }
  };
}
