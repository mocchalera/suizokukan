import { LIMITS, object, personality } from '../shared/model';
import { roomPath } from '../shared/room-policy';
import { BUILD } from './generated/build';
import type { AppEnv } from './env';
import { boundedJson, digest, errorResponse, HttpError, json, token } from './http';
import { interpretNote, jevAvailable, validateNote } from './jev';
export { SeaRoom } from './room';
export { DailyBudget } from './budget';

async function allow(env: AppEnv, request: Request, kind: 'rooms' | 'jev') {
  const visitor = await digest(`${new Date().toISOString().slice(0, 10)}:${request.headers.get('CF-Connecting-IP') ?? 'local'}`);
  const result = await env.BUDGET.get(env.BUDGET.idFromName('daily')).fetch(new Request('https://internal/budget', { method: 'POST', body: JSON.stringify({ kind, visitor, limit: Number(env.JEV_DAILY_LIMIT) }) }));
  return (await result.json() as { allowed: boolean }).allowed;
}
export default {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) throw new HttpError(403, '別のサイトからは操作できません。');
      if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true, name: 'おえかきのうみ', ...BUILD, deployment: env.CF_VERSION_METADATA?.id ?? 'local', jev: jevAvailable(env) ? 'available' : 'fallback', roomTtlHours: 6 });
      if (url.pathname === '/api/personality' && request.method === 'POST') {
        const input = object(await boundedJson(request, 1800));
        const fallback = personality(input.fallback); const note = validateNote(input.note);
        if (!jevAvailable(env)) return json({ personality: fallback, mode: 'fallback', notice: 'AIは未接続です。選んだせいかくで、そのまま遊べます。' });
        if (!await allow(env, request, 'jev')) return json({ personality: fallback, mode: 'fallback', notice: '今日のAI利用上限です。選んだせいかくで泳ぎます。' });
        return json(await interpretNote(note, fallback, env.JEV_API_KEY!));
      }
      if (url.pathname === '/api/rooms' && request.method === 'POST') {
        if (!await allow(env, request, 'rooms')) throw new HttpError(429, '今日つくれるうみの上限になりました。端末のうみでは続けて遊べます。');
        const id = crypto.randomUUID(); const join = token(); const owner = token(); const expiresAt = Date.now() + LIMITS.roomMs;
        const result = await env.ROOMS.get(env.ROOMS.idFromName(id)).fetch(new Request('https://internal/init', { method: 'POST', body: JSON.stringify({ expires: expiresAt, join_hash: await digest(join), owner_hash: await digest(owner) }) }));
        if (!result.ok) throw new HttpError(503, 'うみをつくれませんでした。');
        return json({ id, join, owner, expiresAt }, 201);
      }
      const route = roomPath(url.pathname);
      if (route) {
        let forwarded = request;
        if (request.method === 'POST' && route.action === 'creatures') {
          const body = JSON.stringify(await boundedJson(request));
          const headers = new Headers(request.headers); headers.delete('content-length');
          forwarded = new Request(request.url, { method: request.method, headers, body });
        }
        return await env.ROOMS.get(env.ROOMS.idFromName(route.id)).fetch(forwarded);
      }
      throw new HttpError(404, 'このAPIはありません。');
    } catch (error) { return errorResponse(error); }
  },
} satisfies ExportedHandler<AppEnv>;
