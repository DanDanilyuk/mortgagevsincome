import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatMoney,
  formatSignedMoney,
  formatDate,
  formatAxisDate,
  toIsoLocal,
  formatRelativeTime,
} from '../../modules/format.js';

describe('formatMoney', () => {
  it('rounds half-up and adds a dollar sign', () => {
    assert.equal(formatMoney(1234.4), '$1,234');
    assert.equal(formatMoney(1234.5), '$1,235');
  });

  it('handles zero', () => {
    assert.equal(formatMoney(0), '$0');
  });

  it('separates thousands', () => {
    assert.equal(formatMoney(1234567), '$1,234,567');
  });
});

describe('formatSignedMoney', () => {
  it('prefixes the sign before the dollar', () => {
    assert.equal(formatSignedMoney(1234), '+$1,234');
    assert.equal(formatSignedMoney(-1234), '-$1,234');
  });

  it('uses + for zero', () => {
    assert.equal(formatSignedMoney(0), '+$0');
  });

  it('uses + when a small negative rounds to zero', () => {
    assert.equal(formatSignedMoney(-0.4), '+$0');
  });
});

describe('formatAxisDate', () => {
  it('keeps the day for short windows', () => {
    assert.equal(formatAxisDate('2025-10-16', 52), 'Oct 16, 2025');
  });

  it('collapses to month + year for long windows', () => {
    assert.equal(formatAxisDate('2025-10-16', 104), 'Oct 2025');
  });

  it('does not roll back a month on the 1st (no UTC parse)', () => {
    assert.equal(formatAxisDate('2025-01-01', 260), 'Jan 2025');
  });
});

describe('formatDate', () => {
  it('renders a YYYY-MM-DD string in en-US short format', () => {
    const result = formatDate('2025-05-14');
    assert.equal(result, 'May 14, 2025');
  });

  it('avoids UTC roll-back for early-day strings', () => {
    const result = formatDate('2025-01-01');
    assert.equal(result, 'Jan 1, 2025');
  });
});

describe('toIsoLocal', () => {
  it('formats local date components without UTC conversion', () => {
    const d = new Date(2025, 4, 14);
    assert.equal(toIsoLocal(d), '2025-05-14');
  });

  it('pads single-digit month and day', () => {
    const d = new Date(2025, 0, 5);
    assert.equal(toIsoLocal(d), '2025-01-05');
  });
});

describe('formatRelativeTime', () => {
  it('returns minute-resolution for a date within the hour', () => {
    const d = new Date(Date.now() - 30 * 60 * 1000);
    const result = formatRelativeTime(d);
    assert.match(result, /minutes? ago/);
  });

  it('returns hour-resolution for a date earlier today', () => {
    const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const result = formatRelativeTime(d);
    assert.match(result, /hours? ago/);
  });

  it('returns day-resolution for a date last week', () => {
    const d = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const result = formatRelativeTime(d);
    assert.match(result, /(days? ago|yesterday)/);
  });
});
