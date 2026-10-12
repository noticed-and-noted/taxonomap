/**
 * Share card drawn on a <canvas>: "42 bird species recorded within 2 km".
 * Only CORS-enabled imagery is drawn (GBIF's basemap and density tiles), so
 * the canvas can be exported. The exact location is not printed.
 */
import { gbifBasemapTile, occurrenceTileUrl } from '~/lib/gbif';
import { round } from '~/lib/gbif/params';

export interface ShareCardInput {
  count: number;
  groupLabel: string;
  radiusKm: number;
  lat: number;
  lng: number;
  topNames: string[];
  month?: string | undefined;
  theme: 'dark' | 'light';
  /** Group drawn in the density layer (e.g. the bird class key). */
  taxonKey?: number | undefined;
}

const W = 1200;
const H = 630;

function loadImage(src: string, timeoutMs = 5000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

/** Lets a newer draw cancel an older one that is still waiting on tiles. */
export interface DrawToken {
  cancelled: boolean;
}

/** Web-Mercator tile containing a point. */
function tileFor(lat: number, lng: number, z: number) {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x: Math.floor(x), y: Math.floor(y), fx: x - Math.floor(x), fy: y - Math.floor(y) };
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export async function drawShareCard(
  canvas: HTMLCanvasElement,
  input: ShareCardInput,
  token: DrawToken = { cancelled: false },
): Promise<void> {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dark = input.theme === 'dark';
  const bg = dark ? '#0e1813' : '#f5efe3';
  const text = dark ? '#e9f0ea' : '#1d2720';
  const muted = dark ? '#a9bbb0' : '#4f5d54';
  const accent = dark ? '#f0b443' : '#9c5200';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Text first: it needs no network, so the card is readable immediately.
  // Text panel (left).
  ctx.setLineDash([]);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = accent;
  ctx.font = '600 22px "Inter Variable", Inter, system-ui, sans-serif';
  ctx.fillText('GBIF EXPLORER · WHAT’S NEAR ME', 56, 92);

  ctx.fillStyle = text;
  ctx.font = '600 150px "Source Serif 4 Variable", Georgia, serif';
  ctx.fillText(new Intl.NumberFormat('en').format(input.count), 50, 250);

  ctx.font = '600 44px "Source Serif 4 Variable", Georgia, serif';
  const headline = `${input.groupLabel} recorded within ${input.radiusKm} km${input.month ? ` in ${input.month}` : ''}`;
  wrap(ctx, headline, 540).forEach((line, i) => ctx.fillText(line, 56, 318 + i * 54));

  ctx.fillStyle = muted;
  ctx.font = '400 26px "Inter Variable", Inter, system-ui, sans-serif';
  const top = input.topNames.slice(0, 3).join(' · ');
  if (top)
    wrap(ctx, `Including ${top}`, 540)
      .slice(0, 2)
      .forEach((line, i) => ctx.fillText(line, 56, 470 + i * 34));

  ctx.font = '400 18px "Inter Variable", Inter, system-ui, sans-serif';
  ctx.fillText(`Occurrence data: GBIF.org · area ~${round(input.radiusKm, 0)} km radius`, 56, 580);

  // Map panel (right): basemap + density tile around the area, circle on top.
  const z = Math.max(5, Math.min(13, Math.round(13.6 - Math.log2(input.radiusKm)) - 1));
  const t = tileFor(input.lat, input.lng, z);
  const size = 512;
  const mapX = 640;
  const ox = mapX + 280 - t.fx * size;
  const oy = H / 2 - t.fy * size;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(mapX, 40, 520, 550, 24);
  ctx.clip();
  ctx.fillStyle = dark ? '#14221b' : '#efe7d7';
  ctx.fillRect(mapX, 40, 520, 550);
  const jobs: Promise<void>[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const x = t.x + dx;
      const y = t.y + dy;
      if (y < 0 || y >= 2 ** z) continue;
      const px = ox + dx * size;
      const py = oy + dy * size;
      jobs.push(
        (async () => {
          const base = await loadImage(gbifBasemapTile(z, ((x % 2 ** z) + 2 ** z) % 2 ** z, y, input.theme));
          if (base && !token.cancelled) ctx.drawImage(base, px, py, size, size);
        })(),
      );
    }
  }
  await Promise.all(jobs);
  await Promise.all(
    [-1, 0, 1].flatMap((dx) =>
      [-1, 0, 1].map(async (dy) => {
        const y = t.y + dy;
        if (y < 0 || y >= 2 ** z) return;
        const img = await loadImage(
          occurrenceTileUrl({ taxonKey: input.taxonKey }, z, t.x + dx, y, {
            hexPerTile: 40,
            style: 'purpleYellow-noborder.poly',
          }),
        );
        if (img && !token.cancelled) ctx.drawImage(img, ox + dx * size, oy + dy * size, size, size);
      }),
    ),
  );
  if (token.cancelled) {
    ctx.restore();
    return;
  }
  // Radius ring (approximate at this zoom).
  const metresPerPx = (156543.03 * Math.cos((input.lat * Math.PI) / 180)) / 2 ** z;
  const r = (input.radiusKm * 1000) / metresPerPx;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.setLineDash([12, 9]);
  ctx.beginPath();
  ctx.arc(mapX + 280, H / 2, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), 'image/png');
    } catch {
      resolve(null); // tainted canvas
    }
  });
}
