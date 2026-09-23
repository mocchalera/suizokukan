export type Pixels = { width: number; height: number; data: Uint8ClampedArray };

function paperLighting(input: Pixels): { width: number; height: number; values: Float32Array } {
  const { width, height, data } = input;
  const tileSize = 64;
  const columns = Math.ceil(width / tileSize); const rows = Math.ceil(height / tileSize);
  const histograms = Array.from({ length: columns * rows }, () => new Uint16Array(256));
  const counts = new Uint16Array(columns * rows);
  const globalHistogram = new Uint32Array(256);
  let globalCount = 0;
  for (let row = 0; row < height; row += 2) for (let column = 0; column < width; column += 2) {
    const offset = (row * width + column) * 4;
    if (data[offset + 3] <= 32) continue;
    const minimum = Math.min(data[offset], data[offset + 1], data[offset + 2]);
    const maximum = Math.max(data[offset], data[offset + 1], data[offset + 2]);
    if (minimum < 165 || maximum - minimum > 24) continue;
    const tile = Math.floor(row / tileSize) * columns + Math.floor(column / tileSize);
    histograms[tile][minimum]++; counts[tile]++; globalHistogram[minimum]++; globalCount++;
  }
  const percentile = (histogram: Uint16Array | Uint32Array, count: number) => {
    let remaining = Math.ceil(count * 0.85);
    for (let value = 0; value < 256; value++) if ((remaining -= histogram[value]) <= 0) return value;
    return 255;
  };
  const global = globalCount ? percentile(globalHistogram, globalCount) : 255;
  const values = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const index = row * columns + column;
    const tilePixels = Math.ceil(Math.min(tileSize, width - column * tileSize) / 2) * Math.ceil(Math.min(tileSize, height - row * tileSize) / 2);
    values[index] = counts[index] >= Math.max(8, tilePixels / 8)
      ? Math.max(global - 60, percentile(histograms[index], counts[index])) : global;
  }
  return { width: columns, height: rows, values };
}

export function removePaper(input: Pixels, threshold: number, paperMode = false, autoLighting = true): Pixels {
  const { width, height, data } = input;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 1_440_000 || data.length !== width * height * 4 || !Number.isFinite(threshold) || threshold < 0 || threshold > 160) throw new Error('画像サイズまたはしきい値が不正です。');
  const output = new Uint8ClampedArray(data);
  let ink = 0;
  for (let offset = 0; offset < data.length; offset += 4) if (data[offset + 3] > 32 && Math.min(data[offset], data[offset + 1], data[offset + 2]) < 230) ink++;
  if (ink < 8) throw new Error('えが みつからなかったよ。もうすこし ちかくで とってみてね。');
  if (paperMode) return { width, height, data: output };
  const lighting = autoLighting ? paperLighting(input) : null;
  const tileSize = 64;
  const reference = (column: number, row: number) => {
    if (!lighting) return 255;
    const horizontal = Math.max(0, column / tileSize - 0.5); const vertical = Math.max(0, row / tileSize - 0.5);
    const left = Math.min(lighting.width - 1, Math.floor(horizontal)); const top = Math.min(lighting.height - 1, Math.floor(vertical));
    const right = Math.min(lighting.width - 1, left + 1); const bottom = Math.min(lighting.height - 1, top + 1);
    const upper = lighting.values[top * lighting.width + left] * (1 - (horizontal - left)) + lighting.values[top * lighting.width + right] * (horizontal - left);
    const lower = lighting.values[bottom * lighting.width + left] * (1 - (horizontal - left)) + lighting.values[bottom * lighting.width + right] * (horizontal - left);
    return upper * (1 - (vertical - top)) + lower * (vertical - top);
  };
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
    const paper = lighting
      ? (reference(index % width, Math.floor(index / width)) - minimum) * 2 <= threshold
      : minimum >= 255 - threshold;
    if (data[offset + 3] < 8 || (paper && maximum - minimum <= threshold * 0.6 + 10)) queue[tail++] = index;
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
