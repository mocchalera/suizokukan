import { describe, expect, it } from 'vitest';
import { brushPixels, removePaper } from '../shared/cutout';

function drawing() {
  const data = new Uint8ClampedArray(20 * 20 * 4).fill(255);
  for (let row = 5; row <= 14; row++) for (let column = 5; column <= 14; column++) {
    if (row === 5 || row === 14 || column === 5 || column === 14) {
      const offset = (row * 20 + column) * 4; data[offset] = 120; data[offset + 1] = 70; data[offset + 2] = 50;
    }
  }
  return { width: 20, height: 20, data };
}
describe('boundary-connected paper removal', () => {
  it('clears exterior but keeps white eyes/holes and every original RGB', () => {
    const original = drawing(); const result = removePaper(original, 40);
    expect(result.data[3]).toBe(0);
    expect(result.data[(10 * 20 + 10) * 4 + 3]).toBe(255);
    expect(result.data[(5 * 20 + 5) * 4 + 3]).toBe(255);
    for (let offset = 0; offset < result.data.length; offset++) if (offset % 4 !== 3) expect(result.data[offset]).toBe(original.data[offset]);
    expect(original.data[3]).toBe(255);
  });
  it('keeps the entire paper in rescue mode', () => expect(removePaper(drawing(), 40, true).data).toEqual(drawing().data));
  it('removes unevenly lit paper without washing out subtle lines or changing original colors', () => {
    const width = 192; const height = 96;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
      const offset = (row * width + column) * 4;
      const paper = Math.round(240 - 65 * column / (width - 1));
      data.set([paper, paper, paper, 255], offset);
      if (row === 10 && column >= 45 && column <= 75) data.set([paper - 25, paper - 25, paper - 25, 255], offset);
      if (row >= 25 && row <= 70 && column >= 40 && column <= 150 && (row === 25 || row === 70 || column === 40 || column === 150)) data.set([120, 70, 50, 255], offset);
    }
    const original = new Uint8ClampedArray(data);
    const adjusted = removePaper({ width, height, data }, 40);
    const manual = removePaper({ width, height, data }, 40, false, false);
    expect(adjusted.data[(80 * width + 180) * 4 + 3]).toBe(0);
    expect(manual.data[(80 * width + 180) * 4 + 3]).toBe(255);
    expect(adjusted.data[(10 * width + 60) * 4 + 3]).toBe(255);
    expect(adjusted.data[(40 * width + 90) * 4 + 3]).toBe(255);
    expect(adjusted.data[(25 * width + 90) * 4 + 3]).toBe(255);
    for (let offset = 0; offset < data.length; offset++) if (offset % 4 !== 3) expect(adjusted.data[offset]).toBe(original[offset]);
    expect(data).toEqual(original);
  });
  it('restores exact original pixels after erasing', () => {
    const original = drawing(); const result = removePaper(original, 40);
    brushPixels(result, original, 10, 10, 2, false); expect(result.data[(10 * 20 + 10) * 4 + 3]).toBe(0);
    brushPixels(result, original, 10, 10, 2, true); expect(result.data[(10 * 20 + 10) * 4 + 3]).toBe(255);
  });
  it('rejects blank images and excessive or malformed pixel arrays', () => {
    expect(() => removePaper({ width: 20, height: 20, data: new Uint8ClampedArray(1600).fill(255) }, 40)).toThrow();
    expect(() => removePaper({ width: 50000, height: 50000, data: new Uint8ClampedArray(0) }, 40)).toThrow();
    expect(() => removePaper({ width: 0, height: 20, data: new Uint8ClampedArray(0) }, 40)).toThrow();
    expect(() => removePaper({ ...drawing(), data: new Uint8ClampedArray(1) }, 40)).toThrow();
  });
  it('handles a full 1200px resized photo without recursion overflow', () => {
    const data = new Uint8ClampedArray(1200 * 1200 * 4).fill(255);
    for (let pixel = 600 * 1200 + 590; pixel < 600 * 1200 + 610; pixel++) data[pixel * 4] = 60;
    const result = removePaper({ width: 1200, height: 1200, data }, 60);
    expect(result.data[3]).toBe(0); expect(result.data[(600 * 1200 + 600) * 4 + 3]).toBe(255);
  });
});
