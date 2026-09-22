import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { validatePng } from '../shared/model';
import { decodePng } from '../worker/png';
import { png, pngChunk, replacePngData } from './fixtures';

describe('bounded server PNG decode validation', () => {
  it.each([1, 32, 512])('accepts a valid %ipx cutout unchanged', side => {
    const image = png(side, side);
    expect(Buffer.from(decodePng(image)).toString('base64')).toBe(image.slice(22));
  });
  it.each(['bad deflate', 'truncated zlib', 'bad adler', 'short pixels', 'extra pixels', 'invalid filter', 'trailing stream', 'inflate bomb'])('rejects CRC-valid PNG with %s', kind => {
    let pixels = Buffer.alloc(5);
    if (kind === 'short pixels') pixels = Buffer.alloc(4);
    if (kind === 'extra pixels') pixels = Buffer.alloc(6);
    if (kind === 'invalid filter') pixels[0] = 5;
    if (kind === 'inflate bomb') pixels = Buffer.alloc(2_000_000);
    let compressed = deflateSync(pixels);
    if (kind === 'bad deflate') compressed = Buffer.from([0x78, 0x9c, 0xff, 0xff, 0xff]);
    if (kind === 'truncated zlib') compressed = compressed.subarray(0, compressed.length - 1);
    if (kind === 'bad adler') compressed[compressed.length - 1] ^= 1;
    if (kind === 'trailing stream') compressed = Buffer.concat([compressed, deflateSync(Buffer.alloc(5))]);
    const image = replacePngData(png(1, 1), compressed);
    expect(validatePng(image)).toBe(image);
    expect(() => decodePng(image)).toThrow();
  });
  it.each([0, 1, 2, 3, 4])('accepts PNG scanline filter %i', filter => {
    const pixels = Buffer.alloc(10); pixels[0] = filter; pixels[5] = filter;
    expect(() => decodePng(replacePngData(png(1, 2), deflateSync(pixels)))).not.toThrow();
  });
  it('validates indexed-color samples after reversing filters', () => {
    const original = Buffer.from(png(2, 1).slice(22), 'base64');
    const header = Buffer.from(original.subarray(16, 29)); header[9] = 3;
    const image = (samples: number[]) => `data:image/png;base64,${Buffer.concat([original.subarray(0, 8), pngChunk('IHDR', header), pngChunk('PLTE', Buffer.from([255, 0, 0, 0, 0, 255])), pngChunk('IDAT', deflateSync(Buffer.from(samples))), pngChunk('IEND', Buffer.alloc(0))]).toString('base64')}`;
    expect(() => decodePng(image([1, 1, 0]))).not.toThrow();
    expect(() => decodePng(image([1, 1, 1]))).toThrow();
  });
  it('accepts contiguous split IDATs but rejects separated IDATs', () => {
    const original = Buffer.from(png(1, 1).slice(22), 'base64'); const compressed = deflateSync(Buffer.alloc(5));
    const image = (separate: boolean) => `data:image/png;base64,${Buffer.concat([original.subarray(0, 33), pngChunk('IDAT', compressed.subarray(0, 2)), ...(separate ? [pngChunk('gAMA', Buffer.from([0, 0, 177, 143]))] : []), pngChunk('IDAT', compressed.subarray(2)), pngChunk('IEND', Buffer.alloc(0))]).toString('base64')}`;
    expect(() => decodePng(image(false))).not.toThrow(); expect(() => decodePng(image(true))).toThrow();
  });
});
