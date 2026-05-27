import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.js';
import { TaskStore } from '../src/store.js';
import { GmiClient } from '../src/upstream.js';
import { createServer } from '../src/app.js';

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function requestJson(baseUrl, pathWithQuery, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${pathWithQuery}`, {
    method,
    headers: {
      authorization: 'Bearer test-key',
      'content-type': 'application/json',
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text ? JSON.parse(text) : null
  };
}

async function buildBridge(upstreamUrl, overrides = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gmiseedance2newapi-'));
  const config = {
    ...loadConfig({ cwd: tmpDir }),
    gmiApiBaseUrl: upstreamUrl,
    gmiApiKey: '',
    taskStorePath: path.join(tmpDir, 'tasks.json'),
    ...overrides
  };
  const store = new TaskStore(config.taskStorePath);
  await store.init();
  const upstream = new GmiClient(config);
  const bridge = await startServer(createServer({ config, store, upstream }));
  return { bridge, store, tmpDir };
}

test('VolcEngine task API submits to GMICloud and preserves explicit zero/false values', async () => {
  const upstreamCalls = [];
  const upstream = await startServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/ie/requestqueue/apikey/requests') {
      const body = await readJson(req);
      upstreamCalls.push({ method: req.method, url: req.url, body, auth: req.headers.authorization });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        request_id: 'gmi-task-1',
        model: body.model,
        status: 'queued',
        created_at: 100,
        updated_at: 100
      }));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/v1/ie/requestqueue/apikey/requests/gmi-task-1') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        request_id: 'gmi-task-1',
        model: 'seedance-2-0-260128',
        status: 'success',
        payload: {
          prompt: 'A cinematic city street',
          duration: 8,
          resolution: '720p',
          ratio: '16:9',
          seed: 0,
          generate_audio: false,
          watermark: false,
          web_search: true
        },
        outcome: {
          video_url: 'https://cdn.example/video.mp4',
          thumbnail_image_url: 'https://cdn.example/thumb.jpg'
        },
        created_at: 100,
        updated_at: 120,
        queued_at: 100
      }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const { bridge } = await buildBridge(upstream.url);
  try {
    const submit = await requestJson(bridge.url, '/api/v3/contents/generations/tasks', {
      method: 'POST',
      body: {
        model: 'doubao-seedance-2-0-260128',
        content: [
          { type: 'image_url', image_url: { url: 'https://cdn.example/first.jpg' } },
          { type: 'text', text: 'A cinematic city street' }
        ],
        duration: 8,
        resolution: '720p',
        ratio: '16:9',
        seed: 0,
        generate_audio: false,
        watermark: false,
        tools: [{ type: 'web_search' }]
      }
    });

    assert.equal(submit.status, 200);
    assert.equal(submit.json.id, 'gmi-task-1');
    assert.equal(upstreamCalls.length, 1);
    assert.equal(upstreamCalls[0].auth, 'Bearer test-key');
    assert.equal(upstreamCalls[0].body.model, 'seedance-2-0-260128');
    assert.deepEqual(upstreamCalls[0].body.payload, {
      prompt: 'A cinematic city street',
      duration: 8,
      resolution: '720p',
      ratio: '16:9',
      seed: 0,
      watermark: false,
      generate_audio: false,
      web_search: true,
      first_frame: 'https://cdn.example/first.jpg'
    });

    const fetched = await requestJson(bridge.url, '/api/v3/contents/generations/tasks/gmi-task-1');
    assert.equal(fetched.status, 200);
    assert.equal(fetched.json.id, 'gmi-task-1');
    assert.equal(fetched.json.model, 'doubao-seedance-2-0-260128');
    assert.equal(fetched.json.status, 'succeeded');
    assert.equal(fetched.json.content.video_url, 'https://cdn.example/video.mp4');
    assert.equal(fetched.json.seed, 0);
    assert.equal(fetched.json.usage.completion_tokens, 8);
    assert.equal(fetched.json.usage.total_tokens, 8);
    assert.equal(fetched.json.usage.tool_usage.web_search, 1);
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test('VolcEngine usage backfill supports resolution multipliers for billing', async () => {
  const upstream = await startServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/api/v1/ie/requestqueue/apikey/requests/gmi-task-3') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        request_id: 'gmi-task-3',
        model: 'seedance-2-0-260128',
        status: 'success',
        payload: {
          prompt: 'A high resolution scene',
          duration: 6,
          resolution: '1080p'
        },
        outcome: {
          video_url: 'https://cdn.example/1080p.mp4'
        },
        created_at: 300,
        updated_at: 330
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const { bridge } = await buildBridge(upstream.url, {
    billingResolutionMultipliers: {
      '1080p': 2
    }
  });
  try {
    const fetched = await requestJson(bridge.url, '/api/v3/contents/generations/tasks/gmi-task-3');
    assert.equal(fetched.status, 200);
    assert.equal(fetched.json.status, 'succeeded');
    assert.equal(fetched.json.usage.completion_tokens, 12);
    assert.equal(fetched.json.usage.total_tokens, 12);
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test('fallback GMI_API_KEY is used when new-api does not send Authorization', async () => {
  let forwardedAuth = '';
  const upstream = await startServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/ie/requestqueue/apikey/requests') {
      forwardedAuth = req.headers.authorization || '';
      const body = await readJson(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        request_id: 'gmi-task-fallback-key',
        model: body.model,
        status: 'queued',
        created_at: 400,
        updated_at: 400
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const { bridge } = await buildBridge(upstream.url, {
    gmiApiKey: 'fallback-key'
  });
  try {
    const response = await fetch(`${bridge.url}/api/v3/contents/generations/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'doubao-seedance-2-0-260128',
        prompt: 'No auth header path'
      })
    });
    assert.equal(response.status, 200);
    assert.equal(forwardedAuth, 'Bearer fallback-key');
  } finally {
    await bridge.close();
    await upstream.close();
  }
});

test('OpenAI video endpoint returns new-api compatible video task objects', async () => {
  const upstream = await startServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/ie/requestqueue/apikey/requests') {
      const body = await readJson(req);
      assert.equal(body.model, 'seedance-2-0-fast-260128');
      assert.equal(body.payload.ratio, '9:16');
      assert.equal(body.payload.resolution, '720p');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        request_id: 'gmi-task-2',
        model: body.model,
        status: 'dispatched',
        created_at: 200,
        updated_at: 200
      }));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/v1/ie/requestqueue/apikey/requests/gmi-task-2') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        request_id: 'gmi-task-2',
        model: 'seedance-2-0-fast-260128',
        status: 'processing',
        payload: { prompt: 'Vertical scene', duration: 5, ratio: '9:16', resolution: '720p' },
        outcome: null,
        created_at: 200,
        updated_at: 201
      }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const { bridge } = await buildBridge(upstream.url);
  try {
    const submit = await requestJson(bridge.url, '/v1/video/generations', {
      method: 'POST',
      body: {
        model: 'doubao-seedance-2-0-fast-260128',
        prompt: 'Vertical scene',
        image: 'https://cdn.example/first.jpg',
        size: '720x1280',
        duration: 5
      }
    });

    assert.equal(submit.status, 200);
    assert.equal(submit.json.id, 'gmi-task-2');
    assert.equal(submit.json.status, 'queued');
    assert.equal(submit.json.model, 'doubao-seedance-2-0-fast-260128');

    const fetched = await requestJson(bridge.url, '/v1/videos/gmi-task-2');
    assert.equal(fetched.status, 200);
    assert.equal(fetched.json.id, 'gmi-task-2');
    assert.equal(fetched.json.status, 'in_progress');
    assert.equal(fetched.json.seconds, '5');
  } finally {
    await bridge.close();
    await upstream.close();
  }
});
