/** The fake world (world.ts) over HTTP, for the offline build. */
import { createServer, type Server } from 'node:http';
import { answer, FAKE_PORT } from './world.ts';

export function startFake(port = FAKE_PORT): Promise<Server> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    const out = answer(url) ?? { status: 404, contentType: 'text/plain', body: `fake: nothing at ${url.pathname}` };
    response.writeHead(out.status, { 'content-type': out.contentType, 'access-control-allow-origin': '*' });
    response.end(out.body);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
