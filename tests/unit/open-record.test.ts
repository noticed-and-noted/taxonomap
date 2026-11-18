// @vitest-environment jsdom
/** The record open in a record list: kept in the URL, and kept open (or fetched) as the list loads. */
import { effectScope, nextTick } from 'vue';
import type { Occurrence } from '~/lib/gbif';
import { stubNetwork } from './helpers/network';

const page = (...keys: number[]) => keys.map((key) => ({ key }) as Occurrence);

async function openRecord(urlRecord?: number) {
  vi.resetModules();
  history.replaceState(null, '', urlRecord === undefined ? '/' : `/?record=${urlRecord}`);
  const { $openRecord } = await import('~/stores/explorer');
  const { useOpenRecord } = await import('~/components/organisms/cell/useOpenRecord');
  const scope = effectScope();
  const result = scope.run(useOpenRecord)!;
  return { ...result, $openRecord, stop: () => scope.stop() };
}

const signal = () => new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe('useOpenRecord', () => {
  it('opens the record the URL names, and writes the open record back', async () => {
    const { expanded, $openRecord, stop } = await openRecord(70);
    expect(expanded.value).toBe(70);
    expanded.value = 71;
    await nextTick();
    expect($openRecord.get()).toBe(71);
    $openRecord.set(null);
    expect(expanded.value).toBeNull();
    stop();
  });

  it('keeps an open record its first page holds, and closes one from before that a later page lacks', async () => {
    const calls = stubNetwork(() => undefined);
    const { expanded, withOpenRecord, stop } = await openRecord(70);
    expect((await withOpenRecord(page(70, 71), signal())).map(({ key }) => key)).toEqual([70, 71]);
    expect((await withOpenRecord(page(72), signal())).map(({ key }) => key)).toEqual([72]);
    expect(expanded.value).toBeNull();
    expect(calls).toHaveLength(0);
    stop();
  });

  it('fetches a record the URL names that the first page doesn’t hold, and lists it first', async () => {
    stubNetwork((url) => (url.pathname === '/v1/occurrence/70' ? { key: 70, datasetKey: 'd' } : undefined));
    const { expanded, withOpenRecord, stop } = await openRecord(70);
    expect((await withOpenRecord(page(71), signal())).map(({ key }) => key)).toEqual([70, 71]);
    expect(expanded.value).toBe(70);
    stop();
  });

  it('closes a record from the URL that GBIF can’t find', async () => {
    stubNetwork(() => undefined);
    const { expanded, withOpenRecord, stop } = await openRecord(70);
    expect(await withOpenRecord(page(71), signal())).toEqual(page(71));
    expect(expanded.value).toBeNull();
    stop();
  });

  it('leaves the list alone when the page changed while the record was fetched', async () => {
    stubNetwork(() => ({ key: 70 }));
    const { expanded, withOpenRecord, stop } = await openRecord(70);
    const controller = new AbortController();
    const listed = withOpenRecord(page(71), controller.signal);
    controller.abort();
    expect(await listed).toEqual(page(71));
    expect(expanded.value).toBe(70);
    stop();
  });

  it('lists the page as it is with no record open', async () => {
    const { withOpenRecord, stop } = await openRecord();
    expect(await withOpenRecord(page(71), signal())).toEqual(page(71));
    stop();
  });
});
