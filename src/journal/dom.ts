// Minimal element builder. Everything members type (notes, names, species)
// goes in as text nodes, never HTML.

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const k of kids) if (k != null && k !== false) el.append(typeof k === "number" ? String(k) : k);
  return el;
}

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
