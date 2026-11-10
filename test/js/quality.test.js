import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { qualityLabel, estimationBadge, estimatedRegionSpan } from '../../modules/quality.js';

describe('qualityLabel', () => {
  it('labels an estimated (extrapolated) entry', () => {
    assert.deepEqual(qualityLabel({ estimated: true, observed: false }), {
      text: 'Estimated',
      cls: 'quality-estimated',
    });
  });

  it('labels an observed entry', () => {
    assert.deepEqual(qualityLabel({ estimated: false, observed: true }), {
      text: 'Observed',
      cls: 'quality-observed',
    });
  });

  it('falls through to Interpolated when neither observed nor estimated', () => {
    assert.deepEqual(qualityLabel({ estimated: false, observed: false }), {
      text: 'Interpolated',
      cls: 'quality-interpolated',
    });
  });

  it('estimated takes precedence over observed', () => {
    assert.equal(qualityLabel({ estimated: true, observed: true }).text, 'Estimated');
  });
});

describe('estimationBadge', () => {
  it('shows "Estimated" when the field is estimated (wins over interpolated)', () => {
    assert.deepEqual(estimationBadge(true, false), { active: true, label: 'Estimated' });
    assert.deepEqual(estimationBadge(true, true), { active: true, label: 'Estimated' });
  });

  it('shows "Interpolated" when the row is interpolated and the field is not estimated', () => {
    assert.deepEqual(estimationBadge(false, true), { active: true, label: 'Interpolated' });
  });

  it('shows no badge when the field is neither estimated nor interpolated', () => {
    assert.deepEqual(estimationBadge(false, false), { active: false, label: '' });
  });
});

describe('estimatedRegionSpan', () => {
  it('runs from the first estimated point to the right edge of the plot', () => {
    assert.deepEqual(estimatedRegionSpan(1100, 50, 1212), { x: 1100, width: 112 });
  });

  it('starts at the left edge of the plot when that point is zoomed off to the left', () => {
    assert.deepEqual(estimatedRegionSpan(-1056, 60, 1200), { x: 60, width: 1140 });
  });

  it('is null when the estimated tail is panned off to the right', () => {
    assert.equal(estimatedRegionSpan(2494, 50, 1197), null);
  });

  it('is null for a zero-width span on the right edge', () => {
    assert.equal(estimatedRegionSpan(1197, 50, 1197), null);
  });

  it('is null when the position is not a number', () => {
    assert.equal(estimatedRegionSpan(NaN, 50, 1197), null);
  });
});
