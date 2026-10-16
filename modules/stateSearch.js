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
