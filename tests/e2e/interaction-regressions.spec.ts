import { expect, test } from '@playwright/test';
import { screen } from './helpers';

test('cutout strength remains draggable during slow processing and uses the final value', async ({ page, browserName }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const probe = { delay: 0, sent: [] as number[], received: [] as number[], active: 0, maximumActive: 0 };
    Object.assign(window, { cutoutProbe: probe });
    window.Worker = class extends NativeWorker {
      postMessage(message: { threshold: number }, options: Transferable[] | StructuredSerializeOptions = {}) {
        probe.sent.push(message.threshold); probe.active++;
        probe.maximumActive = Math.max(probe.maximumActive, probe.active);
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
      set onmessage(listener: ((this: Worker, event: MessageEvent) => unknown) | null) {
        super.onmessage = listener ? event => {
          setTimeout(() => { probe.active--; probe.received.push(event.data.id); listener.call(this, event); }, probe.delay);
        } : null;
      }
    };
  });
  await page.goto('/create');
  await page.getByRole('button', { name: 'おためしの しゃしん →', exact: true }).click();
  await page.getByRole('button', { name: 'このはんいで きりぬく →' }).click();
  const next = page.getByRole('button', { name: 'このこで つづける →' });
  const slider = page.getByRole('slider', { name: '紙をはずすつよさ', exact: true });
  await expect(next).toBeEnabled();
  await slider.scrollIntoViewIfNeeded();
  await page.evaluate(() => { (window as unknown as { cutoutProbe: { delay: number } }).cutoutProbe.delay = 350; });
  const rectangle = (await slider.boundingBox())!;
  const horizontal = (value: number) => rectangle.x + 8 + (rectangle.width - 16) * (value - 5) / 105;
  const vertical = rectangle.y + rectangle.height / 2;
  await page.mouse.move(horizontal(40), vertical);
  await page.mouse.down();
  for (const value of [55, 70, 85, 100, 75, 50, 20]) {
    await page.mouse.move(horizontal(value), vertical, { steps: 3 });
    await expect(slider).toBeEnabled();
    expect(Math.abs(Number(await slider.inputValue()) - value)).toBeLessThanOrEqual(3);
  }
  await page.mouse.up();
  await expect(next).toBeEnabled();
  if (browserName === 'chromium' && info.project.name === 'mobile') {
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: horizontal(Number(await slider.inputValue())), y: vertical }] });
    for (const value of [40, 60, 80, 100, 50, 20]) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: horizontal(value), y: vertical }] });
      await expect(slider).toBeEnabled();
      expect(Math.abs(Number(await slider.inputValue()) - value)).toBeLessThanOrEqual(3);
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.detach();
    await expect(next).toBeEnabled();
  }
  await slider.fill('105');
  await expect(next).toBeDisabled();
  await expect.poll(() => page.evaluate(() => (window as unknown as { cutoutProbe: { sent: number[] } }).cutoutProbe.sent.at(-1))).toBe(105);
  await slider.fill('8');
  await expect(slider).toBeEnabled();
  await expect(next).toBeDisabled();
  await expect(next).toBeEnabled();
  const canvasAtLatest = await page.locator('.cut-canvas').evaluate(element => (element as HTMLCanvasElement).toDataURL());
  const probe = await page.evaluate(() => (window as unknown as { cutoutProbe: { sent: number[]; active: number; maximumActive: number } }).cutoutProbe);
  expect(probe.sent.at(-1)).toBe(8);
  expect(probe.maximumActive).toBe(1);
  expect(probe.active).toBe(0);
  await page.getByRole('button', { name: '修正を リセット', exact: true }).click();
  await expect(next).toBeEnabled();
  expect(await page.locator('.cut-canvas').evaluate(element => (element as HTMLCanvasElement).toDataURL())).toBe(canvasAtLatest);
  await screen(page, `${info.project.name}-smooth-slider`);
  await next.click();
  await expect(page.getByRole('button', { name: '✧ うみに はなす', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('a fish does not repeatedly mirror when it reaches a snack', async ({ page }) => {
  await page.addInitScript(() => {
    const frames: { horizontal: number; vertical: number; direction: number }[] = [];
    Object.assign(window, { fishFrames: frames });
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args: [CanvasImageSource, ...number[]]) {
      if (this.canvas.getAttribute('aria-label') === 'さわると あわや おやつが出るうみ' && args[0] instanceof HTMLImageElement && args[0].src.endsWith('/art/fish-coral.svg') && args[1] === 0) {
        const transform = this.getTransform();
        frames.push({ horizontal: transform.e / this.canvas.width, vertical: transform.f / this.canvas.height, direction: Math.sign(transform.a) });
        if (frames.length > 600) frames.shift();
      }
      Reflect.apply(drawImage, this, args);
    };
  });
  await page.goto('/');
  await expect(page.locator('.sea')).toHaveAttribute('data-loaded', '4');
  await page.getByRole('button', { name: '✧ おやつ', exact: true }).click();
  const canvas = page.locator('.sea canvas');
  await canvas.scrollIntoViewIfNeeded();
  const rectangle = (await canvas.boundingBox())!;
  const position = await page.evaluate(() => (window as unknown as { fishFrames: { horizontal: number; vertical: number }[] }).fishFrames.at(-1)!);
  await canvas.click({ position: { x: position.horizontal * rectangle.width, y: position.vertical * rectangle.height } });
  await page.evaluate(() => { (window as unknown as { fishFrames: unknown[] }).fishFrames.length = 0; });
  await expect.poll(() => page.evaluate(() => (window as unknown as { fishFrames: unknown[] }).fishFrames.length)).toBeGreaterThanOrEqual(60);
  const directions = await page.evaluate(() => (window as unknown as { fishFrames: { direction: number }[] }).fishFrames.slice(0, 60).map(frame => frame.direction));
  expect(directions.slice(1).filter((direction, index) => direction !== directions[index]).length).toBeLessThanOrEqual(1);
  const alternatingDirections = await page.evaluate(async () => {
    const fishFrames = (window as unknown as { fishFrames: { horizontal: number; vertical: number; direction: number }[] }).fishFrames;
    const sea = document.querySelector<HTMLCanvasElement>('.sea canvas')!;
    const observed: number[] = [];
    for (let frame = 0; frame < 60; frame++) {
      const position = fishFrames.at(-1)!;
      const rectangle = sea.getBoundingClientRect();
      sea.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: rectangle.left + (position.horizontal + (frame % 2 ? 0.12 : -0.12)) * rectangle.width,
        clientY: rectangle.top + position.vertical * rectangle.height,
      }));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      observed.push(fishFrames.at(-1)!.direction);
    }
    return observed;
  });
  expect(alternatingDirections.slice(1).filter((direction, index) => direction !== alternatingDirections[index]).length).toBeLessThanOrEqual(1);
});
