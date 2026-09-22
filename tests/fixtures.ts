import { deflateSync } from 'node:zlib';
import { PRESETS, type Creature } from '../shared/model';

export function pngChunk(kind: string, content: Buffer) {
    const typed = Buffer.concat([Buffer.from(kind), content]);
    let checksum = 0xffffffff;
    for (const byte of typed) {
      checksum ^= byte;
      for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4); length.writeUInt32BE(content.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE((checksum ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, typed, crc]);
}
export function replacePngData(image: string, compressed: Uint8Array) {
  const original = Buffer.from(image.slice(22), 'base64');
  return `data:image/png;base64,${Buffer.concat([original.subarray(0, 33), pngChunk('IDAT', Buffer.from(compressed)), pngChunk('IEND', Buffer.alloc(0))]).toString('base64')}`;
}
export function png(width = 32, height = 32, metadata: boolean | 'eXIf' = false): string {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    const offset = row * (width * 4 + 1) + 1 + column * 4;
    pixels[offset] = 210; pixels[offset + 1] = 130; pixels[offset + 2] = 110;
    pixels[offset + 3] = Math.hypot(column - width / 2, row - height / 2) < width * 0.38 ? 255 : 0;
  }
  return `data:image/png;base64,${Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), ...(metadata ? [pngChunk(metadata === 'eXIf' ? 'eXIf' : 'tEXt', Buffer.from('private\0not allowed'))] : []), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]).toString('base64')}`;
}
export function creature(index = 1): Creature {
  return { id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`, name: `テスト${index}`, image: png(), swim: 'swim', personality: PRESETS.curious, facing: 'right', createdAt: 1_790_000_000_000, inSea: true };
}
