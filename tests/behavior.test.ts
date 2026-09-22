import { describe, expect, it } from 'vitest';
import { createSwimmer, tickSwimmer } from '../shared/behavior';
import { PRESETS } from '../shared/model';
import { creature } from './fixtures';

describe('local deterministic behavior', () => {
  it('repeats exactly with the same seed and event sequence', () => {
    const first = createSwimmer('fish'); const second = createSwimmer('fish');
    for (let frame = 0; frame < 500; frame++) { tickSwimmer(first, creature(), 1 / 60); tickSwimmer(second, creature(), 1 / 60); }
    expect(first).toEqual(second);
  });
  it('clamps long frame gaps and invalid dt', () => {
    const first = createSwimmer('fish'); const second = createSwimmer('fish');
    tickSwimmer(first, creature(), 200); tickSwimmer(second, creature(), 0.05); expect(first).toEqual(second);
    tickSwimmer(first, creature(), NaN); expect(first).toEqual(second);
  });
  it('keeps 20 creatures bounded over a long simulated session', () => {
    for (let index = 0; index < 20; index++) {
      const state = createSwimmer(`fish-${index}`);
      for (let frame = 0; frame < 10000; frame++) tickSwimmer(state, { swim: ['swim', 'float', 'odd'][index % 3] as 'swim', personality: PRESETS.curious }, 0.05);
      expect(state.x).toBeGreaterThanOrEqual(0.06); expect(state.x).toBeLessThanOrEqual(0.94);
      expect(state.y).toBeGreaterThanOrEqual(0.15); expect(state.y).toBeLessThanOrEqual(0.82);
    }
  });
  it('reacts to food, targeted calls and shy close bubbles', () => {
    const state = { ...createSwimmer('fish'), x: 0.5, y: 0.5 };
    tickSwimmer(state, { swim: 'swim', personality: PRESETS.shy }, 0.02, { type: 'bubble', x: 0.55, y: 0.5, age: 0 }); expect(state.direction).toBe(-1);
    tickSwimmer(state, creature(), 0.02, { type: 'food', x: 0.6, y: 0.5, age: 0 }); expect(state.direction).toBe(1); expect(state.reaction).toBe(1);
    const before = createSwimmer('other'); const untouched = { ...before };
    tickSwimmer(before, creature(), 0, { type: 'call', id: 'fish', x: 0, y: 0, age: 0 }); expect(before).toEqual(untouched);
  });
});
