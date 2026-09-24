// Colors live in CSS custom properties (src/shared/tokens.css). Canvas drawing
// can't reference var(--x), so read the resolved values and re-read them when
// the color scheme flips.

const root = document.documentElement;

export const cssVar = (name: string): string => getComputedStyle(root).getPropertyValue(name).trim();

export function isDark(): boolean {
  const theme = root.dataset.theme;
  if (theme) return theme === "dark";
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

export function onColorSchemeChange(cb: () => void): void {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", cb);
}

export const prefersReducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

export const fontsReady = (): Promise<unknown> => (document.fonts ? document.fonts.ready : Promise.resolve());
