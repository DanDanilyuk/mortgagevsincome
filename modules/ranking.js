// Shading for the "All states, ranked" grid. Pure: app.js feeds it the latest ratios.

const MIN_INTENSITY = 10;
const MAX_INTENSITY = 90;

// Tile heat (a color-mix percentage) per value, by rank: the highest value gets 90, the
// lowest 10, evenly spaced in between, and equal values share a step. Results line up with
// the input order. Rank rather than magnitude because one outlier (Hawaii near 35x against a
// field of 9-22x) otherwise squeezes every other state into the same few shades.
export const rankIntensities = values => {
  if (values.length <= 1) return values.map(() => (MIN_INTENSITY + MAX_INTENSITY) / 2);
  const step = (MAX_INTENSITY - MIN_INTENSITY) / (values.length - 1);
  return values.map(v => Math.round(MAX_INTENSITY - step * values.filter(o => o > v).length));
};
