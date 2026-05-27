export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...headers
  });
  res.end(payload);
}

export function sendText(res, status, text, headers = {}) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    ...headers
  });
  res.end(text);
}

export async function readJson(req, maxBytes = 4 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new HttpError(413, 'request body is too large');
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new HttpError(400, `invalid JSON body: ${error.message}`);
  }
}

export function getRequestAuthHeader(req, config) {
  const incoming = req.headers.authorization || req.headers.Authorization;
  if (incoming) return incoming;
  if (config.gmiApiKey) return `Bearer ${config.gmiApiKey}`;
  return '';
}

export function getOrgHeader(req, config) {
  return req.headers['x-organization-id'] || config.gmiOrgId || '';
}

export function isHttpError(error) {
  return error instanceof HttpError || (error && Number.isInteger(error.status));
}

export function errorBody(error) {
  return {
    error: {
      message: error.message || 'internal server error',
      type: 'bridge_error',
      code: error.code || error.name || 'bridge_error',
      details: error.details
    }
  };
}
