import { describe, expect, it } from 'vitest';
import { bearer, canAdd, duplicateStatus, roomExpired, roomPath } from '../shared/room-policy';
import { LIMITS } from '../shared/model';
import { boundedJson, digest, token } from '../worker/http';
import { creature } from './fixtures';

describe('private room security contract', () => {
  it('requires a full capability, never a room ID or short numeric code', () => {
    expect(bearer(null)).toBeNull(); expect(bearer('Bearer 123456')).toBeNull(); expect(bearer(`Bearer ${creature().id}`)).toBeNull();
    expect(bearer(`Bearer ${'a'.repeat(64)}`)).toBe('a'.repeat(64)); expect(bearer(`Bearer ${'a'.repeat(64)} extra`)).toBeNull();
    expect(token()).toMatch(/^[a-f0-9]{64}$/); expect(token()).not.toBe(token());
  });
  it('only routes canonical IDs, not listing paths or traversal', () => {
    expect(roomPath(`/api/rooms/${creature().id}/creatures/${creature(2).id}/image`)?.image).toBe(true);
    for (const path of ['/api/rooms', '/api/rooms/all', '/api/rooms/../secrets', '/api/rooms/123456', `/api/rooms/${creature().id}/external`]) expect(roomPath(path)).toBeNull();
  });
  it('expires exactly at six hours and enforces count and byte caps', () => {
    expect(LIMITS.roomMs).toBe(21600000); expect(roomExpired(21600000, 21599999)).toBe(false); expect(roomExpired(21600000, 21600000)).toBe(true);
    expect(canAdd(19, 3420000, 180000)).toBe(true); expect(canAdd(20, 1, 1)).toBe(false);
    expect(canAdd(1, 0, 180001)).toBe(false); expect(canAdd(1, 3600000, 1)).toBe(false);
  });
  it('recognizes an exact retry but conflicts on changed payloads', async () => {
    const first = await digest(JSON.stringify(creature())); const same = await digest(JSON.stringify(creature())); const changed = await digest(JSON.stringify({ ...creature(), name: 'different' }));
    expect(duplicateStatus(undefined, first)).toBe('new'); expect(duplicateStatus(first, same)).toBe('same'); expect(duplicateStatus(first, changed)).toBe('conflict');
  });
  it('bounds streaming JSON even without a declared content length', async () => {
    const request = (body: string, type = 'application/json') => new Request('https://umi.test/api', { method: 'POST', headers: { 'Content-Type': type }, body });
    await expect(boundedJson(request('{"ok":true}'))).resolves.toEqual({ ok: true });
    await expect(boundedJson(request(' '.repeat(25)), 20)).rejects.toMatchObject({ status: 413 });
    await expect(boundedJson(request('<html>', 'text/html'))).rejects.toMatchObject({ status: 415 });
    await expect(boundedJson(request('{'))).rejects.toMatchObject({ status: 400 });
  });
});
