import { inflateSync } from 'node:zlib';
import { validatePng } from '../shared/model';

export function decodePng(value: unknown) {
  const image = validatePng(value);
  const bytes = Uint8Array.from(atob(image.slice(22)), character => character.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const width = view.getUint32(16); const height = view.getUint32(20); const color = bytes[25];
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
  const stride = width * channels + 1; const expected = stride * height;
  const compressed = new Uint8Array(bytes.length);
  let size = 0; let palette = 0; let transparent = false; let hasData = false; let dataEnded = false;
  const invalid = () => { throw new Error('画像がこわれています。切り抜きを作り直してください。'); };
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset);
    const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (kind === 'PLTE') {
      if (hasData || palette || transparent || color === 0 || color === 4 || !length || length % 3 || length > 768) invalid();
      palette = length / 3;
    }
    if (kind === 'tRNS') {
      if (hasData || transparent || !([0, 2, 3].includes(color)) || (color === 0 && length !== 2) || (color === 2 && length !== 6) || (color === 3 && (!palette || !length || length > palette))) invalid();
      transparent = true;
    }
    if (kind === 'IDAT') {
      if (dataEnded || (color === 3 && !palette)) invalid();
      hasData = true;
      compressed.set(bytes.subarray(offset + 8, offset + 8 + length), size); size += length;
    } else if (hasData) dataEnded = true;
    offset += length + 12;
  }
  let pixels: Uint8Array;
  try {
    const result = inflateSync(compressed.subarray(0, size), { maxOutputLength: expected, info: true }) as unknown as { buffer: Uint8Array; engine: { bytesWritten: number } };
    if (result.engine.bytesWritten !== size || result.buffer.length !== expected) invalid();
    pixels = result.buffer;
  } catch { return invalid(); }
  for (let row = 0; row < height; row++) {
    const start = row * stride; const filter = pixels[start];
    if (filter > 4) invalid();
    if (color !== 3) continue;
    for (let column = 1; column < stride; column++) {
      const left = column > 1 ? pixels[start + column - 1] : 0;
      const above = row ? pixels[start + column - stride] : 0;
      const corner = row && column > 1 ? pixels[start + column - stride - 1] : 0;
      const prediction = left + above - corner;
      const leftDistance = Math.abs(prediction - left); const aboveDistance = Math.abs(prediction - above); const cornerDistance = Math.abs(prediction - corner);
      const paeth = leftDistance <= aboveDistance && leftDistance <= cornerDistance ? left : aboveDistance <= cornerDistance ? above : corner;
      const predictor = [0, left, above, Math.floor((left + above) / 2), paeth][filter];
      pixels[start + column] = (pixels[start + column] + predictor) & 255;
      if (pixels[start + column] >= palette) invalid();
    }
  }
  return bytes;
}
