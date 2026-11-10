// Date-range window math shared by the zoom (setDateRange) and the CSV/table
// range (computeRangeIndices). Pure: takes the data's min/max date strings and
// the entry list; no window/document/state references at module scope.
import { toIsoLocal } from './format.js';

// Parse a YYYY-MM-DD string with the 3-arg Date constructor (no UTC round-trip).
const parseLocal = dateStr => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// Compute the [startIso, endIso] window for a named range. `all` spans minDate..maxDate;
// 1y/2y/5y subtract whole years from maxDate. Mirrors the original inline math.
export const rangeWindow = (range, minDate, maxDate) => {
  const [ey, em, ed] = maxDate.split('-').map(Number);
  const end = new Date(ey, em - 1, ed);
  let start;
  if (range === '1y') start = new Date(ey - 1, em - 1, ed);
  else if (range === '2y') start = new Date(ey - 2, em - 1, ed);
  else if (range === '5y') start = new Date(ey - 5, em - 1, ed);
  else start = parseLocal(minDate);
  return { startIso: toIsoLocal(start), endIso: toIsoLocal(end) };
};

// Raw findIndex results for the window edges (-1 when no row matches), against a
// list of entries each having a `.date` YYYY-MM-DD string. Callers apply their own
// clamping/guards: setDateRange bails when start is -1 and clamps end to len-1.
export const rangeEdgeIndices = (items, range, minDate, maxDate) => {
  const { startIso, endIso } = rangeWindow(range, minDate, maxDate);
  return {
    startIndex: items.findIndex(d => d.date >= startIso),
    endIndex: items.findIndex(d => d.date >= endIso),
  };
};

// Clamped [start, end] indices used by the CSV export + data table: start clamps
// to 0 and end clamps to the last index when the window edge has no exact match.
export const clampedRangeIndices = (items, range, minDate, maxDate) => {
  const { startIndex, endIndex } = rangeEdgeIndices(items, range, minDate, maxDate);
  return {
    start: startIndex === -1 ? 0 : startIndex,
    end: endIndex === -1 ? items.length - 1 : endIndex,
  };
};

// Whole, in-bounds [start, end] indices for a zoomed/panned category-scale window, whose
// min/max may be fractional or overshoot the data. Used so the CSV/table follow what is
// actually on screen after a wheel zoom or drag pan rather than the last range button.
export const clampIndexRange = (min, max, length) => {
  const start = Math.min(Math.max(0, Math.ceil(min)), length - 1);
  const end = Math.max(Math.min(length - 1, Math.floor(max)), start);
  return { start, end };
};

// Slide a [min, max] index window by the least amount that brings `index` on screen, keeping
// its width and staying inside the data. null when the index is already visible. Lets keyboard
// stepping (arrows / Home / End) pan the chart instead of walking the marker off its edge.
export const windowIncludingIndex = (min, max, index, length) => {
  if (index >= min && index <= max) return null;
  const width = max - min;
  const start = index < min ? index : index - width;
  const clamped = Math.min(Math.max(0, start), Math.max(0, length - 1 - width));
  return { min: clamped, max: clamped + width };
};

// The window a zoom/pan left on screen, as whole in-bounds indices - or null when the chart
// shows exactly what the named range selects (zoomed all the way back out on "all", stepped
// back to the latest point, or the debounced wheel callback landing after a range-button
// click). null means the range button describes the view again, so exports follow the range.
export const manualWindow = (items, range, minDate, maxDate, min, max) => {
  const { startIndex, endIndex } = rangeEdgeIndices(items, range, minDate, maxDate);
  const namedEnd = endIndex !== -1 ? endIndex : items.length - 1;
  if (min === startIndex && max === namedEnd) return null;
  return clampIndexRange(min, max, items.length);
};
