// Data-quality labelling for a series entry + per-card estimation-badge precedence.
// Pure: no window/document/state references at module scope.

// Data-table quality cell: estimated (extrapolated) wins over observed; anything
// neither observed nor estimated is interpolated (Hermite-filled between months).
export const qualityLabel = entry => {
  if (entry.estimated) return { text: 'Estimated', cls: 'quality-estimated' };
  if (entry.observed) return { text: 'Observed', cls: 'quality-observed' };
  return { text: 'Interpolated', cls: 'quality-interpolated' };
};

// Info-card estimation badge precedence: a field-level "estimated" flag wins
// ("Estimated"); otherwise an interpolated row gets "Interpolated"; otherwise no
// badge. `isInterpolated` is the row-level `!observed && !estimated` derived flag.
export const estimationBadge = (isFieldEstimated, isInterpolated) => {
  if (isFieldEstimated) return { active: true, label: 'Estimated' };
  if (isInterpolated) return { active: true, label: 'Interpolated' };
  return { active: false, label: '' };
};

// Horizontal extent of the amber "estimated" tint: from the first estimated point to the right
// edge of the plot, clipped to the plot. null when there is nothing to paint - the tail is
// panned off to the right. Unclipped, a zoom into the tail tinted the y-axis labels (the point
// sits far left of the plot) and a pan away tinted the gutter right of it.
export const estimatedRegionSpan = (startX, plotLeft, plotRight) => {
  const x = Math.max(startX, plotLeft);
  if (!(x < plotRight)) return null;
  return { x, width: plotRight - x };
};
