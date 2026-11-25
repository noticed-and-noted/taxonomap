// @vitest-environment jsdom
/** The search box's helpers: a notice that clears itself, and a dropdown that ends above an on-screen keyboard. */
import { effectScope, nextTick, ref } from 'vue';
import { useKeyboardFit } from '~/composables/useKeyboardFit';
import { useTimedNotice } from '~/composables/useTimedNotice';

const DURATION_MS = 5000;
const FIT = { minHeight: 160, margin: 8 };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useTimedNotice', () => {
  it('clears a notice after its time, restarting for a new one', () => {
    vi.useFakeTimers();
    const { notice, announce } = useTimedNotice(DURATION_MS);
    announce('First');
    vi.advanceTimersByTime(DURATION_MS - 1);
    announce('Second');
    vi.advanceTimersByTime(DURATION_MS - 1);
    expect(notice.value).toBe('Second');
    vi.advanceTimersByTime(1);
    expect(notice.value).toBe('');
  });

  it('drops its timer when its component goes away', () => {
    vi.useFakeTimers();
    const scope = effectScope();
    const notice = scope.run(() => {
      const timed = useTimedNotice(DURATION_MS);
      timed.announce('Note');
      return timed.notice;
    });
    scope.stop();
    notice!.value = 'Kept';
    vi.advanceTimersByTime(DURATION_MS);
    expect(notice!.value).toBe('Kept');
  });
});

describe('useKeyboardFit', () => {
  /** A dropdown whose top sits at `top` px. */
  function dropdownAt(top: number) {
    const element = document.createElement('div');
    element.getBoundingClientRect = () => new DOMRect(0, top, 300, 0);
    return ref<HTMLElement | undefined>(element);
  }

  /** A visual viewport that keeps its listeners, so a test can fire them. */
  function stubViewport(height: number) {
    const viewport = Object.assign(new EventTarget(), { offsetTop: 0, height });
    vi.stubGlobal('visualViewport', viewport);
    return viewport;
  }

  it('ends the dropdown above the visual viewport’s foot once shown, and follows it', async () => {
    const viewport = stubViewport(600);
    const isShown = ref(false);
    const height = useKeyboardFit(dropdownAt(100), isShown, FIT);
    expect(height.value).toBeNull();
    isShown.value = true;
    await nextTick();
    await nextTick();
    expect(height.value).toBe(492);
    viewport.height = 400;
    viewport.dispatchEvent(new Event('resize'));
    expect(height.value).toBe(292);
  });

  it('keeps the least height, and uses the window without a visual viewport', async () => {
    vi.stubGlobal('visualViewport', undefined);
    vi.stubGlobal('innerHeight', 200);
    const isShown = ref(false);
    const height = useKeyboardFit(dropdownAt(100), isShown, FIT);
    isShown.value = true;
    await nextTick();
    await nextTick();
    expect(height.value).toBe(FIT.minHeight);
  });

  it('stops following once hidden or gone, and skips a missing dropdown', async () => {
    const viewport = stubViewport(600);
    const scope = effectScope();
    const isShown = ref(false);
    const dropdown = dropdownAt(100);
    const height = scope.run(() => useKeyboardFit(dropdown, isShown, FIT))!;
    isShown.value = true;
    await nextTick();
    await nextTick();
    isShown.value = false;
    await nextTick();
    viewport.height = 300;
    viewport.dispatchEvent(new Event('resize'));
    expect(height.value).toBe(492);
    dropdown.value = undefined;
    isShown.value = true;
    await nextTick();
    await nextTick();
    expect(height.value).toBe(492);
    scope.stop();
  });

  it('has nothing to stop when it never showed', () => {
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const scope = effectScope();
    scope.run(() => useKeyboardFit(dropdownAt(100), ref(false), FIT));
    scope.stop();
    expect(removeListener).not.toHaveBeenCalledWith('resize', expect.any(Function));
  });
});
