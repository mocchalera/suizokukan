import { clamp, type Creature } from './model';

export type Swimmer = { id: string; seed: number; x: number; y: number; direction: number; phase: number; reaction: number };
export type SeaEvent = { x: number; y: number; type: 'bubble' | 'food' | 'call'; age: number; id?: string };
export function hashSeed(text: string): number {
  let seed = 2166136261;
  for (const character of text) { seed ^= character.charCodeAt(0); seed = Math.imul(seed, 16777619); }
  return seed >>> 0;
}
export function createSwimmer(id: string): Swimmer {
  const seed = hashSeed(id);
  return { id, seed, x: 0.15 + (seed % 701) / 1000, y: 0.18 + ((seed >>> 10) % 550) / 1000, direction: seed % 2 ? 1 : -1, phase: (seed % 628) / 100, reaction: 0 };
}
export function tickSwimmer(state: Swimmer, creature: Pick<Creature, 'swim' | 'personality'>, delta: number, event?: SeaEvent): void {
  const dt = Number.isFinite(delta) ? clamp(delta, 0, 0.05) : 0;
  const speed = (0.015 + creature.personality.energy * 0.03) * (creature.swim === 'float' ? 0.35 : 1);
  state.phase += dt * (creature.swim === 'odd' ? 1.7 : 1.1);
  state.reaction = Math.max(0, state.reaction - dt * 0.4);
  let attraction = 0;
  if (event && event.age < 5 && (!event.id || event.id === state.id)) {
    const distance = Math.hypot(event.x - state.x, event.y - state.y);
    if (event.type === 'call' || distance < 0.42) {
      attraction = event.type === 'bubble' && creature.personality.mood === 'shy' && distance < 0.13 ? -1 : 1;
      if (event.type === 'bubble') attraction *= creature.personality.bubbleLove;
      state.direction = event.x > state.x ? attraction >= 0 ? 1 : -1 : attraction >= 0 ? -1 : 1;
      state.y += (event.y - state.y) * dt * 0.4 * attraction;
      state.reaction = 1;
    }
  }
  state.x += state.direction * speed * dt * (attraction ? 1.6 : 1);
  state.y += Math.sin(state.phase + state.seed % 7) * dt * (creature.swim === 'swim' ? 0.009 : 0.025);
  if (state.x > 0.92) state.direction = -1;
  if (state.x < 0.08) state.direction = 1;
  state.x = clamp(state.x, 0.06, 0.94);
  state.y = clamp(state.y, 0.15, 0.82);
}
