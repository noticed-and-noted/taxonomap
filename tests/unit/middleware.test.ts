/** The Basic-auth gate in front of the Pages site. */
import { onRequest } from '../../functions/_middleware';

const ENV = { BASIC_AUTH_USER: 'jack', BASIC_AUTH_PASS: 'p:ss wörd' };
const basic = (s: string) => `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(s)))}`;

function call(authorization: string | null, env: typeof ENV | Partial<typeof ENV> = ENV) {
  const next = vi.fn(async () => new Response('site'));
  const headers = authorization === null ? {} : { Authorization: authorization };
  const request = new Request('https://app.taxonomap.com/', { headers });
  return { res: onRequest({ request, env, next }), next };
}

describe('Basic auth middleware', () => {
  it('serves the site for the right credentials (password may contain a colon)', async () => {
    const { res, next } = call(basic('jack:p:ss wörd'));
    expect(await (await res).text()).toBe('site');
    expect(next).toHaveBeenCalledOnce();
  });

  it.each([
    ['no header', null],
    ['another scheme', 'Bearer abc'],
    ['no credentials', 'Basic'],
    ['not base64', 'Basic %%%'],
    ['no colon', basic('jack')],
    ['wrong user', basic('jill:p:ss wörd')],
    ['wrong password', basic('jack:nope')],
  ])('challenges with %s', async (_, header) => {
    const { res, next } = call(header);
    const r = await res;
    expect(r.status).toBe(401);
    expect(r.headers.get('WWW-Authenticate')).toBe('Basic realm="Taxonomap", charset="UTF-8"');
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(next).not.toHaveBeenCalled();
  });

  it('stays locked when the secrets are missing', async () => {
    const { res, next } = call(basic('jack:'), { BASIC_AUTH_USER: 'jack' });
    expect((await res).status).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });
});
