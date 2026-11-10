// Filtering for the desktop state combobox. Items are {code, name, aliases?}.
// Pure: app.js builds the items from the native <select> options.

const normalize = s => s.toLowerCase().replace(/\./g, '');

// 0 = exact code/name/alias, 1 = prefix of the name or any word in it, 2 = substring, -1 = no match.
const rank = (item, q) => {
  const name = normalize(item.name);
  const keys = [item.code.toLowerCase(), name, ...(item.aliases || [])];
  if (keys.includes(q)) return 0;
  if (name.split(' ').some(word => word.startsWith(q))) return 1;
  if (keys.some(k => k.includes(q))) return 2;
  return -1;
};

// Matches ranked best-first, ties kept in original (alphabetical) order - so "ne" leads with
// Nebraska rather than Maine, and Enter on a typed query commits the most likely state.
export const filterStates = (items, query) => {
  const q = normalize(query.trim());
  if (!q) return items.slice();
  return items
    .map((item, i) => ({ item, i, r: rank(item, q) }))
    .filter(x => x.r !== -1)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.item);
};

// Option index an ArrowDown (direction 1) / ArrowUp (direction -1) moves the highlight to, or
// -1 for an empty list. With nothing highlighted yet (activeIdx -1) the move starts beside the
// committed option at `anchorIdx`, so arrowing through the freshly opened list continues from
// the current state; with no anchor (-1, e.g. a typed filter) down starts at the first option
// and up at the last.
export const stepOptionIndex = (direction, activeIdx, anchorIdx, count) => {
  if (count <= 0) return -1;
  const from = activeIdx >= 0 ? activeIdx : anchorIdx;
  if (direction > 0) return Math.min(from + 1, count - 1);
  if (from === -1) return count - 1;
  return Math.max(from - 1, 0);
};
