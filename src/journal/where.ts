// Coordinates typed or pasted for a new spot: "27.1859, -80.1607", with or without the
// comma, as map apps copy them. Only places in and around Florida count.

export function parseWhere(text: string): [lat: number, lon: number] | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const [lat, lon] = [Number(m[1]), Number(m[2])];
  return lat >= 24 && lat <= 31.5 && lon >= -88 && lon <= -79.5 ? [lat, lon] : null;
}
