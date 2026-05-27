import { HttpError } from './http.js';

function joinUrl(baseUrl, pathWithQuery) {
  return `${baseUrl.replace(/\/+$/, '')}${pathWithQuery.startsWith('/') ? '' : '/'}${pathWithQuery}`;
}

function parseMaybeJson(text) {
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class GmiClient {
  constructor(config) {
    this.config = config;
  }

  async request(pathWithQuery, { method = 'GET', authHeader = '', orgId = '', body, headers = {} } = {}) {
    if (!authHeader) {
      throw new HttpError(401, 'missing Authorization header or GMI_API_KEY');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.upstreamTimeoutMs);

    const requestHeaders = {
      authorization: authHeader,
      accept: 'application/json',
      ...headers
    };
    if (orgId) {
      requestHeaders['x-organization-id'] = orgId;
    }

    let requestBody;
    if (body !== undefined) {
      requestHeaders['content-type'] = requestHeaders['content-type'] || 'application/json';
      requestBody = typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body);
    }

    try {
      const response = await fetch(joinUrl(this.config.gmiApiBaseUrl, pathWithQuery), {
        method,
        headers: requestHeaders,
        body: requestBody,
        signal: controller.signal
      });
      const text = await response.text();
      return {
        status: response.status,
        ok: response.ok,
        text,
        json: parseMaybeJson(text),
        headers: response.headers
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new HttpError(504, 'GMICloud request timed out');
      }
      throw new HttpError(502, `GMICloud request failed: ${error.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  submit(body, context) {
    return this.request('/api/v1/ie/requestqueue/apikey/requests', {
      method: 'POST',
      body,
      ...context
    });
  }

  getRequest(taskId, context) {
    return this.request(`/api/v1/ie/requestqueue/apikey/requests/${encodeURIComponent(taskId)}`, context);
  }
}
