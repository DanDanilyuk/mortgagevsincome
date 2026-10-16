import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { viewVisibility, viewFromVisibility, viewAfterLegendToggle } from '../../modules/view.js';

describe('viewVisibility', () => {
  it('shows both series for the compare view', () => {
    assert.deepEqual(viewVisibility('both'), { single: true, household: true });
  });

  it('hides the other series for single/household', () => {
    assert.deepEqual(viewVisibility('single'), { single: true, household: false });
    assert.deepEqual(viewVisibility('household'), { single: false, household: true });
  });
});

describe('viewFromVisibility', () => {
  it('maps visibility pairs back to view names', () => {
    assert.equal(viewFromVisibility(true, true), 'both');
    assert.equal(viewFromVisibility(true, false), 'single');
    assert.equal(viewFromVisibility(false, true), 'household');
  });

  it('returns null when nothing would be visible', () => {
    assert.equal(viewFromVisibility(false, false), null);
  });
});

describe('viewAfterLegendToggle', () => {
  it('hiding single from compare leaves dual income', () => {
    assert.equal(viewAfterLegendToggle('both', 0), 'household');
  });

  it('hiding dual from compare leaves single earner', () => {
    assert.equal(viewAfterLegendToggle('both', 1), 'single');
  });

  it('re-showing the hidden series returns to compare', () => {
    assert.equal(viewAfterLegendToggle('single', 1), 'both');
    assert.equal(viewAfterLegendToggle('household', 0), 'both');
  });

  it('refuses to hide the only visible series', () => {
    assert.equal(viewAfterLegendToggle('single', 0), null);
    assert.equal(viewAfterLegendToggle('household', 1), null);
  });

  it('leaves the view alone for the U.S. overlay', () => {
    assert.equal(viewAfterLegendToggle('single', 2), 'single');
  });
});
