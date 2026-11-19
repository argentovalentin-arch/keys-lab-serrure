/**
 * Keys Performance's colours, in one place (keys-lab-livrables/01-identite-keys-performance.md).
 *
 * BRAND holds the exact values of the official identity: the variables of the theme on
 * keysperformance.com, checked against the pixels of the official logo files. They are
 * not to be adjusted here.
 *
 * LAB holds what the Lab adds for its night: shades derived from the brand's own colours,
 * never new hues. The light in the Lab is champagne (the full stop of the cream logo),
 * whitening towards off-white at the heart of a source; the night is the brand's navy,
 * deepened.
 */
export const BRAND = {
  navy: '#16213f',
  offwhite: '#fdfbf5',
  champagne: '#e9d7b4',
  prune: '#3b2144',
  cashmere: '#dfbca9',
  navy80: '#3c4560',
  navy60: '#5b6178',
} as const;

export const LAB = {
  /** The night: navy mixed with 35 % black. */
  night: '#0e1529',
  /** Light: champagne. */
  light: BRAND.champagne,
  /** The heart of a light, where it burns to off-white. */
  lightCore: BRAND.offwhite,
  /** Points of light at rest: off-white. */
  dust: BRAND.offwhite,
  /** What warms as it moves or is touched: cashmere, the brand's warm second. */
  warmth: BRAND.cashmere,
} as const;
