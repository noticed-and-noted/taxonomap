/**
 * Tile decoding off the main thread: the worker's handler, and the main-thread
 * side that sends it tiles, falls back without workers, and recovers when the
 * worker breaks. The worker is replaced by one that answers in-process.
 */
import type { DecodeRequest } from '~/lib/map/hexWorker';
import { decodeHexes } from '~/lib/map/occGrid';
import { hexAt, mvt } from './helpers/tiles';

const TILE = { x: 1, y: 1 };
const LEVEL = 1;
const tileBytes = () => mvt([{ ring: hexAt(2048, 2048), total: 8 }]);
const garbage = () => new Uint8Array([0xff, 0xff, 0xff]).buffer;

/** Loads the worker module with a fake worker global, returning what it posted. */
async function loadWorker() {
  const posted: unknown[] = [];
  let listener: ((event: MessageEvent<DecodeRequest>) => void) | undefined;
  vi.stubGlobal('self', {
    addEventListener: (_type: string, handler: typeof listener) => (listener = handler),
    postMessage: (message: unknown) => posted.push(message),
  });
  const module = await import('~/lib/map/hexWorker');
  return { module, posted, send: (request: DecodeRequest) => listener!({ data: request } as MessageEvent) };
}

/** A Worker stand-in that answers in-process on the next tick (not at all when `decode` gives null), recording what it was sent. */
function fakeWorkers(decode: (request: DecodeRequest) => unknown) {
  const made: FakeWorker[] = [];
  class FakeWorker extends EventTarget {
    sent: { request: DecodeRequest; transfer: unknown[] }[] = [];
    terminated = false;
    constructor() {
      super();
      made.push(this);
    }
    postMessage(request: DecodeRequest, transfer: unknown[]) {
      this.sent.push({ request, transfer });
      const answer = decode(request);
      if (answer !== null) setImmediate(() => this.dispatchEvent(new MessageEvent('message', { data: answer })));
    }
    terminate() {
      this.terminated = true;
    }
  }
  vi.stubGlobal('Worker', FakeWorker);
  return made;
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('hex worker', () => {
  it('posts each tile’s hexes, none for an empty tile, and no hexes for bytes that are not a tile', async () => {
    const { posted, send } = await loadWorker();
    send({ id: 1, data: tileBytes(), tile: TILE, level: LEVEL });
    send({ id: 2, data: new ArrayBuffer(0), tile: TILE, level: LEVEL });
    send({ id: 3, data: garbage(), tile: TILE, level: LEVEL });
    const expected = await decodeHexes(tileBytes(), TILE, LEVEL);
    expect(posted).toEqual([{ id: 1, hexes: expected }, { id: 2, hexes: [] }, { id: 3 }]);
  });
});

describe('decodeOffThread', () => {
  it('decodes on the main thread where there are no workers', async () => {
    const { decodeOffThread } = await import('~/lib/map/hexDecoder');
    expect(await decodeOffThread(tileBytes(), TILE, LEVEL)).toEqual(await decodeHexes(tileBytes(), TILE, LEVEL));
  });

  it('hands tiles to one worker, transferring their bytes, and fails a tile that does not decode', async () => {
    const { module } = await loadWorker();
    const made = fakeWorkers(module.decodeRequest);
    const { decodeOffThread } = await import('~/lib/map/hexDecoder');
    const bytes = tileBytes();
    const [hexes] = await Promise.all([
      decodeOffThread(bytes, TILE, LEVEL),
      expect(decodeOffThread(garbage(), TILE, LEVEL)).rejects.toThrow('did not decode'),
    ]);
    expect(hexes).toEqual(await decodeHexes(tileBytes(), TILE, LEVEL));
    expect(made).toHaveLength(1);
    expect(made[0]!.sent[0]!.transfer).toEqual([bytes]);
  });

  it('fails what a broken worker held, then decodes on the main thread', async () => {
    const made = fakeWorkers(() => null);
    const { decodeOffThread } = await import('~/lib/map/hexDecoder');
    const waiting = decodeOffThread(tileBytes(), TILE, LEVEL);
    made[0]!.dispatchEvent(new Event('error'));
    await expect(waiting).rejects.toThrow('decoder failed');
    expect(made[0]!.terminated).toBe(true);
    expect(await decodeOffThread(tileBytes(), TILE, LEVEL)).toEqual(await decodeHexes(tileBytes(), TILE, LEVEL));
    expect(made).toHaveLength(1);
  });
});
