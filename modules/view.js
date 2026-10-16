// Single / dual-income view <-> dataset visibility. Pure: the app.js legend handler
// injects the live state.currentView.

export const viewVisibility = view => ({
  single: view !== 'household',
  household: view !== 'single',
});

// null when neither series would be visible - the chart never goes empty.
export const viewFromVisibility = (single, household) => {
  if (single && household) return 'both';
  if (single) return 'single';
  if (household) return 'household';
  return null;
};

// The view a legend click on dataset 0 (single) or 1 (dual) toggles to, so the legend and the
// Compare Both / Single Earner / Dual Income buttons can't disagree. Other indices leave it alone.
export const viewAfterLegendToggle = (view, datasetIndex) => {
  const { single, household } = viewVisibility(view);
  if (datasetIndex === 0) return viewFromVisibility(!single, household);
  if (datasetIndex === 1) return viewFromVisibility(single, !household);
  return view;
};
