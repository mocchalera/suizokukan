import { describe, expect, it } from 'vitest';
import { createSwimmer, tickSwimmer, type SeaEvent } from '../shared/behavior';
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
  it.each(['food', 'call', 'bubble'] as const)('arrives at %s without flipping back and forth', type => {
    for (const frameRate of [30, 60, 144]) {
      for (const swim of ['swim', 'float', 'odd'] as const) {
        const state = { ...createSwimmer('fish'), x: 0.5, y: 0.5, direction: 1 };
        let turns = 0;
        for (let frame = 0; frame < frameRate * 4; frame++) {
          const direction = state.direction;
          tickSwimmer(state, { swim, personality: PRESETS.curious }, 1 / frameRate, { type, x: 0.501, y: 0.5, age: frame / frameRate });
          if (state.direction !== direction) turns++;
        }
        expect(turns, `${swim} at ${frameRate}fps`).toBeLessThanOrEqual(1);
        expect(Math.abs(state.x - 0.501)).toBeLessThan(0.02);
      }
    }
  });
  it('keeps a comfortable distance from bubbles without alternating fear and attraction', () => {
    const state = { ...createSwimmer('shy'), x: 0.37, y: 0.5, direction: 1 };
    let turns = 0;
    for (let frame = 0; frame < 240; frame++) {
      const direction = state.direction;
      tickSwimmer(state, { swim: 'swim', personality: PRESETS.shy }, 1 / 60, { type: 'bubble', x: 0.5, y: 0.5, age: frame / 60 });
      if (state.direction !== direction) turns++;
    }
    expect(turns).toBeLessThanOrEqual(1);
    expect(Math.hypot(state.x - 0.5, state.y - 0.5)).toBeGreaterThanOrEqual(0.12);
    expect(Math.hypot(state.x - 0.5, state.y - 0.5)).toBeLessThan(0.23);
  });
  it('does not turn toward bubbles when bubbleLove is zero', () => {
    const state = { ...createSwimmer('fish'), x: 0.5, y: 0.5, direction: -1 };
    const wandering = { ...state };
    const selected = { swim: 'swim' as const, personality: { ...PRESETS.curious, bubbleLove: 0 } };
    tickSwimmer(state, selected, 0.05, { type: 'bubble', x: 0.55, y: 0.5, age: 0 });
    tickSwimmer(wandering, selected, 0.05);
    expect(state).toEqual(wandering);
  });
  it('handles edge targets and resumes swimming after the event expires', () => {
    for (const targetX of [0, 1]) {
      const state = { ...createSwimmer('fish'), x: targetX ? 0.91 : 0.09, y: 0.5, direction: targetX ? 1 : -1 };
      const event: SeaEvent = { type: 'food', x: targetX, y: 0.5, age: 0 };
      let turns = 0;
      for (let frame = 0; frame < 240; frame++) {
        const direction = state.direction;
        tickSwimmer(state, creature(), 1 / 60, { ...event, age: frame / 60 });
        if (state.direction !== direction) turns++;
      }
      expect(turns).toBeLessThanOrEqual(1);
      const arrivedX = state.x;
      for (let frame = 0; frame < 240; frame++) tickSwimmer(state, creature(), 1 / 60, { ...event, age: 6 });
      expect(Math.abs(state.x - arrivedX)).toBeGreaterThan(0.05);
      expect(state.direction).toBe(targetX ? -1 : 1);
    }
  });
});
