import { removePaper } from '../../shared/cutout';

self.onmessage = (event: MessageEvent) => {
  const { id, width, height, buffer, threshold, paperMode } = event.data;
  try {
    const result = removePaper({ width, height, data: new Uint8ClampedArray(buffer) }, threshold, paperMode);
    self.postMessage({ id, width, height, buffer: result.data.buffer }, { transfer: [result.data.buffer] });
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : '画像を処理できません。' }); }
};
