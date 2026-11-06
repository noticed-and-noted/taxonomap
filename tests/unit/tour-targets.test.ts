// @vitest-environment jsdom
/** Where the tour and hints point, and the rail's filter groups. */
import { $activeFilterCount, FILTER_GROUPS, PHONE_QUERY, SETTINGS } from '~/lib/filter-groups';
import { boxOf, HINTS, PANEL_SELECTOR, speciesListBox } from '~/lib/tour-targets';
import { $busiestHexBox, $basisOfRecord, $hasPhoto } from '~/stores/explorer';

/** Adds an element with a fixed box, inside `parent` when given. */
function addBox(markup: string, rect: DOMRect, parent: Element = document.body): Element {
  const holder = document.createElement('div');
  holder.innerHTML = markup;
  const element = holder.firstElementChild!;
  element.getBoundingClientRect = () => rect;
  parent.append(element);
  return element;
}

afterEach(() => document.body.replaceChildren());

describe('boxOf', () => {
  it('takes the first match that is laid out', () => {
    addBox('<button class="filters-btn"></button>', new DOMRect(0, 0, 0, 0));
    addBox('<button class="filters-btn"></button>', new DOMRect(5, 6, 0, 10));
    addBox('<button class="filters-btn"></button>', new DOMRect(1, 2, 3, 4));
    expect(boxOf('.filters-btn')).toEqual({ left: 1, top: 2, width: 3, height: 4 });
  });

  it('is null when nothing matches', () => {
    expect(boxOf('.missing')).toBeNull();
  });
});

describe('speciesListBox', () => {
  it('is the species list cut to the panel', () => {
    const panel = addBox('<aside class="side-panel hex-panel"></aside>', new DOMRect(600, 0, 400, 500));
    addBox('<div role="region" aria-label="Species results"></div>', new DOMRect(600, 300, 400, 400), panel);
    expect(PANEL_SELECTOR).toContain('.side-panel');
    expect(speciesListBox()).toEqual({ left: 600, top: 300, width: 400, height: 200 });
  });

  it('is null without the panel or its list', () => {
    expect(speciesListBox()).toBeNull();
    addBox('<aside class="side-panel"></aside>', new DOMRect(600, 0, 400, 500));
    expect(speciesListBox()).toBeNull();
  });
});

describe('HINTS', () => {
  it('points each hint at its control, or the rail’s stand-in on phones', () => {
    const box = new DOMRect(1, 1, 10, 10);
    const expected = { left: 1, top: 1, width: 10, height: 10 };
    addBox('<input data-tour="search">', box);
    addBox('<a data-tour="near"></a>', box);
    const nav = addBox('<nav data-tour="nav"></nav>', box);
    addBox('<a href="/tree/"></a>', box, nav);
    addBox('<button data-theme-toggle></button>', box);
    addBox('<button class="filters-btn"></button>', box);
    $busiestHexBox.set(expected);

    expect(HINTS.search.targets()).toEqual([expected]);
    expect(HINTS.hex.targets()).toEqual([expected]);
    expect(HINTS.hex.needsHex).toBe(true);
    expect(HINTS.when.targets()).toEqual([expected]);
    expect(HINTS.group.targets()).toEqual([expected]);
    expect(HINTS.near.targets()).toEqual([expected]);
    expect(HINTS.tree.targets()).toEqual([expected]);
    expect(HINTS.style.targets()).toEqual([expected, expected]);
  });
});

describe('filter groups', () => {
  it('lists the rail’s groups, then Settings', () => {
    expect(FILTER_GROUPS.map((group) => group.id)).toEqual(['what', 'when', 'where', 'how']);
    expect(SETTINGS.id).toBe('settings');
    expect(PHONE_QUERY).toContain('max-width');
  });

  it('counts every active filter across the groups', () => {
    expect($activeFilterCount.get()).toBe(0);
    $basisOfRecord.set(['HUMAN_OBSERVATION', 'PRESERVED_SPECIMEN']);
    $hasPhoto.set(true);
    expect($activeFilterCount.get()).toBe(3);
  });
});
