// Two stacked canvases (a static base layer and a fading particle layer) with
// pan, pinch, wheel zoom, tap, and eased camera moves.

import type { Bounds, XY } from "./geo";
import { prefersReducedMotion } from "./theme";

export interface Padding {
  x: number;
  top: number;
  bottom: number;
}

export interface ViewportOptions {
  minScale: number;
  maxScale: number;
  /** Screen padding around fitted bounds, given the stage size. */
  padding: (w: number, h: number) => Padding;
  /** Redraw the base layer; called whenever the camera moves. */
  drawBase: () => void;
  onTap: (x: number, y: number) => void;
}

interface Camera {
  s: number;
  tx: number;
  ty: number;
}

const FLY_MS = 900;
const TAP_SLOP_PX = 6;
const easeInOutQuad = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

export class Viewport {
  readonly stage = document.getElementById("stage")!;
  readonly base = document.getElementById("base") as HTMLCanvasElement;
  readonly fx = document.getElementById("fx") as HTMLCanvasElement;
  readonly bctx = this.base.getContext("2d")!;
  readonly fctx = this.fx.getContext("2d")!;
  readonly reduceMotion = prefersReducedMotion();
  W = 0;
  H = 0;
  DPR = 1;
  cam: Camera = { s: 1, tx: 0, ty: 0 };
  private flight: { from: Camera; to: Camera; t0: number } | null = null;

  constructor(private opts: ViewportOptions) {
    this.bindPointer();
  }

  /** Map units to screen pixels. */
  X = (x: number): number => x * this.cam.s + this.cam.tx;
  Y = (y: number): number => y * this.cam.s + this.cam.ty;

  get scale(): number {
    return this.cam.s;
  }

  resize(): void {
    const r = this.stage.getBoundingClientRect();
    this.DPR = Math.min(2, devicePixelRatio || 1);
    this.W = r.width;
    this.H = r.height;
    for (const c of [this.base, this.fx]) {
      c.width = this.W * this.DPR;
      c.height = this.H * this.DPR;
    }
    this.redraw();
  }

  redraw(): void {
    this.opts.drawBase();
    this.clearFx();
  }

  clearFx(): void {
    this.fctx.clearRect(0, 0, this.fx.width, this.fx.height);
  }

  fit(b: Bounds, animate = false): void {
    const { W, H } = this;
    const pad = this.opts.padding(W, H);
    const bw = b[2] - b[0];
    const bh = b[3] - b[1];
    const s = Math.min((W - pad.x * 2) / bw, (H - pad.top - pad.bottom) / bh);
    this.moveTo(
      { s, tx: (W - bw * s) / 2 - b[0] * s, ty: pad.top + (H - pad.top - pad.bottom - bh * s) / 2 - b[1] * s },
      animate,
    );
  }

  /** Center a map point a little above the middle, leaving room for the card. */
  flyTo(xy: XY, s: number, animate = true): void {
    this.moveTo({ s, tx: this.W / 2 - xy[0] * s, ty: this.H * 0.45 - xy[1] * s }, animate);
  }

  private moveTo(to: Camera, animate: boolean): void {
    if (animate && !this.reduceMotion) {
      this.flight = { from: { ...this.cam }, to, t0: performance.now() };
    } else {
      this.flight = null;
      this.cam = to;
      this.redraw();
    }
  }

  /** Advance any camera flight. Call once per animation frame. */
  tick(t: number): void {
    const f = this.flight;
    if (!f) return;
    const k = Math.min(1, (t - f.t0) / FLY_MS);
    const e = easeInOutQuad(k);
    this.cam = {
      s: f.from.s + (f.to.s - f.from.s) * e,
      tx: f.from.tx + (f.to.tx - f.from.tx) * e,
      ty: f.from.ty + (f.to.ty - f.from.ty) * e,
    };
    this.redraw();
    if (k >= 1) this.flight = null;
  }

  private clampScale(s: number): number {
    return Math.max(this.opts.minScale, Math.min(this.opts.maxScale, s));
  }

  private bindPointer(): void {
    const { stage } = this;
    const ptrs = new Map<number, XY>();
    type Drag = { x: number; y: number; tx: number; ty: number } | { pinch: number; s: number; cx: number; cy: number; tx: number; ty: number };
    let drag: Drag | null = null;
    let moved = 0;
    // Stage pixels from the client position: offsetX is relative to whatever element was
    // hit, and WebKit doesn't always agree with other browsers on what that is.
    const at = (e: MouseEvent): XY => {
      const r = stage.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    stage.addEventListener("pointerdown", (e) => {
      if ((e.target as Element).closest("button,#card")) return;
      // A primary pointer starts a new gesture, so nothing else is down: anything still
      // listed is a finger whose up event never came (iOS can drop it). Pairing with it
      // would turn the next one-finger pan into a wild pinch.
      if (e.isPrimary) ptrs.clear();
      // A third finger doesn't join the pinch.
      if (ptrs.size >= 2) return;
      stage.setPointerCapture(e.pointerId);
      const [x, y] = at(e);
      ptrs.set(e.pointerId, [x, y]);
      moved = 0;
      this.flight = null;
      if (ptrs.size === 1) drag = { x, y, tx: this.cam.tx, ty: this.cam.ty };
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        drag = { pinch: Math.hypot(a[0] - b[0], a[1] - b[1]), s: this.cam.s, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, tx: this.cam.tx, ty: this.cam.ty };
      }
    });

    stage.addEventListener("pointermove", (e) => {
      if (!ptrs.has(e.pointerId)) return;
      const [x, y] = at(e);
      ptrs.set(e.pointerId, [x, y]);
      if (!drag) return;
      if (ptrs.size === 1 && !("pinch" in drag)) {
        const dx = x - drag.x;
        const dy = y - drag.y;
        moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
        this.cam.tx = drag.tx + dx;
        this.cam.ty = drag.ty + dy;
      } else if (ptrs.size === 2 && "pinch" in drag) {
        const [a, b] = [...ptrs.values()];
        const s = this.clampScale((drag.s * Math.hypot(a[0] - b[0], a[1] - b[1])) / drag.pinch);
        const k = s / drag.s;
        this.cam = { s, tx: drag.cx - (drag.cx - drag.tx) * k, ty: drag.cy - (drag.cy - drag.ty) * k };
        moved = Infinity;
      }
      this.redraw();
    });

    const end = (e: PointerEvent, tap: boolean) => {
      if (!ptrs.has(e.pointerId)) return;
      const n = ptrs.size;
      ptrs.delete(e.pointerId);
      if (tap && n === 1 && moved < TAP_SLOP_PX) this.opts.onTap(...at(e));
      if (!ptrs.size) drag = null;
      else {
        const [p] = [...ptrs.values()];
        drag = { x: p[0], y: p[1], tx: this.cam.tx, ty: this.cam.ty };
      }
    };
    stage.addEventListener("pointerup", (e) => end(e, true));
    stage.addEventListener("pointercancel", (e) => end(e, false));
    stage.addEventListener("lostpointercapture", (e) => end(e, false));
    // Safari's own pinch events: keep them from zooming the page under the map.
    stage.addEventListener("gesturestart", (e) => e.preventDefault());

    stage.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.flight = null;
        const s = this.clampScale(this.cam.s * Math.exp(-e.deltaY * 0.0015));
        const k = s / this.cam.s;
        const [x, y] = at(e);
        this.cam = { s, tx: x - (x - this.cam.tx) * k, ty: y - (y - this.cam.ty) * k };
        this.redraw();
      },
      { passive: false },
    );
  }
}

/** requestAnimationFrame loop with a clamped timestep (a background tab can return a huge dt). */
export function startLoop(frame: (dt: number, t: number) => void): void {
  let last = performance.now();
  const loop = (t: number) => {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    frame(dt, t);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame((t) => {
    last = t;
    loop(t);
  });
}
