import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOUSING_EVENTS,
  eventLabelIndex,
  eventsAtIndex,
  assignLabelRows,
} from '../../modules/events.js';

const labels = ['2022-03-10', '2022-03-17', '2022-03-24', '2022-03-31'];

describe('eventLabelIndex', () => {
  it('snaps to the exact label when present', () => {
    assert.equal(eventLabelIndex(labels, '2022-03-17'), 1);
  });

  it('snaps forward to the next label when the date falls between Thursdays', () => {
    assert.equal(eventLabelIndex(labels, '2022-03-20'), 2);
  });

  it('returns -1 for events before the first label instead of snapping to index 0', () => {
    assert.equal(eventLabelIndex(labels, '2020-03-19'), -1);
  });

  it('returns -1 for events after the last label', () => {
    assert.equal(eventLabelIndex(labels, '2024-09-19'), -1);
  });

  it('returns -1 for an empty label list', () => {
    assert.equal(eventLabelIndex([], '2022-03-17'), -1);
  });
});

describe('eventsAtIndex', () => {
  it('finds the event whose marker sits on the index', () => {
    const found = eventsAtIndex(labels, 1);
    assert.equal(found.length, 1);
    assert.equal(found[0].short, 'Fed hikes');
  });

  it('returns nothing for an index without an event', () => {
    assert.deepEqual(eventsAtIndex(labels, 0), []);
  });

  it('every built-in event has a short and long label', () => {
    HOUSING_EVENTS.forEach(evt => {
      assert.ok(evt.short && evt.label, `event on ${evt.date} is missing a label`);
      assert.match(evt.date, /^\d{4}-\d{2}-\d{2}$/);
    });
  });
});

describe('assignLabelRows', () => {
  it('keeps well-separated labels on the top row', () => {
    assert.deepEqual(
      assignLabelRows([{ left: 0, right: 40 }, { left: 100, right: 140 }]),
      [0, 0],
    );
  });

  it('drops an overlapping label to the next row', () => {
    assert.deepEqual(
      assignLabelRows([{ left: 0, right: 40 }, { left: 30, right: 70 }]),
      [0, 1],
    );
  });

  it('reuses the top row once there is room again', () => {
    assert.deepEqual(
      assignLabelRows([
        { left: 0, right: 40 },
        { left: 30, right: 70 },
        { left: 50, right: 90 },
      ]),
      [0, 1, 0],
    );
  });

  it('honours the gap between neighbours', () => {
    assert.deepEqual(assignLabelRows([{ left: 0, right: 40 }, { left: 42, right: 80 }], 4), [0, 1]);
    assert.deepEqual(assignLabelRows([{ left: 0, right: 40 }, { left: 44, right: 80 }], 4), [0, 0]);
  });
});
