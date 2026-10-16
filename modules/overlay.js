// U.S. national comparison overlay (dataset index 2). Pure: the app.js wrappers
// inject the live state.currentState / state.nationalCache / state.chartData.

// The overlay is only shown for a single state (never 'ALL'), when the user
// hasn't toggled it off, and once the national data has been fetched.
export const isOverlayVisible = (currentState, showOverlay, nationalCache) =>
  currentState !== 'ALL' && showOverlay && !!nationalCache;

// Chart.js lists every dataset in the legend, including hidden ones. Dataset
// index 2 is the U.S. overlay - keep it out of the legend unless it can render
// (a single-state view with cache loaded). Deliberately ignores the user's
// show/hide toggle: a toggled-off overlay stays listed (struck through) so a
// second legend click can bring it back.
export const shouldIncludeLegendItem = (datasetIndex, currentState, nationalCache) =>
  datasetIndex !== 2 || (currentState !== 'ALL' && !!nationalCache);

// Build the overlay series aligned to the displayed state's dates. Dates missing
// from the national cache fall through as null (Chart.js spanGaps bridges them).
// Returns an all-null array of `length` when there is no cache or the view is 'ALL'.
export const buildOverlayData = (length, currentState, nationalCache, stateData) => {
  if (!nationalCache || currentState === 'ALL') return Array(length).fill(null);
  const map = new Map(
    nationalCache.single_costs.map(d => [d.date, parseFloat(d.cost_to_income)]),
  );
  return stateData.single_costs.map(d => (map.has(d.date) ? map.get(d.date) : null));
};
