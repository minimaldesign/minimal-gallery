/** The theme's icons: 16px, 1.5px strokes, drawn here. */
export const ICONS = {
  square: '<rect x="2.75" y="2.75" width="10.5" height="10.5" rx="1"/>',
  original: '<rect x="1.75" y="4" width="12.5" height="8" rx="1"/>',
  grid: '<rect x="2.25" y="2.25" width="4.75" height="4.75" rx=".75"/><rect x="9" y="2.25" width="4.75" height="4.75" rx=".75"/><rect x="2.25" y="9" width="4.75" height="4.75" rx=".75"/><rect x="9" y="9" width="4.75" height="4.75" rx=".75"/>',
  list: '<path d="M6 4h7.5M6 8h7.5M6 12h7.5M2.5 4h.5M2.5 8h.5M2.5 12h.5"/>',
  small: '<rect x="5.25" y="5.25" width="5.5" height="5.5" rx=".75"/>',
  medium: '<rect x="3.75" y="3.75" width="8.5" height="8.5" rx="1"/>',
  large: '<rect x="2.25" y="2.25" width="11.5" height="11.5" rx="1"/>',
  cover:
    '<rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1"/><path d="M4.5 6.5V5.5h1.5M11.5 6.5V5.5H10M4.5 9.5v1h1.5M11.5 9.5v1H10"/>',
  contain:
    '<rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1"/><rect x="5.25" y="5.75" width="5.5" height="4.5" rx=".5"/>',
  info: '<circle cx="8" cy="8" r="6.25"/><path d="M8 7.25v4M8 4.75v.25"/>',
  filter: '<path d="M2.25 3.25h11.5l-4.5 5.25v4.25l-2.5 1v-5.25z"/>',
  strip:
    '<rect x="1.75" y="3.75" width="12.5" height="8.5" rx="1"/><path d="M1.75 6h12.5M1.75 10h12.5M6 6v4M10 6v4"/>',
} as const;
export type IconName = keyof typeof ICONS;
