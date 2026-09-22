import { LIMITS, isCapability, isId } from './model';

export function roomPath(pathname: string) {
  const match = /^\/api\/rooms\/([^/]+)(?:\/(ticket|socket|creatures)(?:\/([^/]+)(?:\/(image))?)?)?$/.exec(pathname);
  if (!match || !isId(match[1]) || (match[3] && !isId(match[3]))) return null;
  return { id: match[1], action: match[2] || 'snapshot', creatureId: match[3], image: !!match[4] };
}
export function bearer(header: string | null): string | null {
  const value = header?.startsWith('Bearer ') ? header.slice(7) : '';
  return isCapability(value) ? value : null;
}
export function roomExpired(expiresAt: number, now: number) { return now >= expiresAt; }
export function canAdd(count: number, bytes: number, incoming: number) {
  return count < LIMITS.roomCreatures && incoming <= LIMITS.pngBytes && bytes + incoming <= LIMITS.roomCreatures * LIMITS.pngBytes;
}
export function duplicateStatus(existingDigest: string | undefined, incomingDigest: string): 'new' | 'same' | 'conflict' {
  return !existingDigest ? 'new' : existingDigest === incomingDigest ? 'same' : 'conflict';
}
