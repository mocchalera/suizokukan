import { describe, expect, it, vi } from 'vitest';
import { interpretNote, JEV_MODEL, jevAvailable, parseAnswer, validateNote } from '../worker/jev';
import { PRESETS } from '../shared/model';

const answer = { model: JEV_MODEL, answers: { mood: { type: 'choice', choice: 'shy' }, energy: { type: 'score', score: 0.2 }, bubbles: { type: 'score', score: 0.8 } } };
describe('optional Jev text-only interpretation', () => {
  it('is off without both a key and an explicit nonzero daily budget', () => {
    expect(jevAvailable({ JEV_DAILY_LIMIT: '0', JEV_MODEL })).toBe(false);
    expect(jevAvailable({ JEV_API_KEY: 'test-only', JEV_DAILY_LIMIT: '0', JEV_MODEL })).toBe(false);
    expect(jevAvailable({ JEV_API_KEY: 'test-only', JEV_DAILY_LIMIT: '1', JEV_MODEL })).toBe(true);
    expect(jevAvailable({ JEV_API_KEY: 'test-only', JEV_DAILY_LIMIT: '1', JEV_MODEL: 'invented' })).toBe(false);
  });
  it('sends only a bounded fictional preference with the exact official endpoint and schema', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(answer)));
    const result = await interpretNote('こわがりだけど あわがすき', PRESETS.calm, 'test-only', request);
    expect(result.mode).toBe('jev'); expect(result.personality.mood).toBe('shy');
    expect(request).toHaveBeenCalledOnce(); expect(request.mock.calls[0][0]).toBe('https://api.typesafe.ai/v1/systemone');
    const body = JSON.parse(request.mock.calls[0][1]?.body as string);
    expect(Object.keys(body.state)).toEqual(['fictional_creature_preference']); expect(body.model).toBe(JEV_MODEL);
    expect(body.questions.energy.type).toBe('score'); expect(body.questions.mood.type).toBe('choice');
    expect(JSON.stringify(body)).not.toContain('image');
  });
  it('falls back on invalid input without making any request', async () => {
    const request = vi.fn<typeof fetch>();
    expect((await interpretNote('a'.repeat(161), PRESETS.shy, 'test-only', request)).mode).toBe('fallback'); expect(request).not.toHaveBeenCalled();
    for (const note of ['', 'contact@invalid.test', 'https://invalid.test', '09012345678']) expect(() => validateNote(note)).toThrow();
  });
  it('falls back honestly on errors and unexpected model/score/enum', async () => {
    for (const response of [new Response('no', { status: 503 }), new Response('bad json'), new Response(JSON.stringify({ ...answer, model: 'other' }))]) {
      const result = await interpretNote('おっとり', PRESETS.calm, 'test-only', vi.fn<typeof fetch>().mockResolvedValue(response));
      expect(result.mode).toBe('fallback'); expect(result.personality).toEqual(PRESETS.calm);
    }
    expect(() => parseAnswer({ ...answer, answers: { ...answer.answers, mood: { type: 'choice', choice: 'genius' } } })).toThrow();
    expect(() => parseAnswer({ ...answer, answers: { ...answer.answers, energy: { type: 'score', score: 'fast' } } })).toThrow();
    expect(parseAnswer({ ...answer, answers: { ...answer.answers, energy: { type: 'score', score: 9 } } }).energy).toBe(1);
  });
  it('ends a stalled provider request at its timeout and preserves the preset', async () => {
    const request: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('Timeout', 'TimeoutError')), { once: true }); });
    const result = await interpretNote('あわがすき', PRESETS.shy, 'test-only', request, 20);
    expect(result.mode).toBe('fallback'); expect(result.personality).toEqual(PRESETS.shy);
  });
});
