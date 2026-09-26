// The rain map's creeks as plain lines, for another map to draw under its own
// features: the base file's bigger streams, then each level's tiles of smaller creeks
// once zoomed in, at the rain map's levels of detail. Lines only (no rain, no fates),
// batched by width into one Path2D each, in map units.

import { loadData } from "../shared/data";
import { project, type Bounds } from "../shared/geo";
import type { RainBase, RainSeg, RainTile } from "../shared/types";
import { LEVEL_SCALE, TileIndex, type TileRef } from "./tiles";

/** Line widths are rounded to this many pixels so creeks can be drawn in batches. */
const WIDTH_STEP = 0.2;
/** Zoomed out past this, the base draws thinned copies, as on the rain map. */
const COARSE_SCALE = 300;
const COARSE_STEP = 0.0036;
const MAX_TILES = 40;
/** Tiles load a little before their level shows, and a margin past the screen's edge (map units). */
const PREFETCH = 0.85;
const TILE_MARGIN = 0.15;

type Groups = [width: number, path: Path2D][];

interface Batch {
  groups: Groups;
  /** Thinned copies for drawing zoomed far out (the base only). */
  coarse: Groups | null;
  lastShown: number;
}

export class CreekLayer {
  private meta: RainBase["meta"] | null = null;
  private index: TileIndex | null = null;
  private base: Batch | null = null;
  private tiles = new Map<string, Batch>();
  private pending = new Set<string>();
  private shown: Batch[] = [];

  /** `onChange` redraws the map when a file arrives. */
  constructor(private onChange: () => void) {}

  async load(): Promise<void> {
    const base = await loadData<RainBase>("rain/base.json");
    this.meta = base.meta;
    this.index = new TileIndex(base.meta);
    this.base = this.batch(base.segs, true);
    this.onChange();
  }

  /** Line width in pixels, before zoom, by km of creek upstream. */
  private width(acc: number): number {
    return Math.round((0.3 + Math.log10(acc + 1) * 0.45) / WIDTH_STEP) * WIDTH_STEP;
  }

  private batch(segs: RainSeg[], coarse: boolean): Batch {
    const { coordOrigin: [ox, oy], coordScale: k } = this.meta!;
    const build = (step: number) => {
      const groups = new Map<number, Path2D>();
      for (const [coords, , , acc] of segs) {
        const w = this.width(acc);
        let p = groups.get(w);
        if (!p) groups.set(w, (p = new Path2D()));
        let x = 0;
        let y = 0;
        let lx = Infinity;
        let ly = Infinity;
        for (let i = 0; i < coords.length; i += 2) {
          x += coords[i];
          y += coords[i + 1];
          const [px, py] = project(x / k + ox, y / k + oy);
          const last = i === coords.length - 2;
          // Thin to one vertex per `step`, keeping both ends so creeks still meet.
          if (i && !last && Math.abs(px - lx) + Math.abs(py - ly) < step) continue;
          if (i) p.lineTo(px, py);
          else p.moveTo(px, py);
          lx = px;
          ly = py;
        }
      }
      return [...groups.entries()].sort((a, b) => a[0] - b[0]);
    };
    return { groups: build(0), coarse: coarse ? build(COARSE_STEP) : null, lastShown: 0 };
  }

  private async loadTile(ref: TileRef): Promise<void> {
    if (this.tiles.has(ref.path) || this.pending.has(ref.path)) return;
    this.pending.add(ref.path);
    try {
      const t = await loadData<RainTile>(ref.path);
      this.tiles.set(ref.path, this.batch(t.segs, false));
      this.evict();
      this.onChange();
    } catch (err) {
      console.warn(`Couldn't load ${ref.path}`, err);
    } finally {
      this.pending.delete(ref.path);
    }
  }

  private evict(): void {
    if (this.tiles.size <= MAX_TILES) return;
    const old = [...this.tiles.entries()].filter(([, b]) => !this.shown.includes(b)).sort((a, b) => a[1].lastShown - b[1].lastShown);
    for (const [path] of old.slice(0, this.tiles.size - MAX_TILES)) this.tiles.delete(path);
  }

  /** Pick the tiles to show for this view (map units) and zoom, and ask for the missing ones. */
  update(view: Bounds, scale: number): void {
    if (!this.base || !this.index) return;
    const now = performance.now();
    const next: Batch[] = [this.base];
    for (let level = 1; level < LEVEL_SCALE.length; level++) {
      if (scale < LEVEL_SCALE[level] * PREFETCH) continue;
      for (const ref of this.index.visible(level, view, TILE_MARGIN)) {
        const t = this.tiles.get(ref.path);
        if (!t) void this.loadTile(ref);
        else if (scale >= LEVEL_SCALE[level]) {
          t.lastShown = now;
          next.push(t);
        }
      }
    }
    this.shown = next;
  }

  /**
   * Stroke the creeks shown. The context's transform must already map map units to
   * pixels at `scale`; the caller sets the color and alpha. Widths grow a little with zoom.
   */
  draw(c: CanvasRenderingContext2D, scale: number): void {
    const far = scale < COARSE_SCALE;
    const zs = Math.max(0.6, Math.min(2, scale / 1500));
    c.lineCap = far ? "butt" : "round";
    c.lineJoin = far ? "bevel" : "round";
    // The finest tiles first, so the bigger creeks sit on top.
    for (const b of [...this.shown].reverse()) {
      for (const [w, p] of (far && b.coarse) || b.groups) {
        c.lineWidth = (w * zs) / scale;
        c.stroke(p);
      }
    }
  }
}
