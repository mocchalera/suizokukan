import { DurableObject } from 'cloudflare:workers';
import { LIMITS, isId, object, safeName, validateCreature, type Creature } from '../shared/model';
import { bearer, canAdd, duplicateStatus, roomExpired, roomPath } from '../shared/room-policy';
import type { AppEnv } from './env';
import { boundedJson, digest, errorResponse, HttpError, json, token } from './http';
import { decodePng } from './png';

type Meta = { expires: number; join_hash: string; owner_hash: string };
type Row = { id: string; payload: string; digest: string; bytes: number; ready: number; sender: string; pending_until: number };
type SocketInfo = { role: 'owner' | 'guest'; window: number; count: number };
export class SeaRoom extends DurableObject<AppEnv> {
  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      if (!this.meta()) return;
      const columns = ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(creatures)').toArray();
      if (!columns.some(column => column.name === 'pending_until')) {
        ctx.storage.transactionSync(() => {
          ctx.storage.sql.exec('ALTER TABLE creatures ADD COLUMN pending_until INTEGER NOT NULL DEFAULT 0');
          ctx.storage.sql.exec('UPDATE creatures SET pending_until = ? WHERE ready = 0', Date.now() + LIMITS.roomPendingMs);
        });
        await this.schedule();
      }
    });
  }
  meta(): Meta | null {
    if (!this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE name = 'meta'").toArray().length) return null;
    return this.ctx.storage.sql.exec<Meta>('SELECT * FROM meta').toArray()[0] ?? null;
  }
  alive() {
    const meta = this.meta();
    if (!meta || roomExpired(meta.expires, Date.now())) throw new HttpError(410, 'このうみは おしまいです。あたらしく つくってね。');
    return meta;
  }
  rows() { return this.ctx.storage.sql.exec<Row>('SELECT * FROM creatures ORDER BY rowid').toArray(); }
  summary(row: Row) {
    const { image: _image, ...creature } = JSON.parse(row.payload) as Creature;
    return { ...creature, ready: row.ready === 1, failed: row.ready === -1, sender: row.sender };
  }
  expirePending() {
    const expired = this.ctx.storage.sql.exec<Row>('SELECT * FROM creatures WHERE ready = 0 AND pending_until <= ?', Date.now()).toArray();
    this.ctx.storage.transactionSync(() => {
      for (const row of expired) {
        const { image: _image, ...creature } = JSON.parse(row.payload) as Creature;
        this.ctx.storage.sql.exec('UPDATE creatures SET ready = -1, payload = ?, bytes = 0 WHERE id = ? AND ready = 0', JSON.stringify(creature), row.id);
      }
    });
    if (expired.length) this.broadcast(this.snapshot());
  }
  async schedule() {
    const meta = this.meta(); if (!meta) return;
    const pending = this.rows().filter(row => row.ready === 0).map(row => row.pending_until);
    await this.ctx.storage.setAlarm(Math.min(meta.expires, ...pending));
  }
  snapshot() {
    return { type: 'snapshot', expiresAt: this.alive().expires, creatures: this.rows().map(row => this.summary(row)), connections: this.ctx.getWebSockets().length };
  }
  broadcast(data: unknown) {
    const text = JSON.stringify(data);
    for (const socket of this.ctx.getWebSockets()) { try { socket.send(text); } catch { try { socket.close(1011, 'reconnect'); } catch {} } }
  }
  rate(bucket: string, limit: number) {
    const minute = Math.floor(Date.now() / 60000);
    this.ctx.storage.sql.exec('DELETE FROM rates WHERE minute < ?', minute);
    const count = this.ctx.storage.sql.exec<{ count: number }>('SELECT count FROM rates WHERE bucket = ? AND minute = ?', bucket, minute).toArray()[0]?.count ?? 0;
    if (count >= limit) throw new HttpError(429, 'すこし待ってから、もう一度。');
    this.ctx.storage.sql.exec('INSERT INTO rates VALUES (?, ?, 1) ON CONFLICT(bucket, minute) DO UPDATE SET count = count + 1', bucket, minute);
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/init' && request.method === 'POST') {
        if (this.meta()) throw new HttpError(409, '既存のうみは置き換えられません。');
        const data = await request.json() as Meta;
        this.ctx.storage.sql.exec('CREATE TABLE meta (expires INTEGER, join_hash TEXT, owner_hash TEXT)');
        this.ctx.storage.sql.exec('INSERT INTO meta VALUES (?, ?, ?)', data.expires, data.join_hash, data.owner_hash);
        this.ctx.storage.sql.exec('CREATE TABLE creatures (id TEXT PRIMARY KEY, payload TEXT NOT NULL, digest TEXT NOT NULL, bytes INTEGER NOT NULL, ready INTEGER DEFAULT 0, sender TEXT, pending_until INTEGER NOT NULL DEFAULT 0)');
        this.ctx.storage.sql.exec('CREATE TABLE tickets (hash TEXT PRIMARY KEY, role TEXT, expires INTEGER)');
        this.ctx.storage.sql.exec('CREATE TABLE rates (bucket TEXT, minute INTEGER, count INTEGER, PRIMARY KEY(bucket, minute))');
        await this.ctx.storage.setAlarm(data.expires);
        return json({ ok: true }, 201);
      }
      const route = roomPath(url.pathname);
      if (!route) throw new HttpError(404, '見つかりません。');
      const meta = this.alive();
      if (route.action === 'socket') {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') throw new HttpError(426, 'WebSocketが必要です。');
        const protocols = request.headers.get('Sec-WebSocket-Protocol')?.split(',').map(value => value.trim()) ?? [];
        if (protocols.length !== 2 || protocols[0] !== 'umi-v1' || !/^[a-f0-9]{64}$/.test(protocols[1])) throw new HttpError(401, '招待が必要です。');
        const hash = await digest(protocols[1]); this.alive();
        const ticket = this.ctx.storage.sql.exec<{ role: 'owner' | 'guest'; expires: number }>('SELECT * FROM tickets WHERE hash = ?', hash).toArray()[0];
        this.ctx.storage.sql.exec('DELETE FROM tickets WHERE hash = ? OR expires <= ?', hash, Date.now());
        if (!ticket || ticket.expires <= Date.now()) throw new HttpError(401, '接続券の期限が切れました。');
        this.expirePending();
        if (this.ctx.getWebSockets().length >= LIMITS.connections) throw new HttpError(429, '16台までつなげます。');
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1]);
        pair[1].serializeAttachment({ role: ticket.role, window: Date.now(), count: 0 } satisfies SocketInfo);
        pair[1].send(JSON.stringify(this.snapshot()));
        return new Response(null, { status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': 'umi-v1' } });
      }
      const credential = bearer(request.headers.get('Authorization'));
      if (!credential) throw new HttpError(401, '招待リンクから参加してね。');
      const hash = await digest(credential); this.alive();
      const role = hash === meta.owner_hash ? 'owner' : hash === meta.join_hash ? 'guest' : null;
      if (!role) throw new HttpError(403, 'このうみの招待ではありません。');
      this.rate('requests', 240);
      this.expirePending();
      if (route.action === 'snapshot' && request.method === 'GET') return json({ ...this.snapshot(), role });
      if (route.action === 'snapshot' && request.method === 'DELETE') {
        if (role !== 'owner') throw new HttpError(403, 'つくった人だけが終了できます。');
        await this.finish(); return json({ closed: true });
      }
      if (route.action === 'ticket' && request.method === 'POST') {
        this.ctx.storage.sql.exec('DELETE FROM tickets WHERE expires <= ?', Date.now());
        if (this.ctx.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM tickets').one().count >= 32) throw new HttpError(429, '接続を少し待ってください。');
        const ticket = token(); const ticketHash = await digest(ticket); this.alive();
        this.ctx.storage.sql.exec('INSERT INTO tickets VALUES (?, ?, ?)', ticketHash, role, Date.now() + 30000);
        return json({ ticket });
      }
      if (route.action === 'creatures' && route.creatureId && route.image && request.method === 'GET') {
        const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM creatures WHERE id = ?', route.creatureId).toArray()[0];
        if (!row) throw new HttpError(404, 'この子はもういません。');
        if (row.ready === -1) throw new HttpError(410, '届かなかった共有画像は消しました。');
        const image = (JSON.parse(row.payload) as Creature).image;
        return new Response(decodePng(image), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' } });
      }
      if (route.action === 'creatures' && route.creatureId && !route.image && request.method === 'DELETE') {
        if (role !== 'owner') throw new HttpError(403, 'つくった人だけが共有コピーを消せます。');
        this.ctx.storage.sql.exec('DELETE FROM creatures WHERE id = ?', route.creatureId);
        this.broadcast(this.snapshot()); return json({ deleted: true });
      }
      if (route.action === 'creatures' && !route.creatureId && request.method === 'POST') {
        this.rate('uploads', 30);
        const input = object(await boundedJson(request));
        const creature = validateCreature(input.creature); const sender = safeName(input.sender);
        const bytes = decodePng(creature.image).length;
        const payload = JSON.stringify(creature); const payloadDigest = await digest(payload + sender); this.alive();
        this.expirePending();
        const existing = this.ctx.storage.sql.exec<Row>('SELECT * FROM creatures WHERE id = ?', creature.id).toArray()[0];
        const duplicate = duplicateStatus(existing?.digest, payloadDigest);
        if (duplicate === 'conflict') throw new HttpError(409, '同じ子の違うデータは送れません。先に共有コピーを消してください。');
        if (duplicate === 'same') return json({ id: creature.id, ready: existing.ready === 1, failed: existing.ready === -1, duplicate: true });
        const rows = this.rows();
        if (!canAdd(rows.length, rows.reduce((sum, row) => sum + row.bytes, 0), bytes)) throw new HttpError(409, 'このうみは20匹でいっぱいです。');
        this.ctx.storage.sql.exec('INSERT INTO creatures (id,payload,digest,bytes,ready,sender,pending_until) VALUES (?,?,?,?,0,?,?)', creature.id, payload, payloadDigest, bytes, sender, Date.now() + LIMITS.roomPendingMs);
        await this.schedule();
        this.broadcast(this.snapshot()); return json({ id: creature.id, ready: false }, 201);
      }
      throw new HttpError(405, 'この操作はできません。');
    } catch (error) { return errorResponse(error); }
  }
  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    try {
      this.alive();
      this.expirePending();
      const info = socket.deserializeAttachment() as SocketInfo;
      if (Date.now() - info.window > 60000) { info.window = Date.now(); info.count = 0; }
      info.count++; socket.serializeAttachment(info);
      if (info.count > 60 || typeof message !== 'string' || message.length > 500) { socket.close(1008, 'rate or size'); return; }
      const input = object(JSON.parse(message));
      if (input.type === 'ready' && info.role === 'owner' && isId(input.id)) {
        const changed = this.ctx.storage.sql.exec('UPDATE creatures SET ready = 1 WHERE id = ? AND ready = 0 AND pending_until > ? RETURNING id', input.id, Date.now()).toArray();
        if (changed.length) this.broadcast({ type: 'ready', id: input.id });
        return;
      }
      if (['bubble', 'food', 'call'].includes(input.type as string) && typeof input.x === 'number' && typeof input.y === 'number' && Number.isFinite(input.x) && Number.isFinite(input.y) && input.x >= 0 && input.x <= 1 && input.y >= 0 && input.y <= 1 && (input.type !== 'call' || isId(input.id))) {
        this.broadcast({ type: 'interaction', interaction: { type: input.type, x: input.x, y: input.y, ...(input.type === 'call' ? { id: input.id } : {}) } }); return;
      }
      socket.send(JSON.stringify({ type: 'error', error: 'その操作は使えません。' }));
    } catch { try { socket.close(1008, 'room closed or invalid'); } catch {} }
  }
  webSocketClose(socket: WebSocket, code: number) { try { socket.close(code === 1006 ? 1000 : code); } catch {} }
  webSocketError(socket: WebSocket) { try { socket.close(1011); } catch {} }
  async finish() {
    if (this.meta()) this.ctx.storage.sql.exec('UPDATE meta SET expires = 0');
    this.broadcast({ type: 'closed' });
    for (const socket of this.ctx.getWebSockets()) { try { socket.close(1000, 'room closed'); } catch {} }
    await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll();
  }
  async alarm() {
    const meta = this.meta(); if (!meta) return;
    if (roomExpired(meta.expires, Date.now())) { await this.finish(); return; }
    this.expirePending(); await this.schedule();
  }
}
