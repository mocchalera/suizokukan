import { DurableObject } from 'cloudflare:workers';
import type { AppEnv } from './env';
import { json } from './http';

export class DailyBudget extends DurableObject<AppEnv> {
  async fetch(request: Request) {
    const { kind, visitor, limit } = await request.json() as { kind: 'rooms' | 'jev'; visitor: string; limit: number };
    if (!['rooms', 'jev'].includes(kind) || !/^[a-f0-9]{64}$/.test(visitor)) return json({ allowed: false }, 400);
    const date = new Date().toISOString().slice(0, 10);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, value INTEGER NOT NULL)');
    this.ctx.storage.sql.exec('DELETE FROM counters WHERE key NOT LIKE ?', `${date}:%`);
    const totalKey = `${date}:${kind}:total`; const visitorKey = `${date}:${kind}:${visitor}`;
    const count = (key: string) => this.ctx.storage.sql.exec<{ value: number }>('SELECT value FROM counters WHERE key = ?', key).toArray()[0]?.value ?? 0;
    const maximum = kind === 'rooms' ? 40 : Math.max(0, Math.min(1000, Number.isFinite(limit) ? Math.floor(limit) : 0));
    if (count(totalKey) >= maximum || count(visitorKey) >= (kind === 'rooms' ? 12 : 100)) return json({ allowed: false });
    for (const key of [totalKey, visitorKey]) this.ctx.storage.sql.exec('INSERT INTO counters VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1', key);
    await this.ctx.storage.setAlarm(Date.now() + 48 * 60 * 60 * 1000);
    return json({ allowed: true });
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}
