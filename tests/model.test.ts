import { describe, expect, it } from 'vitest';
import { makeBackup, parseBackup, personality, safeName, validateCreature, validatePng } from '../shared/model';
import { creature, png } from './fixtures';

describe('untrusted collection data', () => {
  it('round-trips only safe cutouts, never source photos', () => {
    const saved = makeBackup([{ ...creature(), source: 'data:image/jpeg;base64,cHJpdmF0ZQ==' }]);
    expect(saved).not.toContain('source'); expect(parseBackup(saved)).toEqual([creature()]);
  });
  it.each(['https://evil.invalid/image.png', 'data:image/svg+xml,<svg/>', 'javascript:alert(1)', 'data:image/png;base64,AAAA'])('rejects image payload %s', image => expect(() => validateCreature({ ...creature(), image })).toThrow());
  it('rejects metadata, oversized dimensions, broken checksum and appended bytes', () => {
    expect(() => validatePng(png(32, 32, true))).toThrow(); expect(() => validatePng(png(513, 1))).toThrow();
    const bytes = Buffer.from(png().slice(22), 'base64'); bytes[40] ^= 1;
    expect(() => validatePng(`data:image/png;base64,${bytes.toString('base64')}`)).toThrow();
    expect(() => validatePng(`data:image/png;base64,${Buffer.concat([Buffer.from(png().slice(22), 'base64'), Buffer.from('extra')]).toString('base64')}`)).toThrow();
  });
  it.each(['<script>', 'https://example.com', 'a'.repeat(25), '\u0000'])('rejects dangerous names', name => expect(() => safeName(name)).toThrow());
  it('clamps valid scores but refuses unknown or non-finite values', () => {
    expect(personality({ mood: 'shy', energy: 9, bubbleLove: -2 })).toEqual({ mood: 'shy', energy: 1, bubbleLove: 0 });
    expect(() => personality({ mood: 'smart', energy: 1, bubbleLove: 1 })).toThrow();
    expect(() => personality({ mood: 'calm', energy: NaN, bubbleLove: 1 })).toThrow();
  });
  it('rejects unknown versions, duplicates, too many records and huge backups', () => {
    const wrap = (creatures: unknown[], version = 1) => JSON.stringify({ format: 'oekaki-no-umi', version, creatures });
    expect(() => parseBackup(wrap([], 2))).toThrow(); expect(() => parseBackup(wrap([creature(), creature()]))).toThrow();
    expect(() => parseBackup(wrap(Array.from({ length: 41 }, (_, index) => creature(index + 1))))).toThrow();
    expect(() => parseBackup(' '.repeat(10_000_001))).toThrow(); expect(() => parseBackup('{')).toThrow();
  });
});
