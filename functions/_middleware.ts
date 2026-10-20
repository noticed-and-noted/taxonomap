/**
 * HTTP Basic auth in front of the whole Pages site while it is private.
 * Credentials come from the BASIC_AUTH_USER and BASIC_AUTH_PASS Pages secrets.
 * With either one unset the site stays locked rather than falling open.
 */
interface Env {
  BASIC_AUTH_USER?: string;
  BASIC_AUTH_PASS?: string;
}

interface Context {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
}

const REALM = 'Taxonomap';

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** Compares SHA-256 digests so the time taken does not depend on where the strings differ. */
async function safeEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([digest(left), digest(right)]);
  let diff = 0;
  for (let index = 0; index < leftDigest.length; index++) diff |= leftDigest[index]! ^ rightDigest[index]!;
  return diff === 0;
}

function challenge(): Response {
  return new Response('Login required', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`, 'Cache-Control': 'no-store' },
  });
}

/**
 * Pages Function gating the whole site behind HTTP Basic auth.
 * @returns 503 when no credentials are configured, 401 on a mismatch, otherwise the site's response.
 */
export const onRequest = async ({ request, env, next }: Context): Promise<Response> => {
  const { BASIC_AUTH_USER: user, BASIC_AUTH_PASS: pass } = env;
  if (!user || !pass) return new Response('Login is not configured', { status: 503 });

  const header = request.headers.get('Authorization') ?? '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) return challenge();

  let decoded: string;
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)));
  } catch {
    return challenge();
  }
  const sep = decoded.indexOf(':');
  if (sep < 0) return challenge();

  const [okUser, okPass] = await Promise.all([
    safeEqual(decoded.slice(0, sep), user),
    safeEqual(decoded.slice(sep + 1), pass),
  ]);
  return okUser && okPass ? next() : challenge();
};
