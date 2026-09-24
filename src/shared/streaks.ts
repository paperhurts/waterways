// Draws thousands of short flow-aligned streaks per frame. Streaks are grouped
// by style so each group is a single stroke() call instead of one per particle.
// In dark mode groups draw with additive blending: where many particles
// overlap, on big rivers, the water glows brighter, so brightness tracks flow.

interface Group {
  color: string;
  alpha: number;
  width: number;
  xy: Float32Array;
  n: number;
}

export class StreakLayer {
  private groups: Group[] = [];

  /** Set a group's style for this frame. Call before add(). */
  style(g: number, color: string, alpha: number, width: number): void {
    const grp = (this.groups[g] ??= { color, alpha, width, xy: new Float32Array(4096), n: 0 });
    grp.color = color;
    grp.alpha = alpha;
    grp.width = width;
  }

  begin(): void {
    for (const g of this.groups) if (g) g.n = 0;
  }

  /** A streak from its tail (x0, y0) to its head (x1, y1), in screen pixels. */
  add(g: number, x0: number, y0: number, x1: number, y1: number): void {
    const grp = this.groups[g];
    if (grp.n + 4 > grp.xy.length) {
      const bigger = new Float32Array(grp.xy.length * 2);
      bigger.set(grp.xy);
      grp.xy = bigger;
    }
    // A zero-length stroke draws nothing, so nudge still particles into a dot.
    if (Math.abs(x1 - x0) + Math.abs(y1 - y0) < 0.05) x1 += 0.05;
    const a = grp.xy;
    a[grp.n++] = x0;
    a[grp.n++] = y0;
    a[grp.n++] = x1;
    a[grp.n++] = y1;
  }

  flush(c: CanvasRenderingContext2D, glow: boolean): void {
    c.save();
    c.lineCap = "round";
    if (glow) c.globalCompositeOperation = "lighter";
    for (const g of this.groups) {
      if (!g?.n) continue;
      const p = new Path2D();
      for (let i = 0; i < g.n; i += 4) {
        p.moveTo(g.xy[i], g.xy[i + 1]);
        p.lineTo(g.xy[i + 2], g.xy[i + 3]);
      }
      c.strokeStyle = g.color;
      if (glow) {
        // A faint wide halo under each streak reads as bloom once they overlap.
        c.globalAlpha = g.alpha * 0.12;
        c.lineWidth = g.width * 2.6;
        c.stroke(p);
      }
      c.globalAlpha = g.alpha;
      c.lineWidth = g.width;
      c.stroke(p);
    }
    c.restore();
  }
}

/** Fade the previous frame toward transparent so streaks leave short trails. */
export function fadeLayer(c: CanvasRenderingContext2D, w: number, h: number, amount: number): void {
  c.globalCompositeOperation = "destination-out";
  c.fillStyle = `rgba(0,0,0,${amount})`;
  c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = "source-over";
}

/** Spring boils: a steady core with rings welling outward, staggered per spring. */
export function drawBoil(c: CanvasRenderingContext2D, x: number, y: number, size: number, phase: number, now: number, color: string): void {
  const period = 2.6;
  c.fillStyle = color;
  c.strokeStyle = color;
  c.globalAlpha = 0.95;
  c.beginPath();
  c.arc(x, y, Math.max(1.4, size * 0.45), 0, 7);
  c.fill();
  c.lineWidth = 1;
  for (const offset of [0, 0.5]) {
    const k = (((now / period + phase + offset) % 1) + 1) % 1;
    c.globalAlpha = (1 - k) * 0.55;
    c.beginPath();
    c.arc(x, y, size * (0.6 + k * 1.6), 0, 7);
    c.stroke();
  }
  c.globalAlpha = 1;
}
