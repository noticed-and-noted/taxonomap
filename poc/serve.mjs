/**
 * A static server for the proof-of-concept pages, with HTTP range requests (Python's http.server has none),
 * so the cube reader fetches slices of files the way it would from Hugging Face's CDN.
 *
 *   node poc/serve.mjs   then open http://127.0.0.1:4324/poc/cubes.html
 *
 * LATENCY_MS=260 delays every response, to stand in for a CDN's round trip. Browser network throttling
 * can't: it hands back parallel responses one at a time, which no HTTP/2 CDN does.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
const PORT = 4324;
const LATENCY_MS = Number(process.env['LATENCY_MS'] ?? 0);
const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.parquet': 'application/vnd.apache.parquet',
};

/** The file a request asks for, or null when it points outside the repo. */
function resolvePath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, `http://${HOST}`).pathname);
  const filePath = path.join(ROOT, pathname);
  return filePath.startsWith(ROOT + path.sep) ? filePath : null;
}

/** The byte range a Range header asks for, or null when it is missing or malformed. */
function parseRange(header, size) {
  const match = RANGE_PATTERN.exec(header ?? '');
  if (!match || (!match[1] && !match[2])) return null;
  const [, startText, endText] = match;
  if (!startText) return { start: Math.max(0, size - Number(endText)), end: size - 1 };
  return { start: Number(startText), end: endText ? Math.min(Number(endText), size - 1) : size - 1 };
}

/** Size of the file, or null when it doesn't exist or isn't a file. */
async function fileSize(filePath) {
  if (!filePath) return null;
  try {
    const info = await stat(filePath);
    return info.isFile() ? info.size : null;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

// The app's dev server runs on another port, so it reads the cubes cross-origin, as it would from
// Hugging Face; a range request is preflighted, and the reader needs Content-Range to see a 206.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
};

/** Send the whole file or the requested range of it. */
async function handle(request, response) {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, CORS_HEADERS).end();
    return;
  }
  if (LATENCY_MS) await delay(LATENCY_MS);
  const filePath = resolvePath(request.url);
  const size = await fileSize(filePath);
  if (size === null) {
    response.writeHead(404, CORS_HEADERS).end('Not found');
    return;
  }

  const headers = {
    ...CORS_HEADERS,
    'Content-Type': CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    // Every run measures real fetches, as a first visit would.
    'Cache-Control': 'no-store',
  };
  const range = parseRange(request.headers.range, size);
  if (request.headers.range && (!range || range.start > range.end)) {
    response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
    return;
  }

  const { start, end } = range ?? { start: 0, end: size - 1 };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  headers['Content-Length'] = String(end - start + 1);
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(filePath, { start, end }).pipe(response);
}

createServer((request, response) => {
  handle(request, response).catch((error) => {
    response.writeHead(500).end('Server error');
    process.stderr.write(`${error.stack}\n`);
  });
}).listen(PORT, HOST, () => {
  process.stdout.write(`Serving the repo at http://${HOST}:${PORT}/poc/cubes.html\n`);
});
