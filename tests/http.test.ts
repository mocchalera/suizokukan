import { describe, expect, it } from 'vitest';
import { boundedJson } from '../worker/http';

function streamed(headers: Record<string, string>, text = '{}') {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode(text)); },
    cancel() { cancelled = true; },
  });
  const request = new Request('https://example.invalid', { method: 'POST', headers, body, duplex: 'half' } as RequestInit);
  return { request, cancelled: () => cancelled };
}

describe('bounded request bodies', () => {
  it('rejects declared size without reading or allocating its body', async () => {
    const input = streamed({ 'Content-Type': 'application/json', 'Content-Length': '1000' });
    await expect(boundedJson(input.request, 10)).rejects.toMatchObject({ status: 413 });
    expect(input.request.bodyUsed).toBe(false);
    await input.request.body?.cancel();
  });
  it('rejects unsupported content type before reading the body', async () => {
    const input = streamed({ 'Content-Type': 'text/plain' });
    await expect(boundedJson(input.request)).rejects.toMatchObject({ status: 415 });
    expect(input.request.bodyUsed).toBe(false);
    await input.request.body?.cancel();
  });
  it('cancels a stream that exceeds the bound without a length header', async () => {
    const input = streamed({ 'Content-Type': 'application/json' }, 'a'.repeat(30));
    await expect(boundedJson(input.request, 10)).rejects.toMatchObject({ status: 413 });
    expect(input.cancelled()).toBe(true);
  });
  it('parses valid JSON and rejects invalid JSON and UTF-8', async () => {
    const make = (body: BodyInit) => new Request('https://example.invalid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    expect(await boundedJson(make('{"ok":true}'))).toEqual({ ok: true });
    await expect(boundedJson(make('{'))).rejects.toMatchObject({ status: 400 });
    await expect(boundedJson(make(new Uint8Array([255])))).rejects.toMatchObject({ status: 400 });
  });
});
