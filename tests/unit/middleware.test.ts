/** The Basic-auth gate in front of the Pages site. */
import { onRequest } from '../../functions/_middleware';

const ENV = { BASIC_AUTH_USER: 'jack', BASIC_AUTH_PASS: 'p:ss wörd' };
const basic = (text: string) => `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(text)))}`;

function call(authorization: string | null, env: typeof ENV | Partial<typeof ENV> = ENV) {
  const next = vi.fn(async () => new Response('site'));
  const headers = authorization === null ? {} : { Authorization: authorization };
  const request = new Request('https://app.taxonomap.com/', { headers });
  return { res: onRequest({ request, env, next }), next };
}

describe('Basic auth middleware', () => {
  it('serves the site for the right credentials (password may contain a colon)', async () => {
    const { res: response, next } = call(basic('jack:p:ss wörd'));
    expect(await (await response).text()).toBe('site');
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
  ])('challenges with %s', async (_label, header) => {
    const { res: pending, next } = call(header);
    const response = await pending;
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toBe('Basic realm="Taxonomap", charset="UTF-8"');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(next).not.toHaveBeenCalled();
  });

  it('is off when neither secret is set', async () => {
    const { res: response, next } = call(null, {});
    expect(await (await response).text()).toBe('site');
    expect(next).toHaveBeenCalledOnce();
  });

  it('stays locked when only one secret is set', async () => {
    const { res: response, next } = call(basic('jack:'), { BASIC_AUTH_USER: 'jack' });
    expect((await response).status).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });
});
