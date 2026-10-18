/** The fake world (world.ts) over HTTP, for the offline build. */
import { createServer, type Server } from 'node:http';
import { answer, FAKE_PORT } from './world.ts';

export function startFake(port = FAKE_PORT): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const out = answer(url) ?? { status: 404, contentType: 'text/plain', body: `fake: nothing at ${url.pathname}` };
    res.writeHead(out.status, { 'content-type': out.contentType, 'access-control-allow-origin': '*' });
    res.end(out.body);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
