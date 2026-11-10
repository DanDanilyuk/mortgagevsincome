import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rankIntensities } from '../../modules/ranking.js';

describe('rankIntensities', () => {
  it('spreads values from 90 (highest) down to 10 (lowest) by rank', () => {
    assert.deepEqual(rankIntensities([35.3, 22.4, 8.5]), [90, 50, 10]);
  });

  it('keeps each result aligned with its input position', () => {
    assert.deepEqual(rankIntensities([8.5, 35.3, 22.4]), [10, 90, 50]);
  });

  it('does not let one outlier compress the rest of the scale', () => {
    assert.deepEqual(rankIntensities([35.3, 12, 11, 10, 9]), [90, 70, 50, 30, 10]);
  });

  it('gives equal values the same intensity', () => {
    assert.deepEqual(rankIntensities([20, 15, 15, 10]), [90, 63, 63, 10]);
  });

  it('puts a lone value mid-scale', () => {
    assert.deepEqual(rankIntensities([12.3]), [50]);
  });

  it('returns an empty list for no values', () => {
    assert.deepEqual(rankIntensities([]), []);
  });
});
