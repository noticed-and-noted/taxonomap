// @vitest-environment jsdom
/** The light/dark theme: what is applied, saved and announced. */
import { currentTheme, setTheme } from '~/lib/theme';
import { memoryStorage } from './helpers/storage';

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  delete document.documentElement.dataset['theme'];
});
afterEach(() => vi.unstubAllGlobals());

describe('theme', () => {
  it('is dark unless <html> says light', () => {
    expect(currentTheme()).toBe('dark');
    document.documentElement.dataset['theme'] = 'light';
    expect(currentTheme()).toBe('light');
  });

  it('applies, saves and announces a new theme', () => {
    const heard = vi.fn();
    document.addEventListener('themechange', heard);
    setTheme('light');
    expect(currentTheme()).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
    expect((heard.mock.calls[0]![0] as CustomEvent).detail).toBe('light');
    document.removeEventListener('themechange', heard);
  });

  it('still applies the theme when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    setTheme('light');
    expect(currentTheme()).toBe('light');
  });
});
