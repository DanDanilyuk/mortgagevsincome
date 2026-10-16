import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterStates } from '../../modules/stateSearch.js';

const items = [
  { code: 'ALL', name: 'U.S.A', aliases: ['us', 'united states'] },
  { code: 'CA', name: 'California' },
  { code: 'ME', name: 'Maine' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WV', name: 'West Virginia' },
];
const codes = list => list.map(it => it.code);

describe('filterStates', () => {
  it('returns everything for an empty query', () => {
    assert.equal(filterStates(items, '  ').length, items.length);
  });

  it('puts an exact code match first', () => {
    assert.equal(codes(filterStates(items, 'ne'))[0], 'NE');
  });

  it('ranks name prefixes above substrings', () => {
    assert.deepEqual(codes(filterStates(items, 'new')), ['NY']);
    // NE exact code, then Nevada / New York prefixes, then Maine (substring) last.
    assert.deepEqual(codes(filterStates(items, 'ne')), ['NE', 'NV', 'NY', 'ME']);
  });

  it('matches word prefixes inside multi-word names', () => {
    assert.deepEqual(codes(filterStates(items, 'york')), ['NY']);
  });

  it('prefers the exact name over a longer name containing it', () => {
    assert.deepEqual(codes(filterStates(items, 'virginia')), ['VA', 'WV']);
  });

  it('finds the national view by US / USA / alias, ignoring dots', () => {
    assert.equal(codes(filterStates(items, 'us'))[0], 'ALL');
    assert.equal(codes(filterStates(items, 'USA'))[0], 'ALL');
    assert.equal(codes(filterStates(items, 'u.s.a'))[0], 'ALL');
    assert.equal(codes(filterStates(items, 'united'))[0], 'ALL');
  });

  it('is case-insensitive and trims whitespace', () => {
    assert.deepEqual(codes(filterStates(items, '  MAINE ')), ['ME']);
  });

  it('returns an empty list when nothing matches', () => {
    assert.deepEqual(filterStates(items, 'zzz'), []);
  });
});
