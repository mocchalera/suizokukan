import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCutoutProcessor } from '../src/lib/cutout-processor';
import type { Pixels } from '../shared/cutout';

type Request = { id: number; width: number; height: number; buffer: ArrayBuffer; threshold: number; paperMode: boolean };
class WorkerDouble {
  onmessage: Worker['onmessage'] = null;
  onerror: Worker['onerror'] = null;
  postMessage = vi.fn((_message: Request, _options?: Transferable[] | StructuredSerializeOptions) => {});
  terminate = vi.fn();
  respond(request: Request, error?: string) {
    this.onmessage?.call(this as unknown as Worker, { data: error === undefined ? request : { id: request.id, error } } as MessageEvent);
  }
}
const pixels: Pixels = { width: 1, height: 1, data: new Uint8ClampedArray([110, 80, 70, 255]) };
function setup() {
  const worker = new WorkerDouble();
  const callbacks = { onResult: vi.fn(), onError: vi.fn(), onBusy: vi.fn() };
  return { worker, callbacks, processor: createCutoutProcessor(worker, callbacks) };
}

describe('cutout processing during continuous input', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('debounces input without copying or queuing an image per pointer movement', () => {
    const { worker, callbacks, processor } = setup();
    const copy = vi.spyOn(pixels.data, 'slice');
    for (let value = 5; value <= 110; value++) { processor.request(pixels, value, false, 80); vi.advanceTimersByTime(20); }
    expect(worker.postMessage).not.toHaveBeenCalled(); expect(copy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60);
    expect(worker.postMessage).toHaveBeenCalledTimes(1); expect(copy).toHaveBeenCalledTimes(1);
    const [request, transfer] = worker.postMessage.mock.calls[0];
    expect(request.threshold).toBe(110); expect(request.paperMode).toBe(false);
    expect(transfer).toEqual([request.buffer]); expect(request.buffer).not.toBe(pixels.data.buffer);
    worker.respond(request);
    expect(callbacks.onResult).toHaveBeenCalledWith(pixels); expect(callbacks.onBusy).toHaveBeenLastCalledWith(false);
    processor.dispose();
  });

  it('keeps only the latest pending job and discards an older result while a worker is busy', () => {
    const { worker, callbacks, processor } = setup();
    processor.request(pixels, 40, false);
    const first = worker.postMessage.mock.calls[0][0];
    for (const value of [90, 105, 60, 10, 8]) { processor.request(pixels, value, false, 80); vi.advanceTimersByTime(100); }
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    worker.respond(first);
    expect(callbacks.onResult).not.toHaveBeenCalled(); expect(callbacks.onBusy).toHaveBeenLastCalledWith(true);
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    const latest = worker.postMessage.mock.calls[1][0];
    expect(latest.threshold).toBe(8);
    worker.respond(first);
    expect(callbacks.onResult).not.toHaveBeenCalled();
    worker.respond(latest);
    expect(callbacks.onResult).toHaveBeenCalledTimes(1); expect(callbacks.onBusy).toHaveBeenLastCalledWith(false);
    processor.dispose();
  });

  it('waits for the input debounce even when an older job completes early', () => {
    const { worker, callbacks, processor } = setup();
    processor.request(pixels, 40, false);
    processor.request(pixels, 5, true, 80);
    worker.respond(worker.postMessage.mock.calls[0][0]);
    expect(callbacks.onResult).not.toHaveBeenCalled(); expect(worker.postMessage).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(80);
    expect(worker.postMessage.mock.calls[1][0]).toMatchObject({ threshold: 5, paperMode: true });
    processor.dispose();
  });

  it('ignores stale failures but exposes the latest failure without pretending to finish successfully', () => {
    const { worker, callbacks, processor } = setup();
    processor.request(pixels, 105, false);
    processor.request(pixels, 8, false);
    worker.respond(worker.postMessage.mock.calls[0][0], '古い失敗');
    expect(callbacks.onError).not.toHaveBeenCalled(); expect(callbacks.onBusy).toHaveBeenLastCalledWith(true);
    worker.respond(worker.postMessage.mock.calls[1][0], '画像を処理できません。');
    expect(callbacks.onError).toHaveBeenCalledWith('画像を処理できません。');
    expect(callbacks.onResult).not.toHaveBeenCalled(); expect(callbacks.onBusy).toHaveBeenLastCalledWith(false);
    processor.dispose();
  });

  it('cancels pending work when returning to crop and uses only the newly cropped source', () => {
    const { worker, callbacks, processor } = setup();
    processor.request(pixels, 40, false);
    const old = worker.postMessage.mock.calls[0][0];
    processor.request(pixels, 90, false, 80); processor.cancel(); vi.advanceTimersByTime(200);
    expect(callbacks.onBusy).toHaveBeenLastCalledWith(false); expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const recropped = { ...pixels, data: new Uint8ClampedArray([20, 40, 90, 255]) };
    processor.request(recropped, 25, false);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    worker.respond(old);
    expect(callbacks.onResult).not.toHaveBeenCalled(); expect(worker.postMessage).toHaveBeenCalledTimes(2);
    const latest = worker.postMessage.mock.calls[1][0];
    expect(new Uint8ClampedArray(latest.buffer)).toEqual(recropped.data);
    worker.respond(latest); expect(callbacks.onResult).toHaveBeenCalledWith(recropped);
    processor.dispose();
  });

  it('terminates the worker and discards timers and late delivery after unmount', () => {
    const { worker, callbacks, processor } = setup();
    processor.request(pixels, 40, false);
    const message = worker.postMessage.mock.calls[0][0]; const lateDelivery = worker.onmessage;
    processor.request(pixels, 100, false, 80); processor.dispose();
    callbacks.onBusy.mockClear();
    vi.advanceTimersByTime(200);
    lateDelivery?.call(worker as unknown as Worker, { data: message } as MessageEvent);
    processor.request(pixels, 20, false);
    expect(worker.postMessage).toHaveBeenCalledTimes(1); expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull(); expect(worker.onerror).toBeNull();
    expect(callbacks.onResult).not.toHaveBeenCalled(); expect(callbacks.onBusy).not.toHaveBeenCalled();
  });

  it('ends busy state and shows an error when posting or the worker itself fails', () => {
    const posting = setup();
    posting.worker.postMessage.mockImplementationOnce(() => { throw new Error('post failed'); });
    posting.processor.request(pixels, 40, false);
    expect(posting.callbacks.onBusy).toHaveBeenLastCalledWith(false); expect(posting.callbacks.onError).toHaveBeenCalledTimes(1);
    posting.processor.dispose();
    const running = setup();
    running.processor.request(pixels, 40, false); running.processor.request(pixels, 60, false, 80);
    const preventDefault = vi.fn();
    running.worker.onerror?.call(running.worker as unknown as Worker, { preventDefault } as unknown as ErrorEvent);
    vi.advanceTimersByTime(200);
    expect(preventDefault).toHaveBeenCalled(); expect(running.worker.postMessage).toHaveBeenCalledTimes(1);
    expect(running.callbacks.onResult).not.toHaveBeenCalled(); expect(running.callbacks.onBusy).toHaveBeenLastCalledWith(false);
    expect(running.callbacks.onError).toHaveBeenCalledTimes(1);
    running.processor.dispose();
  });
});
