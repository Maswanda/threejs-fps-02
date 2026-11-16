// Emberline Depot — the look plan in one place. Dusk over a freight depot: cold slate
// structures, warm sodium lamps, one amber accent. The same names are the CSS custom
// properties in index.html, so the page and the scene never drift apart.
export const PALETTE = {
  canvas: '#171a20',
  surface: '#22262e',
  hairline: '#333943',
  ink: '#ece7db',
  muted: '#9aa3ad',
  accent: '#f2a33c',
  amber: '#f2a33c',
  rust: '#b4552d',
  sentinel: '#5d7ea6',
  vanguard: '#f2a33c',
  ground: '#262a31',
  containerA: '#7a4a2b',
  containerB: '#3d5a4a',
  containerC: '#5a4a6e',
  crate: '#6e5a38',
  sky: '#20262f',
};

export function shade(name) {
  return PALETTE[name];
}
