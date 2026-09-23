import { clamp, type Creature } from './model';

export type Swimmer = { id: string; seed: number; x: number; y: number; direction: number; facingDirection: number; turnProgress: number; turnCooldown: number; phase: number; reaction: number };
export type SeaEvent = { x: number; y: number; type: 'bubble' | 'food' | 'call'; age: number; id?: string };
export function hashSeed(text: string): number {
  let seed = 2166136261;
  for (const character of text) { seed ^= character.charCodeAt(0); seed = Math.imul(seed, 16777619); }
  return seed >>> 0;
}
export function createSwimmer(id: string): Swimmer {
  const seed = hashSeed(id);
  const direction = seed % 2 ? 1 : -1;
  return { id, seed, x: 0.15 + (seed % 701) / 1000, y: 0.18 + ((seed >>> 10) % 550) / 1000, direction, facingDirection: direction, turnProgress: 0, turnCooldown: 0, phase: (seed % 628) / 100, reaction: 0 };
}
export function tickSwimmer(state: Swimmer, creature: Pick<Creature, 'swim' | 'personality'>, delta: number, event?: SeaEvent): void {
  const dt = Number.isFinite(delta) ? clamp(delta, 0, 0.05) : 0;
  if (!dt) return;
  const speed = (0.015 + creature.personality.energy * 0.03) * (creature.swim === 'float' ? 0.35 : 1);
  state.phase += dt * (creature.swim === 'odd' ? 1.7 : 1.1);
  state.reaction = Math.max(0, state.reaction - dt * 0.4);
  let movement = state.direction * speed * dt;
  let interacting = false;
  if (event && event.age < 5 && (!event.id || event.id === state.id) && (event.type !== 'bubble' || creature.personality.bubbleLove > 0)) {
    const targetX = clamp(event.x, 0.08, 0.92); const targetY = clamp(event.y, 0.15, 0.82);
    const offset = targetX - state.x;
    const distance = Math.hypot(offset, targetY - state.y);
    if (event.type === 'call' || distance < 0.42) {
      interacting = true;
      let attraction = 1;
      if (event.type === 'bubble' && creature.personality.mood === 'shy') attraction = distance < 0.13 ? -1 : distance > 0.20 ? 1 : 0;
      if (event.type === 'bubble') attraction *= creature.personality.bubbleLove;
      const step = speed * dt * 1.6 * Math.abs(attraction);
      movement = attraction < 0 ? (Math.sign(-offset) || state.direction) * step : Math.sign(offset) * Math.min(step, Math.max(0, Math.abs(offset) - 0.015));
      state.y += (targetY - state.y) * dt * 0.4 * attraction;
      state.reaction = 1;
    }
  }
  if (interacting) {
    const nextX = clamp(state.x + movement, 0.08, 0.92);
    if (Math.abs(nextX - state.x) > 0.000001) state.direction = Math.sign(nextX - state.x);
    state.x = nextX;
  } else {
    state.x += movement;
    if (state.x > 0.92) state.direction = -1;
    if (state.x < 0.08) state.direction = 1;
  }
  state.y += Math.sin(state.phase + state.seed % 7) * dt * (creature.swim === 'swim' ? 0.009 : 0.025);
  state.x = clamp(state.x, 0.06, 0.94);
  state.y = clamp(state.y, 0.15, 0.82);
  state.turnCooldown = Math.max(0, state.turnCooldown - dt);
  if (state.direction === state.facingDirection) state.turnProgress = 0;
  else {
    state.turnProgress += dt;
    if (state.turnProgress >= 0.18 && state.turnCooldown === 0) {
      state.facingDirection = state.direction;
      state.turnProgress = 0;
      state.turnCooldown = 0.5;
    }
  }
}
