import { LIMITS, validatePng } from '../../shared/model';

export function imageElement(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => { image.src = ''; reject(new Error('画像の準備が間に合いませんでした。もう一度おためしください。')); }, 10000);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('画像を開けません。JPEG・PNG・WebPをおためしください。')); };
    image.src = source;
  });
}
export function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}
export function contextOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('このブラウザではおえかきを開けません。');
  return context;
}
export function canvasPngWithoutMetadata(value: string): string {
  if (!value.startsWith('data:image/png;base64,') || value.length > 2_000_000) throw new Error('PNG画像を作れませんでした。');
  const bytes = Uint8Array.from(atob(value.slice(22)), character => character.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const parts = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12) throw new Error('PNG画像がこわれています。');
    const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!['eXIf', 'tEXt', 'zTXt', 'iTXt'].includes(kind)) parts.push(bytes.subarray(offset, offset + length + 12));
    offset += length + 12;
  }
  if (offset !== bytes.length) throw new Error('PNG画像の末尾が不正です。');
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let written = 0;
  for (const part of parts) { output.set(part, written); written += part.length; }
  let binary = '';
  for (let start = 0; start < output.length; start += 8192) binary += String.fromCharCode(...output.subarray(start, start + 8192));
  return validatePng(`data:image/png;base64,${btoa(binary)}`);
}
export async function decodePhoto(file: Blob): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > LIMITS.photoBytes || file.size < 12) throw new Error('15MBまでのJPEG・PNG・WebPを選んでね。HEICはJPEGで書き出してね。');
  const header = new Uint8Array(await file.slice(0, 262144).arrayBuffer());
  let width = 0;
  let height = 0;
  let orientation = 1;
  const view = new DataView(header.buffer);
  if (file.type === 'image/png' && header[0] === 137 && header[1] === 80 && header.length >= 24) {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (file.type === 'image/jpeg' && header[0] === 255 && header[1] === 216) {
    let offset = 2;
    while (offset + 8 < header.length) {
      if (header[offset] !== 255) break;
      const marker = header[offset + 1];
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + length + 2 > header.length) break;
      if ([192, 193, 194].includes(marker)) { height = view.getUint16(offset + 5); width = view.getUint16(offset + 7); }
      if (marker === 225 && String.fromCharCode(...header.slice(offset + 4, offset + 8)) === 'Exif') {
        try {
          const start = offset + 10;
          const little = view.getUint16(start) === 0x4949;
          const directory = start + view.getUint32(start + 4, little);
          const count = Math.min(128, view.getUint16(directory, little));
          for (let entry = 0; entry < count; entry++) {
            const position = directory + 2 + entry * 12;
            if (view.getUint16(position, little) === 274) orientation = view.getUint16(position + 8, little);
          }
        } catch {}
      }
      offset += length + 2;
    }
  } else if (file.type === 'image/webp' && String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP') {
    const format = String.fromCharCode(...header.slice(12, 16));
    if (format === 'VP8X' && header.length >= 30) { width = 1 + header[24] + (header[25] << 8) + (header[26] << 16); height = 1 + header[27] + (header[28] << 8) + (header[29] << 16); }
    if (format === 'VP8 ' && header.length >= 30) { width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff; }
    if (format === 'VP8L' && header.length >= 25) { width = 1 + ((header[21] | header[22] << 8) & 0x3fff); height = 1 + ((header[22] >> 6 | header[23] << 2 | header[24] << 10) & 0x3fff); }
  }
  if (!width || !height || width * height > LIMITS.photoPixels || Math.max(width, height) > 16384) throw new Error('画像が大きすぎるか、こわれています。4000万画素以内に縮小してね。');
  if (orientation >= 5 && orientation <= 8) [width, height] = [height, width];
  const ratio = Math.min(1, 1200 / Math.max(width, height));
  const canvas = canvasOf(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)));
  const context = contextOf(canvas);
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: canvas.width, resizeHeight: canvas.height, resizeQuality: 'high' });
    try { context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); } finally { bitmap.close(); }
  } else {
    const url = URL.createObjectURL(file);
    try { const image = await imageElement(url); context.drawImage(image, 0, 0, canvas.width, canvas.height); } finally { URL.revokeObjectURL(url); }
  }
  return canvas.toDataURL('image/jpeg', 0.88);
}
export function cutoutPng(canvas: HTMLCanvasElement): string {
  const pixels = contextOf(canvas).getImageData(0, 0, canvas.width, canvas.height);
  let left = canvas.width; let top = canvas.height; let right = 0; let bottom = 0; let count = 0;
  for (let row = 0; row < canvas.height; row++) for (let column = 0; column < canvas.width; column++) {
    if (pixels.data[(row * canvas.width + column) * 4 + 3] > 16) {
      left = Math.min(left, column); top = Math.min(top, row); right = Math.max(right, column); bottom = Math.max(bottom, row); count++;
    }
  }
  if (count < 8) throw new Error('いきものが きえちゃった。「もどす」でなおしてね。');
  const width = right - left + 1; const height = bottom - top + 1;
  for (const maximum of [512, 448, 384, 320, 256]) {
    const ratio = Math.min(1, (maximum - 16) / Math.max(width, height));
    const output = canvasOf(Math.ceil(width * ratio) + 16, Math.ceil(height * ratio) + 16);
    contextOf(output).drawImage(canvas, left, top, width, height, 8, 8, width * ratio, height * ratio);
    const data = output.toDataURL('image/png');
    if (data.length < LIMITS.pngBytes * 4 / 3 + 22) return canvasPngWithoutMetadata(data);
  }
  throw new Error('画像がまだ大きいようです。切り抜く範囲を小さくしてください。');
}
export async function samplePhoto(): Promise<string> {
  const image = await imageElement('/art/fish-coral.svg');
  const canvas = canvasOf(900, 680);
  const context = contextOf(canvas);
  context.fillStyle = '#f9f8f2'; context.fillRect(0, 0, 900, 680);
  context.drawImage(image, 105, 110, 680, 440);
  return canvas.toDataURL('image/jpeg', 0.9);
}
