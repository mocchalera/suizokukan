import type { Pixels } from '../../shared/cutout';

type Result = { id: number; width: number; height: number; buffer: ArrayBuffer; error?: never } | { id: number; error: string };
type Job = { id: number; pixels: Pixels; threshold: number; paperMode: boolean };
type Callbacks = { onResult: (pixels: Pixels) => void; onError: (message: string) => void; onBusy: (busy: boolean) => void };
type CutoutWorker = Pick<Worker, 'postMessage' | 'onmessage' | 'onerror' | 'terminate'>;

export function createCutoutProcessor(worker: CutoutWorker, callbacks: Callbacks) {
  let sequence = 0; let active: number | null = null; let pending: Job | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined; let ready = false; let disposed = false; let failed = false;
  const clearPending = () => { clearTimeout(timer); timer = undefined; pending = null; ready = false; };
  const fail = () => {
    failed = true; active = null; clearPending(); worker.terminate();
    callbacks.onError('切り抜きの準備に失敗しました。ページを開き直してください。'); callbacks.onBusy(false);
  };
  const flush = () => {
    if (disposed || failed || active !== null || !pending || !ready) return;
    const job = pending; pending = null; active = job.id;
    try {
      const buffer = job.pixels.data.slice().buffer;
      worker.postMessage({ id: job.id, width: job.pixels.width, height: job.pixels.height, buffer, threshold: job.threshold, paperMode: job.paperMode }, [buffer]);
    } catch { fail(); }
  };
  worker.onmessage = event => {
    const result = event.data as Result;
    if (disposed || failed || result.id !== active) return;
    active = null;
    if (result.id === sequence) {
      if (result.error !== undefined) callbacks.onError(result.error);
      else callbacks.onResult({ width: result.width, height: result.height, data: new Uint8ClampedArray(result.buffer) });
      callbacks.onBusy(false);
    }
    flush();
  };
  worker.onerror = event => { event.preventDefault(); if (!disposed && !failed) fail(); };
  return {
    request(pixels: Pixels, threshold: number, paperMode: boolean, delay = 0) {
      if (disposed) return;
      sequence++; clearPending(); callbacks.onBusy(true);
      if (failed) { fail(); return; }
      pending = { id: sequence, pixels, threshold, paperMode };
      if (delay) timer = setTimeout(() => { timer = undefined; ready = true; flush(); }, delay);
      else { ready = true; flush(); }
    },
    cancel() { sequence++; clearPending(); if (!disposed) callbacks.onBusy(false); },
    dispose() { disposed = true; clearPending(); worker.onmessage = null; worker.onerror = null; worker.terminate(); },
  };
}
