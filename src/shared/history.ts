// The story pages' history charts: a yearly value per series (water-year mean flow by
// default; the reef page's peak heat stress) as a line chart with a snapping
// crosshair, a tooltip listing every series, and a table view. Line colors are CSS
// custom properties (--chart-*): the map's water colors stepped into a line chart's
// lightness band. Values can be negative, for flow that runs backward.

import { fmtCfs } from "../shared/live";

/** What the chart measures. The default is flow: water-year means in cfs. */
export interface Measure {
  /** Unit after a value in the tooltip and the table's headers. */
  unit: string;
  format: (v: number | null) => string;
  /** What a year is called in the tooltip and table. */
  year: string;
  /** What the lines are, for the chart's accessible label. */
  what: string;
}

export const FLOW: Measure = { unit: "cfs", format: fmtCfs, year: "Water year", what: "yearly mean flow" };

export interface Series {
  name: string;
  /** CSS custom property for the line color. */
  color: string;
  values: (number | null)[];
}

const SVG = "http://www.w3.org/2000/svg";
const H = 150;
const PAD = { l: 44, r: 44, t: 10, b: 22 };

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

/** Clean y-axis ticks, at most five steps of 1, 2.5, or 5 times a power of ten (0, 250, 500... or 0, 5, 10...), reaching below 0 for negative values. */
export function ticks(max: number, min = 0): number[] {
  const range = Math.max(max - Math.min(0, min), 1e-9);
  let step = 1;
  for (let p = 10 ** Math.floor(Math.log10(range / 5)); ; p *= 10) {
    const s = [1, 2.5, 5].map((m) => m * p).find((s) => range / s <= 5);
    if (s) {
      step = s;
      break;
    }
  }
  const out = [];
  for (let v = Math.min(0, Math.floor(min / step) * step); v <= max; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

/** Draw into `host` (replacing its contents) at its current width. */
export function renderHistory(host: HTMLElement, years: number[], series: Series[], measure: Measure = FLOW): void {
  host.replaceChildren();
  const W = Math.max(260, host.clientWidth);
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const yt = ticks(Math.max(...all), Math.min(...all));
  const [yMin, yMax] = [yt[0], yt[yt.length - 1]];
  const x = (i: number) => PAD.l + (i / (years.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);

  const legend = document.createElement("div");
  legend.className = "legend";
  for (const s of series) {
    const item = document.createElement("span");
    const key = document.createElement("i");
    key.style.background = `var(${s.color})`;
    item.append(key, document.createTextNode(s.name));
    legend.appendChild(item);
  }
  host.appendChild(legend);

  const wrap = document.createElement("div");
  wrap.className = "plot";
  host.appendChild(wrap);
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", tabindex: 0, "aria-label": `${series.map((s) => s.name).join(" and ")}, ${measure.what} ${years[0]}–${years[years.length - 1]}. Use the arrow keys to read each year.` });
  wrap.appendChild(svg);

  for (const v of yt) {
    el("line", { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), class: v === 0 && yMin < 0 ? "grid zero" : "grid" }, svg);
    el("text", { x: PAD.l - 6, y: y(v) + 4, class: "tick", "text-anchor": "end" }, svg).textContent = v.toLocaleString();
  }
  years.forEach((yr, i) => {
    if (yr % 10 === 0) el("text", { x: x(i), y: H - 5, class: "tick", "text-anchor": "middle" }, svg).textContent = String(yr);
  });

  const ends: { v: number; y: number }[] = [];
  for (const s of series) {
    let d = "";
    s.values.forEach((v, i) => {
      if (v == null) return;
      d += `${d && s.values[i - 1] != null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    el("path", { d, class: "line", stroke: `var(${s.color})` }, svg);
    const last = s.values.length - 1;
    const lv = s.values[last];
    if (lv != null) {
      el("circle", { cx: x(last), cy: y(lv), r: 4, class: "dot", fill: `var(${s.color})` }, svg);
      ends.push({ v: lv, y: y(lv) });
    }
  }
  // Value labels at the line ends, in ink; skipped if they'd collide.
  if (ends.every((a, i) => ends.every((b, j) => i === j || Math.abs(a.y - b.y) > 14))) {
    for (const e of ends) el("text", { x: x(years.length - 1) + 8, y: e.y + 4, class: "end" }, svg).textContent = measure.format(e.v);
  }

  const hair = el("line", { y1: PAD.t, y2: H - PAD.b, class: "hair", visibility: "hidden" }, svg);
  const marks = series.map((s) => el("circle", { r: 4, class: "dot", fill: `var(${s.color})`, visibility: "hidden" }, svg));
  const tip = document.createElement("div");
  tip.className = "tip";
  tip.hidden = true;
  wrap.appendChild(tip);

  let at = -1;
  const show = (i: number) => {
    at = Math.max(0, Math.min(years.length - 1, i));
    const cx = x(at);
    hair.setAttribute("x1", String(cx));
    hair.setAttribute("x2", String(cx));
    hair.setAttribute("visibility", "visible");
    tip.replaceChildren();
    const head = document.createElement("div");
    head.className = "yr";
    head.textContent = `${measure.year} ${years[at]}`;
    tip.appendChild(head);
    series.forEach((s, k) => {
      const v = s.values[at];
      marks[k].setAttribute("visibility", v == null ? "hidden" : "visible");
      if (v != null) {
        marks[k].setAttribute("cx", String(cx));
        marks[k].setAttribute("cy", String(y(v)));
      }
      const row = document.createElement("div");
      const key = document.createElement("i");
      key.style.background = `var(${s.color})`;
      const val = document.createElement("b");
      val.textContent = v == null ? "—" : `${measure.format(v)} ${measure.unit}`;
      row.append(key, val, document.createTextNode(` ${s.name}`));
      tip.appendChild(row);
    });
    tip.hidden = false;
    tip.style.left = `${Math.min(W - 150, Math.max(0, cx + 10))}px`;
  };
  const hide = () => {
    at = -1;
    tip.hidden = true;
    hair.setAttribute("visibility", "hidden");
    for (const m of marks) m.setAttribute("visibility", "hidden");
  };
  svg.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    show(Math.round(((e.clientX - r.left - PAD.l) / (W - PAD.l - PAD.r)) * (years.length - 1)));
  });
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("blur", hide);
  svg.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    show(at < 0 ? years.length - 1 : at + (e.key === "ArrowRight" ? 1 : -1));
  });

  const table = document.createElement("details");
  table.className = "table";
  const sum = document.createElement("summary");
  sum.textContent = "Table";
  const t = document.createElement("table");
  const hr = t.createTHead().insertRow();
  for (const h of [measure.year, ...series.map((s) => `${s.name} (${measure.unit})`)]) hr.appendChild(document.createElement("th")).textContent = h;
  const body = t.createTBody();
  years.forEach((yr, i) => {
    const row = body.insertRow();
    row.insertCell().textContent = String(yr);
    for (const s of series) row.insertCell().textContent = measure.format(s.values[i]);
  });
  table.append(sum, t);
  host.appendChild(table);
}
