// Pinned to en-US: the figures are U.S. dollars, so a de-DE visitor shouldn't see "$761.715".
export const formatMoney = val => '$' + Math.round(val).toLocaleString('en-US');

// Sign follows the rounded value so -0.4 renders "+$0", not "-$0".
export const formatSignedMoney = val => {
  const rounded = Math.round(val);
  return `${rounded < 0 ? '-' : '+'}$${Math.abs(rounded).toLocaleString('en-US')}`;
};

export const formatDate = dateStr => {
  const [y, m, d] = dateStr.split('-');
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

// X-axis tick label. Long windows (more than ~70 weekly points) only need month + year;
// shorter ones keep the day so neighbouring ticks stay distinct.
export const formatAxisDate = (dateStr, spanPoints) => {
  if (spanPoints <= 70) return formatDate(dateStr);
  const [y, m] = dateStr.split('-');
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
};

export const toIsoLocal = date => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const formatRelativeTime = date => {
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const diffSec = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, 'second');
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
  const diffHr = Math.round(diffSec / 3600);
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, 'hour');
  const diffDay = Math.round(diffSec / 86400);
  if (Math.abs(diffDay) < 30) return rtf.format(diffDay, 'day');
  const diffMonth = Math.round(diffDay / 30);
  if (Math.abs(diffMonth) < 12) return rtf.format(diffMonth, 'month');
  return rtf.format(Math.round(diffMonth / 12), 'year');
};
