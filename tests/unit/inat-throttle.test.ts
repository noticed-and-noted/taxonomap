/** The iNaturalist token bucket: requests cancelled while queued give up their turn. */
import { throttle } from '~/lib/photos/inat';

afterEach(() => vi.useRealTimers());

describe('throttle', () => {
  it('spends no token on a request cancelled while it waited', async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const throttled = throttle(
      async (url) => (sent.push(url), new Response('{}')),
      1,
      1,
      () => Date.now(),
    );

    await throttled('a');
    const controller = new AbortController();
    const stale = throttled('stale', { signal: controller.signal });
    const fresh = throttled('fresh');
    controller.abort();
    await expect(stale).rejects.toThrow();

    // The stale request's wait ends on abort, so the fresh one waits one interval, not two.
    await vi.advanceTimersByTimeAsync(1000);
    await fresh;
    expect(sent).toEqual(['a', 'fresh']);
  });

  it('gives up its turn when cancelled during its wait', async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const throttled = throttle(
      async (url) => (sent.push(url), new Response('{}')),
      1,
      1,
      () => Date.now(),
    );
    await throttled('a');
    const controller = new AbortController();
    const stale = throttled('stale', { signal: controller.signal });
    // Let its turn start and begin waiting for a token.
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await expect(stale).rejects.toThrow();
    const fresh = throttled('fresh');
    await vi.advanceTimersByTimeAsync(1000);
    await fresh;
    expect(sent).toEqual(['a', 'fresh']);
  });
});
