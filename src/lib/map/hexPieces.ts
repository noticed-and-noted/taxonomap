/**
 * Reassembling a hex cell from the pieces MapLibre renders it in.
 *
 * Past the occurrence source's maxzoom, MapLibre slices each parent tile into
 * overzoomed tiles and clips every feature to its slice (plus a small buffer),
 * so a cell crossing a slice edge comes back from queryRenderedFeatures as
 * several convex pieces. Pieces of one cell overlap in that buffer; different
 * cells only ever share an edge. So: gather the pieces that overlap, then take
 * their convex hull, which is the cell.
 */

export type Pt = [number, number];

/** A lng/lat point in Web Mercator pixels at this zoom (512 px tiles, as MapLibre). */
export function mercatorPx([lng, lat]: Pt, zoom: number): Pt {
  const size = 512 * 2 ** zoom;
  const phi = (Math.max(-85.06, Math.min(85.06, lat)) * Math.PI) / 180;
  return [((lng + 180) / 360) * size, (0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI)) * size];
}

/** Polygon pieces of a feature's geometry (outer rings only; cells have no holes). */
export function outerRings(g: GeoJSON.Geometry): Pt[][] {
  const rings =
    g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((p) => p[0]) : [];
  return rings
    .filter((r): r is GeoJSON.Position[] => !!r && r.length >= 4)
    .map((r) => r.map((p) => [p[0], p[1]] as Pt));
}

/**
 * Whether two convex polygons overlap by more than `min` (separating axis test).
 * Polygons that only touch along an edge, like neighbouring cells, do not.
 */
export function convexOverlap(a: Pt[], b: Pt[], min = 1): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i] as Pt;
      const q = poly[(i + 1) % poly.length] as Pt;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 1e-9) continue;
      const nx = (p[1] - q[1]) / len;
      const ny = (q[0] - p[0]) / len;
      const proj = (pts: Pt[]) => pts.map(([x, y]) => x * nx + y * ny);
      const pa = proj(a);
      const pb = proj(b);
      const depth = Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb));
      if (depth <= min) return false;
    }
  }
  return true;
}

/** Convex hull (monotone chain), indices into `pts`, counter-clockwise in y-up space; collinear points dropped. */
export function convexHull(pts: Pt[]): number[] {
  const idx = pts.map((_, i) => i).sort((i, j) => pts[i]![0] - pts[j]![0] || pts[i]![1] - pts[j]![1]);
  if (idx.length < 3) return idx;
  const cross = (o: number, a: number, b: number) => {
    const [ox, oy] = pts[o]!;
    const [ax, ay] = pts[a]!;
    const [bx, by] = pts[b]!;
    return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
  };
  const half = (order: number[]) => {
    const h: number[] = [];
    for (const i of order) {
      while (h.length >= 2 && cross(h[h.length - 2]!, h[h.length - 1]!, i) <= 0) h.pop();
      h.push(i);
    }
    h.pop();
    return h;
  };
  return [...half(idx), ...half([...idx].reverse())];
}

/**
 * The closed lng/lat ring of the cell made of these pieces. `toPx` maps lng/lat
 * to (y-down) pixels, where near-duplicate points (the same corner seen from two
 * tiles) are merged before the hull is taken.
 */
export function hullRing(pieces: Pt[][], toPx: (p: Pt) => Pt): Pt[] {
  const lngLat: Pt[] = [];
  const px: Pt[] = [];
  for (const ring of pieces) {
    for (const p of ring) {
      const [x, y] = toPx(p);
      // Screen y points down; flip so the hull comes out counter-clockwise on the map.
      const s: Pt = [x, -y];
      if (px.some((q) => Math.abs(q[0] - s[0]) < 0.5 && Math.abs(q[1] - s[1]) < 0.5)) continue;
      lngLat.push(p);
      px.push(s);
    }
  }
  // Clip corners sit on a cell edge, a hair off straight after rounding: drop them.
  let idx = convexHull(px);
  for (let i = 0; idx.length > 3 && i < idx.length;) {
    const [ax, ay] = px[idx[(i + idx.length - 1) % idx.length]!]!;
    const [bx, by] = px[idx[i]!]!;
    const [cx, cy] = px[idx[(i + 1) % idx.length]!]!;
    const off = Math.abs((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / Math.hypot(cx - ax, cy - ay);
    if (off < 0.5) idx = idx.filter((_, j) => j !== i);
    else i++;
  }
  const hull = idx.map((i) => lngLat[i] as Pt);
  return hull.length ? [...hull, hull[0] as Pt] : [];
}
