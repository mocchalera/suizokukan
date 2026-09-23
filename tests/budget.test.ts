import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DailyBudget } from '../worker/budget';

vi.mock('cloudflare:workers', () => ({ DurableObject: class { constructor(protected ctx: unknown, protected env: unknown) {} } }));

const databases: DatabaseSync[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const database of databases.splice(0)) database.close(); });

function budget() {
  const database = new DatabaseSync(':memory:'); databases.push(database);
  const sql = { exec: (query: string, ...bindings: (string | number)[]) => {
    const statement = database.prepare(query);
    const rows = statement.columns().length ? statement.all(...bindings) : (statement.run(...bindings), []);
    return { toArray: () => rows, one: () => rows[0] };
  } };
  const storage = { sql, setAlarm: vi.fn(async (_deadline: number) => {}), deleteAll: vi.fn(async () => {}) };
  const context = { storage };
  return new DailyBudget(context as never, {} as never);
}

async function ask(instance: DailyBudget, kind: string, visitor: string, limit: number) {
  const response = await instance.fetch(new Request('https://internal/budget', { method: 'POST', body: JSON.stringify({ kind, visitor, limit }) }));
  return { status: response.status, allowed: (await response.json() as { allowed?: boolean }).allowed };
}

const hex = (index: number) => index.toString(16).padStart(64, '0');

describe('daily budget', () => {
  it('rejects unknown kinds and malformed visitors', async () => {
    const instance = budget();
    expect(await ask(instance, 'nope', hex(1), 10)).toEqual({ status: 400, allowed: false });
    expect(await ask(instance, 'jev', 'short', 10)).toEqual({ status: 400, allowed: false });
  });

  it('allows jev up to 100 per visitor and 1000 overall, ignoring larger requested limits', async () => {
    const perVisitor = budget();
    for (let index = 0; index < 100; index += 1) expect(await ask(perVisitor, 'jev', hex(1), 1000)).toEqual({ status: 200, allowed: true });
    expect(await ask(perVisitor, 'jev', hex(1), 1000)).toEqual({ status: 200, allowed: false });

    const overall = budget();
    for (let index = 1; index <= 1000; index += 1) expect(await ask(overall, 'jev', hex(index), 5000)).toEqual({ status: 200, allowed: true });
    expect(await ask(overall, 'jev', hex(1001), 5000)).toEqual({ status: 200, allowed: false });
  });

  it('keeps rooms at 40 overall and 12 per visitor', async () => {
    const perVisitor = budget();
    for (let index = 0; index < 12; index += 1) expect(await ask(perVisitor, 'rooms', hex(1), 40)).toEqual({ status: 200, allowed: true });
    expect(await ask(perVisitor, 'rooms', hex(1), 40)).toEqual({ status: 200, allowed: false });

    const overall = budget();
    for (let index = 1; index <= 40; index += 1) expect(await ask(overall, 'rooms', hex(index), 40)).toEqual({ status: 200, allowed: true });
    expect(await ask(overall, 'rooms', hex(41), 40)).toEqual({ status: 200, allowed: false });
  });
});
