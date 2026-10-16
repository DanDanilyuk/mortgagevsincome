// Significant U.S. housing market events surfaced as vertical chart guides.
// `date` is the closest Thursday to the actual event; the chart will align
// the marker to that label. `short` shows on the chart, `label` in tooltip.

export const HOUSING_EVENTS = [
  { date: '2020-03-19', short: 'COVID',     label: 'Fed cuts rates to near zero (COVID emergency)' },
  { date: '2021-01-07', short: 'Boom',      label: 'Pandemic housing boom kicks off' },
  { date: '2022-03-17', short: 'Fed hikes', label: 'Fed begins rate-hike cycle' },
  { date: '2023-03-09', short: 'SVB',       label: 'SVB collapse / banking stress' },
  { date: '2023-10-19', short: '~8% peak',  label: '30-year mortgage rate peaks near 8%' },
  { date: '2024-09-19', short: 'Fed cuts',  label: 'Fed begins rate-cut cycle (-50bps)' },
];

// Label index an event snaps to: the first label on or after its date (labels are sorted
// YYYY-MM-DD strings). -1 when the event predates every label - otherwise it would snap onto
// index 0 - or falls after the last one.
export const eventLabelIndex = (labels, eventDate) => {
  if (!labels.length || eventDate < labels[0]) return -1;
  return labels.findIndex(d => d >= eventDate);
};

// Events whose marker sits on `index` (used by the tooltip footer).
export const eventsAtIndex = (labels, index, events = HOUSING_EVENTS) =>
  events.filter(evt => eventLabelIndex(labels, evt.date) === index);

// Greedy row assignment so neighbouring event labels don't overprint each other.
// `spans` are {left, right} pixel extents in ascending x order; returns a row per span
// (0 = top row). A span reuses the first row whose last label ends `gap` px before it.
export const assignLabelRows = (spans, gap = 4) => {
  const rowRight = [];
  return spans.map(({ left, right }) => {
    let row = rowRight.findIndex(edge => left >= edge + gap);
    if (row === -1) row = rowRight.length;
    rowRight[row] = right;
    return row;
  });
};
