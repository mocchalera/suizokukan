export type Pixels = { width: number; height: number; data: Uint8ClampedArray };
export function removePaper(input: Pixels, threshold: number, paperMode = false): Pixels {
  const { width, height, data } = input;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 1_440_000 || data.length !== width * height * 4 || !Number.isFinite(threshold) || threshold < 0 || threshold > 160) throw new Error('画像サイズまたはしきい値が不正です。');
  const output = new Uint8ClampedArray(data);
  let ink = 0;
  for (let offset = 0; offset < data.length; offset += 4) if (data[offset + 3] > 32 && Math.min(data[offset], data[offset + 1], data[offset + 2]) < 230) ink++;
  if (ink < 8) throw new Error('えが みつからなかったよ。もうすこし ちかくで とってみてね。');
  if (paperMode) return { width, height, data: output };
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let tail = 0;
  let head = 0;
  const enqueue = (index: number) => {
    if (visited[index]) return;
    visited[index] = 1;
    const offset = index * 4;
    const minimum = Math.min(data[offset], data[offset + 1], data[offset + 2]);
    const maximum = Math.max(data[offset], data[offset + 1], data[offset + 2]);
    if (data[offset + 3] < 8 || (minimum >= 255 - threshold && maximum - minimum <= threshold * 0.6 + 10)) queue[tail++] = index;
  };
  for (let column = 0; column < width; column++) { enqueue(column); enqueue((height - 1) * width + column); }
  for (let row = 0; row < height; row++) { enqueue(row * width); enqueue(row * width + width - 1); }
  while (head < tail) {
    const index = queue[head++];
    output[index * 4 + 3] = 0;
    if (index % width > 0) enqueue(index - 1);
    if (index % width < width - 1) enqueue(index + 1);
    if (index >= width) enqueue(index - width);
    if (index < width * (height - 1)) enqueue(index + width);
  }
  return { width, height, data: output };
}
export function brushPixels(current: Pixels, original: Pixels, centerX: number, centerY: number, radius: number, keep: boolean): void {
  const { width, height, data } = current;
  for (let row = Math.max(0, Math.floor(centerY - radius)); row < Math.min(height, centerY + radius); row++) {
    for (let column = Math.max(0, Math.floor(centerX - radius)); column < Math.min(width, centerX + radius); column++) {
      if ((column - centerX) ** 2 + (row - centerY) ** 2 > radius ** 2) continue;
      const offset = (row * width + column) * 4;
      data[offset + 3] = keep ? original.data[offset + 3] : 0;
    }
  }
}
