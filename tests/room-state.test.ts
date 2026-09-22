import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../shared/model';
import { digest } from '../worker/http';
import { SeaRoom } from '../worker/room';
import { creature, png, replacePngData } from './fixtures';

vi.mock('cloudflare:workers', () => ({ DurableObject: class { constructor(protected ctx: unknown, protected env: unknown) {} } }));

const databases: DatabaseSync[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const database of databases.splice(0)) database.close(); });

async function setup(legacy = false) {
  const database = new DatabaseSync(':memory:'); databases.push(database);
  const join = 'a'.repeat(64); const owner = 'b'.repeat(64); const expires = Date.now() + LIMITS.roomMs;
  const meta = { expires, join_hash: await digest(join), owner_hash: await digest(owner) };
  const sql = { exec: (query: string, ...bindings: (string | number)[]) => {
    const statement = database.prepare(query);
    const rows = statement.columns().length ? statement.all(...bindings) : (statement.run(...bindings), []);
    return { toArray: () => rows, one: () => rows[0] };
  } };
  const storage = {
    sql, setAlarm: vi.fn(async (_deadline: number) => {}), deleteAlarm: vi.fn(async () => {}),
    deleteAll: vi.fn(async () => { for (const table of ['meta', 'creatures', 'tickets', 'rates']) database.exec(`DROP TABLE IF EXISTS ${table}`); }),
    transactionSync: (callback: () => void) => {
      database.exec('BEGIN');
      try { callback(); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; }
    },
  };
  const messages: { type: string; id?: string }[] = [];
  const makeSocket = (role: 'guest' | 'owner') => {
    let attachment = { role, window: Date.now(), count: 0 };
    return { send: (text: string) => messages.push(JSON.parse(text)), close: vi.fn(), deserializeAttachment: () => attachment, serializeAttachment: (value: typeof attachment) => { attachment = value; } };
  };
  const socket = makeSocket('owner');
  const starting: Promise<unknown>[] = [];
  const context = { storage, setWebSocketAutoResponse: vi.fn(), getWebSockets: () => [socket], blockConcurrencyWhile: (callback: () => Promise<unknown>) => { const pending = callback(); starting.push(pending); return pending; } };
  vi.stubGlobal('WebSocketRequestResponsePair', class {});
  if (legacy) {
    sql.exec('CREATE TABLE meta (expires INTEGER, join_hash TEXT, owner_hash TEXT)');
    sql.exec('INSERT INTO meta VALUES (?, ?, ?)', meta.expires, meta.join_hash, meta.owner_hash);
    sql.exec('CREATE TABLE creatures (id TEXT PRIMARY KEY, payload TEXT NOT NULL, digest TEXT NOT NULL, bytes INTEGER NOT NULL, ready INTEGER DEFAULT 0, sender TEXT)');
    sql.exec('INSERT INTO creatures VALUES (?, ?, ?, ?, 0, ?)', creature().id, JSON.stringify(creature()), 'old-digest', 100, 'みずいろ');
  }
  const room = new SeaRoom(context as unknown as ConstructorParameters<typeof SeaRoom>[0], {} as ConstructorParameters<typeof SeaRoom>[1]);
  await Promise.all(starting);
  if (!legacy) expect((await room.fetch(new Request('https://room.internal/init', { method: 'POST', body: JSON.stringify(meta) }))).status).toBe(201);
  const request = (suffix = '', method = 'GET', body?: unknown, key = join) => room.fetch(new Request(`https://umi.test/api/rooms/${creature(99).id}${suffix}`, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
  const ack = (id = creature().id) => room.webSocketMessage(socket as unknown as WebSocket, JSON.stringify({ type: 'ready', id }));
  return { room, storage, messages, request, ack, socket, makeSocket, expires, owner };
}

describe('room state transitions using the real handler and SQLite', () => {
  it('only publishes the first ready transition; guest and unknown ACKs do not mutate state', async () => {
    const current = await setup();
    await current.request('/creatures', 'POST', { creature: creature(), sender: 'みずいろ' });
    await current.room.webSocketMessage(current.makeSocket('guest') as unknown as WebSocket, JSON.stringify({ type: 'ready', id: creature().id }));
    expect(current.room.rows()[0].ready).toBe(0);
    await current.ack(); await current.ack(); await current.ack(creature(2).id);
    expect(current.messages.filter(message => message.type === 'ready')).toHaveLength(1);
    expect(current.room.rows()[0].ready).toBe(1);
  });
  it('expires pending exactly at its deadline, erases pixels and keeps a deduplication tombstone', async () => {
    const clock = vi.spyOn(Date, 'now'); let now = 1_790_000_000_000; clock.mockImplementation(() => now);
    const current = await setup(); const body = { creature: creature(), sender: 'みずいろ' };
    await current.request('/creatures', 'POST', body);
    expect(current.storage.setAlarm).toHaveBeenLastCalledWith(now + LIMITS.roomPendingMs);
    now += LIMITS.roomPendingMs - 1; await current.room.alarm(); expect(current.room.rows()[0].ready).toBe(0);
    now++; await current.room.alarm();
    const row = current.room.rows()[0];
    expect(row.ready).toBe(-1); expect(row.bytes).toBe(0); expect(JSON.parse(row.payload)).not.toHaveProperty('image');
    expect(current.storage.setAlarm).toHaveBeenLastCalledWith(current.expires);
    const snapshot = await (await current.request()).json() as { creatures: { ready: boolean; failed: boolean }[] };
    expect(snapshot.creatures[0]).toMatchObject({ ready: false, failed: true });
    expect((await current.request(`/creatures/${creature().id}/image`)).status).toBe(410);
    await current.ack(); expect(current.messages.filter(message => message.type === 'ready')).toHaveLength(0);
    const duplicate = await (await current.request('/creatures', 'POST', body)).json();
    expect(duplicate).toMatchObject({ duplicate: true, failed: true, ready: false });
    expect(current.room.rows()[0].pending_until).toBe(row.pending_until);
    expect((await current.request('/creatures', 'POST', { ...body, sender: 'きいろ' })).status).toBe(409);
    expect((await current.request(`/creatures/${creature().id}`, 'DELETE', undefined, current.owner)).status).toBe(200);
    expect((await current.request('/creatures', 'POST', body)).status).toBe(201);
    expect(current.room.rows()[0].pending_until).toBe(now + LIMITS.roomPendingMs);
  });
  it('rejects late ACKs even when the alarm was delayed, and preserves ready images until room TTL', async () => {
    let now = 1_790_000_000_000; vi.spyOn(Date, 'now').mockImplementation(() => now);
    const current = await setup();
    for (const index of [1, 2]) await current.request('/creatures', 'POST', { creature: creature(index), sender: 'みずいろ' });
    await current.ack(); now += LIMITS.roomPendingMs; await current.ack(creature(2).id);
    expect(current.room.rows().map(row => row.ready)).toEqual([1, -1]);
    await current.room.alarm(); expect(current.room.rows()[0].bytes).toBeGreaterThan(0);
    now = current.expires; expect((await current.request()).status).toBe(410); await current.room.alarm();
    expect(current.room.meta()).toBeNull(); expect(current.storage.deleteAll).toHaveBeenCalledTimes(1);
    await current.room.alarm(); expect(current.storage.deleteAll).toHaveBeenCalledTimes(1);
  });
  it('upgrades the old table non-destructively and schedules existing pending entries', async () => {
    const current = await setup(true); const row = current.room.rows()[0];
    expect(row.digest).toBe('old-digest'); expect(row.ready).toBe(0);
    expect(row.pending_until).toBeGreaterThan(Date.now() + 29000);
    expect(current.storage.setAlarm).toHaveBeenLastCalledWith(row.pending_until);
    expect(current.room.meta()?.expires).toBe(current.expires);
  });
  it('does not store or serve corrupted compressed PNGs including pre-existing rows', async () => {
    const current = await setup(); const invalid = { ...creature(), image: replacePngData(png(), Buffer.from([120, 156, 255])) };
    expect((await current.request('/creatures', 'POST', { creature: invalid, sender: 'みずいろ' })).status).toBe(400);
    expect(current.room.rows()).toHaveLength(0);
    current.storage.sql.exec('INSERT INTO creatures VALUES (?, ?, ?, ?, 1, ?, 0)', invalid.id, JSON.stringify(invalid), 'legacy', 50, 'みずいろ');
    const response = await current.request(`/creatures/${invalid.id}/image`);
    expect(response.status).toBe(400); expect(response.headers.get('Content-Type')).not.toContain('image/png');
  });
});
