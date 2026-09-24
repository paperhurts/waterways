// The journal's map: visited springs and wildlife sightings over USGS imagery
// or topo, with a layer per animal group that can be switched on and off.

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { StatewideSpring } from "../shared/types";
import type { SpringSummary, Visit } from "./api";
import { GROUPS, groupColor, type AnimalGroup } from "./wildlife";

// USGS National Map basemaps: public domain, no API key, and the imagery shows
// the spring pools and runs themselves.
const usgs = (svc: string) => `https://basemap.nationalmap.gov/arcgis/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`;
export type Basemap = "imagery" | "topo";
const BASEMAPS: Record<Basemap, { url: string; maxNativeZoom: number }> = {
  imagery: { url: usgs("USGSImageryOnly"), maxNativeZoom: 19 },
  topo: { url: usgs("USGSTopo"), maxNativeZoom: 16 },
};
const HYDRO = usgs("USGSHydroCached");
const ATTRIBUTION = '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>';
const FLORIDA: L.LatLngBoundsExpression = [[24.4, -87.7], [31.1, -79.9]];
/** Sightings logged without GPS sit in a small ring around their spring so they don't stack. */
const RING_M = 35;

export type LayerId = AnimalGroup | "visited" | "unvisited";

export interface LayerInfo {
  id: LayerId;
  label: string;
  color: string;
  count: number;
  on: boolean;
}

export class JournalMap {
  private map: L.Map;
  private tiles: L.TileLayer;
  private hydro: L.TileLayer;
  basemap: Basemap;
  private layers = new Map<LayerId, L.LayerGroup>();
  private counts = new Map<LayerId, number>();
  private dark: boolean;

  constructor(
    el: HTMLElement,
    private springs: Map<string, StatewideSpring>,
    private onOpenSpring: (id: string) => void,
    dark: boolean,
    basemap: Basemap,
  ) {
    this.dark = dark;
    this.basemap = basemap;
    this.map = L.map(el, { zoomControl: true, attributionControl: true, preferCanvas: true }).fitBounds(FLORIDA);
    this.tiles = L.tileLayer(BASEMAPS[basemap].url, { attribution: ATTRIBUTION, maxZoom: 19, maxNativeZoom: BASEMAPS[basemap].maxNativeZoom }).addTo(this.map);
    this.hydro = L.tileLayer(HYDRO, { maxZoom: 19, maxNativeZoom: 16, opacity: 0.8 });
    for (const id of ["unvisited", "visited", ...GROUPS.map((g) => g.id)] as LayerId[]) {
      const layer = L.layerGroup();
      if (id !== "unvisited") layer.addTo(this.map);
      this.layers.set(id, layer);
    }
  }

  private ring = () => (this.dark ? "#ece4cf" : "#1f2419");

  setData(visits: Visit[], summary: Map<string, SpringSummary>): void {
    for (const l of this.layers.values()) l.clearLayers();
    this.counts.clear();
    const bump = (id: LayerId) => this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
    const spring = "#5fd8cc";

    for (const s of this.springs.values()) {
      const sum = summary.get(s[0]);
      const layer: LayerId = sum ? "visited" : "unvisited";
      const m = L.circleMarker([s[4], s[3]], sum
        ? { radius: 7, color: this.ring(), weight: 2, fillColor: this.dark ? spring : "#0a8f86", fillOpacity: 0.95 }
        : { radius: 3.5, color: this.dark ? "#8c8577" : "#5b6152", weight: 1, fillOpacity: 0.5 });
      m.bindTooltip(s[1] + (sum ? ` · ${sum.visits} visit${sum.visits > 1 ? "s" : ""}` : ""));
      m.on("click", () => this.onOpenSpring(s[0]));
      m.addTo(this.layers.get(layer)!);
      bump(layer);
    }

    for (const v of visits) {
      const s = this.springs.get(v.spring_id);
      v.sightings.forEach((x, i) => {
        let lat: number;
        let lon: number;
        if (x.from_gps && x.lat != null && x.lon != null) {
          lat = x.lat;
          lon = x.lon;
        } else {
          if (!s) return;
          const a = (i / Math.max(1, v.sightings.length)) * Math.PI * 2 + v.id.charCodeAt(0);
          lat = s[4] + (Math.sin(a) * RING_M) / 111_320;
          lon = s[3] + (Math.cos(a) * RING_M) / (111_320 * Math.cos((s[4] * Math.PI) / 180));
        }
        const m = L.circleMarker([lat, lon], { radius: 6, color: this.ring(), weight: 1.5, fillColor: groupColor(x.animal_group, this.dark), fillOpacity: 0.95 });
        m.bindPopup(() => sightingPopup(x.species, x.count, v.visited_on, s?.[1] ?? "", x.from_gps, () => this.onOpenSpring(v.spring_id)));
        m.addTo(this.layers.get(x.animal_group)!);
        bump(x.animal_group);
      });
    }
  }

  layerInfo(): LayerInfo[] {
    const info = (id: LayerId, label: string, color: string): LayerInfo => ({ id, label, color, count: this.counts.get(id) ?? 0, on: this.map.hasLayer(this.layers.get(id)!) });
    return [
      info("visited", "Springs we've visited", this.dark ? "#5fd8cc" : "#0a8f86"),
      info("unvisited", "Springs not yet visited", this.dark ? "#8c8577" : "#5b6152"),
      ...GROUPS.map((g) => info(g.id, g.label, groupColor(g.id, this.dark))),
    ];
  }

  toggle(id: LayerId, on: boolean): void {
    const l = this.layers.get(id)!;
    if (on) l.addTo(this.map);
    else l.remove();
  }

  focus(springId: string): void {
    const s = this.springs.get(springId);
    if (s) this.map.flyTo([s[4], s[3]], 15, { duration: 0.8 });
  }

  /** Frame everything we've logged, or all of Florida if there's nothing yet. */
  fitData(): void {
    const pts: L.LatLngExpression[] = [];
    for (const id of ["visited", ...GROUPS.map((g) => g.id)] as LayerId[]) {
      this.layers.get(id)!.eachLayer((m) => pts.push((m as L.CircleMarker).getLatLng()));
    }
    if (pts.length) this.map.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 13 });
    else this.map.fitBounds(FLORIDA);
  }

  setTheme(dark: boolean): void {
    this.dark = dark;
  }

  setBasemap(b: Basemap): void {
    this.basemap = b;
    this.tiles.options.maxNativeZoom = BASEMAPS[b].maxNativeZoom;
    this.tiles.setUrl(BASEMAPS[b].url);
  }

  /** The USGS streams-and-lakes overlay. */
  setHydro(on: boolean): void {
    if (on) this.hydro.addTo(this.map);
    else this.hydro.remove();
  }

  get hydroOn(): boolean {
    return this.map.hasLayer(this.hydro);
  }

  resize(): void {
    this.map.invalidateSize();
  }
}

function sightingPopup(species: string, count: number | null, date: string, spring: string, gps: boolean, open: () => void): HTMLElement {
  const el = document.createElement("div");
  el.className = "pop";
  const b = document.createElement("b");
  b.textContent = count && count > 1 ? `${species} × ${count}` : species;
  const meta = document.createElement("div");
  meta.textContent = `${formatDate(date)} · ${spring}`;
  const where = document.createElement("div");
  where.className = "muted";
  where.textContent = gps ? "Pinned by GPS" : "Logged at the spring";
  const link = document.createElement("button");
  link.type = "button";
  link.className = "linkish";
  link.textContent = "Open visit";
  link.addEventListener("click", open);
  el.append(b, meta, where, link);
  return el;
}

export const formatDate = (iso: string): string =>
  new Date(`${iso}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
