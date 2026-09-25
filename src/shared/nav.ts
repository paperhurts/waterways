// The site nav's behavior. Its markup comes from src/shared/site.ts at build time;
// this folds it into an "All maps" menu on phones and shows the journal link to
// members.

import { hasStoredSession } from "../journal/session";
import "./nav.css";

const nav = document.querySelector<HTMLElement>("nav.site");
const button = nav?.querySelector<HTMLButtonElement>(".menu");
if (nav && button) {
  const setOpen = (open: boolean) => {
    nav.classList.toggle("open", open);
    button.setAttribute("aria-expanded", String(open));
  };
  button.addEventListener("click", () => setOpen(!nav.classList.contains("open")));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !nav.classList.contains("open")) return;
    setOpen(false);
    button.focus();
  });
  // Capture, because the maps take the pointer for panning.
  document.addEventListener("pointerdown", (e) => {
    if (!nav.contains(e.target as Node)) setOpen(false);
  }, true);
  if (hasStoredSession()) nav.querySelector(".journal")?.removeAttribute("hidden");
}
