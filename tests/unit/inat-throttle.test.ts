/** The iNaturalist token bucket: requests cancelled while queued give up their turn. */
import { throttle } from '~/lib/photos/inat';

afterEach(() => vi.useRealTimers());

describe('throttle', () => {
  it('spends no token on a request cancelled while it waited', async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const t = throttle(
      async (url) => (sent.push(url), new Response('{}')),
      1,
      1,
      () => Date.now(),
    );

    await t('a');
    const ctrl = new AbortController();
    const stale = t('stale', { signal: ctrl.signal });
    const fresh = t('fresh');
    ctrl.abort();
    await expect(stale).rejects.toThrow();

    // The stale request's wait ends on abort, so the fresh one waits one interval, not two.
    await vi.advanceTimersByTimeAsync(1000);
    await fresh;
    expect(sent).toEqual(['a', 'fresh']);
  });

  it('gives up its turn when cancelled during its wait', async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const t = throttle(
      async (url) => (sent.push(url), new Response('{}')),
      1,
      1,
      () => Date.now(),
    );
    await t('a');
    const ctrl = new AbortController();
    const stale = t('stale', { signal: ctrl.signal });
    // Let its turn start and begin waiting for a token.
    await vi.advanceTimersByTimeAsync(10);
    ctrl.abort();
    await expect(stale).rejects.toThrow();
    const fresh = t('fresh');
    await vi.advanceTimersByTimeAsync(1000);
    await fresh;
    expect(sent).toEqual(['a', 'fresh']);
  });
});
