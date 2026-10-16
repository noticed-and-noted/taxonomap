/**
 * The density ramp the viewer picked in map settings, remembered per browser.
 * The choice is written onto <html> as --ramp-0…7, so the map, the legend and
 * the charts all read it like any other token; the default ramp needs no
 * overrides (it is the tokens.css value). Astro's ClientRouter replaces the
 * <html> attributes on navigation, so the overrides are re-applied after each
 * swap.
 */
import { atom } from 'nanostores';
import { DEFAULT_RAMP, isRampId, rampById, type RampId } from '~/lib/ramp';

export const RAMP_KEY = 'map-colours';

function saved(): RampId {
  try {
    const v = localStorage.getItem(RAMP_KEY);
    return isRampId(v) ? v : DEFAULT_RAMP;
  } catch {
    return DEFAULT_RAMP;
  }
}

export const $ramp = atom<RampId>(typeof window === 'undefined' ? DEFAULT_RAMP : saved());

function apply(id: RampId) {
  if (typeof document === 'undefined') return;
  const style = document.documentElement.style;
  rampById(id).colors.forEach((c, i) => {
    if (id === DEFAULT_RAMP) style.removeProperty(`--ramp-${i}`);
    else style.setProperty(`--ramp-${i}`, c);
  });
}

/** Switch ramps. Tokens change before $ramp notifies, so listeners read the new colours. */
export function setRamp(id: RampId) {
  apply(id);
  try {
    if (id === DEFAULT_RAMP) localStorage.removeItem(RAMP_KEY);
    else localStorage.setItem(RAMP_KEY, id);
  } catch {
    /* Storage unavailable (private mode, blocked): keep the in-memory choice. */
  }
  $ramp.set(id);
}

if (typeof document !== 'undefined') {
  apply($ramp.get());
  document.addEventListener('astro:after-swap', () => apply($ramp.get()));
}
