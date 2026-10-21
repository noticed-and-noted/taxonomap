// @vitest-environment jsdom
/** Onboarding: the tour's seen flag and the "Try this" checklist's saved, self-ticking progress. */
import { memoryStorage } from './helpers/storage';

async function stores() {
  vi.resetModules();
  const onboarding = await import('~/stores/onboarding');
  const explorer = await import('~/stores/explorer');
  const near = await import('~/stores/near');
  const ramp = await import('~/stores/ramp');
  const tree = await import('~/stores/tree');
  return { onboarding, explorer, near, ramp, tree };
}

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe('the tour', () => {
  it('is unseen on a first visit and remembered once finished', async () => {
    const { onboarding } = await stores();
    expect(onboarding.$tourSeen.get()).toBe(false);
    onboarding.$tourOpen.set(true);
    onboarding.finishTour();
    expect([onboarding.$tourSeen.get(), onboarding.$tourOpen.get()]).toEqual([true, false]);
    expect((await stores()).onboarding.$tourSeen.get()).toBe(true);
  });

  it('can be restarted from Settings, closing the phone filters sheet', async () => {
    const { onboarding, explorer } = await stores();
    onboarding.finishTour();
    explorer.$panel.set('filters');
    onboarding.restartTour();
    expect([onboarding.$tourSeen.get(), explorer.$panel.get()]).toEqual([false, 'none']);
    expect((await stores()).onboarding.$tourSeen.get()).toBe(false);
  });

  it('leaves the cell panel open when restarted', async () => {
    const { onboarding, explorer } = await stores();
    explorer.$panel.set('hex');
    onboarding.restartTour();
    expect(explorer.$panel.get()).toBe('hex');
  });
});

describe('the checklist', () => {
  it('ticks items once, in checklist order, and saves them', async () => {
    const { onboarding } = await stores();
    onboarding.markDone('tree');
    onboarding.markDone('search');
    onboarding.markDone('tree');
    expect(onboarding.$checklistDone.get()).toEqual(['search', 'tree']);
    expect((await stores()).onboarding.$checklistDone.get()).toEqual(['search', 'tree']);
  });

  it('ignores changes the tour makes', async () => {
    const { onboarding } = await stores();
    onboarding.$tourOpen.set(true);
    onboarding.markDone('hex');
    expect(onboarding.$checklistDone.get()).toEqual([]);
  });

  it('ticks itself from the stores the real actions change', async () => {
    const { onboarding, explorer, near, ramp, tree } = await stores();
    explorer.$selectedHex.set([1, 2]);
    explorer.$dateRange.set({ preset: '1y' });
    near.$nearMode.set(true);
    tree.$treeFocus.set(212);
    ramp.setRamp('magma');
    expect(onboarding.$checklistDone.get()).toEqual(['hex', 'when', 'near', 'tree', 'style']);
  });

  it('does not tick on cleared values, and counts a theme switch', async () => {
    const { onboarding, explorer, near, tree } = await stores();
    explorer.$selectedHex.set([1, 2]);
    explorer.$selectedHex.set(null);
    explorer.$dateRange.set(null);
    near.$nearMode.set(false);
    tree.$treeFocus.set(null);
    expect(onboarding.$checklistDone.get()).toEqual(['hex']);
    document.dispatchEvent(new CustomEvent('themechange', { detail: 'light' }));
    expect(onboarding.$checklistDone.get()).toEqual(['hex', 'style']);
  });

  it('can be hidden for good', async () => {
    const { onboarding } = await stores();
    onboarding.hideChecklist();
    expect(onboarding.$checklistHidden.get()).toBe(true);
    expect((await stores()).onboarding.$checklistHidden.get()).toBe(true);
  });

  it('drops unknown or corrupt saved progress', async () => {
    localStorage.setItem('try-this', '["hex","nope"]');
    expect((await stores()).onboarding.$checklistDone.get()).toEqual(['hex']);
    localStorage.setItem('try-this', '{"hex":true}');
    expect((await stores()).onboarding.$checklistDone.get()).toEqual([]);
    localStorage.setItem('try-this', 'not json');
    expect((await stores()).onboarding.$checklistDone.get()).toEqual([]);
  });
});

describe('a blocked storage', () => {
  it('starts afresh and keeps progress in memory', async () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
    const { onboarding } = await stores();
    expect(onboarding.$tourSeen.get()).toBe(false);
    onboarding.markDone('search');
    onboarding.finishTour();
    expect([onboarding.$checklistDone.get(), onboarding.$tourSeen.get()]).toEqual([['search'], true]);
    onboarding.restartTour();
    expect(onboarding.$tourSeen.get()).toBe(false);
  });
});
