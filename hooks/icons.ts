// Icons from Lucide (https://lucide.dev), lucide-static 1.63.0, ISC licence; `minus`, `plus` and
// `square` derive from Feather, MIT licence. Both licences are in licenses/lucide.txt.
//
// Only the shapes are copied; `iconSvg` wraps them in Lucide's own <svg> attributes. The editor
// draws an SVG in the colour of the text around it, so `currentColor` follows the theme.

const SHAPES = {
  'volume-2':
    '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
  play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
  pause: '<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>',
  'skip-back':
    '<path d="M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432z"/><path d="M3 20V4"/>',
  'skip-forward':
    '<path d="M21 4v16"/><path d="M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z"/>',
  square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'loader-circle': '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  'chevrons-up-down': '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  'chevrons-down-up': '<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>',
  settings:
    '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
} as const

export type IconName = keyof typeof SHAPES

/** Seconds per turn of a spinning icon. */
const TURN = 0.9

/** An icon as an SVG document at `size` pixels; `isSpinning` turns it, for a loading state. */
export function iconSvg(name: IconName, { size = 16, opacity = 0.85, isSpinning = false } = {}): string {
  const shapes = isSpinning
    ? `<g>${SHAPES[name]}<animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="${TURN}s" repeatCount="indefinite"/></g>`
    : SHAPES[name]
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}">${shapes}</svg>`
  )
}
