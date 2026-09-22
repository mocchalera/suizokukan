import { describe, expect, it } from 'vitest';
import { canvasPngWithoutMetadata } from '../src/lib/images';
import { validatePng } from '../shared/model';
import { png } from './fixtures';

describe('browser canvas PNG normalization', () => {
  it.each([true, 'eXIf'] as const)('removes canvas metadata %s without changing pixel chunks', metadata => {
    const original = png(32, 32, metadata);
    expect(() => validatePng(original)).toThrow();
    expect(canvasPngWithoutMetadata(original)).toBe(png());
  });
  it('keeps already clean PNG bytes and rejects malformed input', () => {
    expect(canvasPngWithoutMetadata(png())).toBe(png());
    expect(() => canvasPngWithoutMetadata('data:image/jpeg;base64,AA==')).toThrow();
    expect(() => canvasPngWithoutMetadata('data:image/png;base64,AAAA')).toThrow();
  });
});
