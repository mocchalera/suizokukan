import { LIMITS } from '../shared/model';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
export async function boundedJson(request: Request, maximum: number = LIMITS.requestBytes): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'JSON形式で送ってください。');
  if (Number(request.headers.get('content-length')) > maximum) throw new HttpError(413, 'データが大きすぎます。');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'データがありません。');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new HttpError(413, 'データが大きすぎます。'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); } catch { throw new HttpError(400, 'データを読めません。'); }
  } finally { reader.releaseLock(); }
}
export const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('');
export async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export const errorResponse = (error: unknown) => json({ error: error instanceof HttpError ? error.message : 'データを受け取れませんでした。もう一度確認してください。' }, error instanceof HttpError ? error.status : 400);
