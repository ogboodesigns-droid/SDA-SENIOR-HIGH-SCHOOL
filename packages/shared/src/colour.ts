/** Black or white, whichever reads better on the given #rrggbb background (e.g. dark text on yellow). */
export function textOn(hex: string): '#1a1a1a' | '#ffffff' {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '#ffffff';
  const [r, g, b] = m.slice(1).map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast against white vs. against near-black.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.06 ? '#ffffff' : '#1a1a1a';
}
