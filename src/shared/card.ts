// The floating info card shown when something on the map is tapped.

export interface CardContent {
  title: string;
  kind: string;
  /** Trusted HTML (authored copy with <b> emphasis). Escape any data you interpolate. */
  body: string;
  color?: string;
}

export class InfoCard {
  private el = document.getElementById("card")!;
  private bodyEl = document.getElementById("cardBody")!;
  onShow?: () => void;
  onHide?: () => void;

  constructor() {
    document.getElementById("cardX")!.addEventListener("click", () => this.hide());
  }

  show({ title, kind, body, color }: CardContent): void {
    const h2 = document.createElement("h2");
    h2.textContent = title;
    const k = document.createElement("div");
    k.className = "kind";
    k.textContent = kind;
    if (color) k.style.color = color;
    const p = document.createElement("p");
    p.innerHTML = body;
    this.bodyEl.replaceChildren(h2, k, p);
    this.el.classList.add("on");
    this.onShow?.();
  }

  hide(): void {
    this.el.classList.remove("on");
    this.onHide?.();
  }
}
