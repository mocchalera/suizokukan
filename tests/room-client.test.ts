import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRoom, sessionKey, storeRoom } from '../src/lib/room-client';
import { creature } from './fixtures';

describe('tab-scoped room capabilities', () => {
  const id = creature().id; const join = 'a'.repeat(64); const owner = 'b'.repeat(64);
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    vi.stubGlobal('location', { hash: '', pathname: `/room/${id}` });
    vi.stubGlobal('history', { replaceState: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('retains owner when the same invitation is pasted again', () => {
    storeRoom(id, { join, owner }); storeRoom(id, { join });
    expect(readRoom(id)).toEqual({ join, owner });
  });
  it('retains owner on fragment re-entry and strips the fragment', () => {
    storeRoom(id, { join, owner }); location.hash = `#join=${join}`;
    expect(readRoom(id)).toEqual({ join, owner });
    expect(history.replaceState).toHaveBeenCalledWith({}, '', `/room/${id}`);
  });
  it('never transfers ownership to a different invitation or room', () => {
    storeRoom(id, { join, owner }); storeRoom(id, { join: 'c'.repeat(64) });
    expect(readRoom(id)).toEqual({ join: 'c'.repeat(64) });
    storeRoom(creature(2).id, { join }); expect(readRoom(creature(2).id)).toEqual({ join });
  });
  it('recovers from malformed storage without inventing ownership', () => {
    sessionStorage.setItem(sessionKey(id), '{'); storeRoom(id, { join });
    expect(readRoom(id)).toEqual({ join });
    expect(() => storeRoom(id, { join, owner: 'short' })).toThrow();
  });
});
