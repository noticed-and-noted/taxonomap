/** Picking which browser's WebGL steps the map's notice shows first. */
import { detectBrowser, WEBGL_HELP } from '~/lib/map/webglHelp';

const USER_AGENTS = {
  chrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:141.0) Gecko/20100101 Firefox/141.0',
  safari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  chromeOnIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
};

describe('detectBrowser', () => {
  it('tells the main browsers apart, Edge and Chrome included', () => {
    expect(detectBrowser(USER_AGENTS.chrome)).toBe('chrome');
    expect(detectBrowser(USER_AGENTS.edge)).toBe('edge');
    expect(detectBrowser(USER_AGENTS.firefox)).toBe('firefox');
    expect(detectBrowser(USER_AGENTS.safari)).toBe('safari');
  });

  it('counts every iPhone browser as Safari, whose engine they all run on', () => {
    expect(detectBrowser(USER_AGENTS.chromeOnIphone)).toBe('safari');
  });

  it('gives Android, which has no acceleration setting, the general steps', () => {
    expect(
      detectBrowser(
        'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('other');
  });

  it('falls back to other for an unknown browser', () => {
    expect(detectBrowser('SomeBrowser/1.0')).toBe('other');
  });

  it('has steps for every browser it can detect', () => {
    for (const id of ['chrome', 'edge', 'firefox', 'safari', 'other'] as const) {
      expect(WEBGL_HELP.find((entry) => entry.id === id)?.steps.length).toBeGreaterThan(0);
    }
  });
});
