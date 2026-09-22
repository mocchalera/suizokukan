import { expect, test } from '@playwright/test';
import { creature } from '../fixtures';
import { sample } from './helpers';

test('camera denial and late permission preserve the photo rescue and stop tracks', async ({ page }) => {
  await page.addInitScript(() => {
    let calls = 0;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => {
      calls++;
      if (calls === 1) return Promise.reject(new DOMException('Denied', 'NotAllowedError'));
      return new Promise(resolve => {
        Object.assign(window, { resolveTestCamera: () => resolve({ getTracks: () => [{ stop: () => { document.documentElement.dataset.cameraStopped = 'true'; } }] }) });
      });
    } } });
  });
  await page.goto('/create');
  await page.getByRole('button', { name: '◎ カメラで とる', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('写真選択・おためし');
  await page.getByRole('button', { name: '◎ カメラで とる', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'えを うつそう' })).toBeVisible();
  await page.getByRole('button', { name: 'とじる', exact: true }).click();
  await page.evaluate(() => (window as unknown as { resolveTestCamera: () => void }).resolveTestCamera());
  await expect(page.locator('html')).toHaveAttribute('data-camera-stopped', 'true');
  await page.getByRole('button', { name: 'おためしの しゃしん →', exact: true }).click();
  await expect(page.locator('.crop-view')).toBeVisible();
});

test('hostile backup and oversized file cannot replace a saved creature', async ({ page }) => {
  await sample(page, 'まもるこ');
  await page.getByRole('link', { name: 'ずかん', exact: true }).click();
  const input = page.getByLabel('バックアップを読みこむ', { exact: true });
  for (const invalid of [
    Buffer.from(JSON.stringify({ format: 'oekaki-no-umi', version: 1, creatures: [{ ...creature(), name: '<script>bad</script>', image: 'https://untrusted.invalid/pic.png' }] })),
    Buffer.alloc(10_000_001, 32),
  ]) {
    await input.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: invalid });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'まもるこ', exact: true })).toBeVisible();
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: 'まもるこ', exact: true })).toBeVisible();
});

test('optional Jev failure makes one text-only request and birth still succeeds', async ({ page }) => {
  const calls: unknown[] = [];
  await page.route('**/api/health', route => route.fulfill({ json: { ok: true, jev: 'available' } }));
  await page.route('**/api/personality', route => {
    calls.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { error: 'Synthetic outage' } });
  });
  await page.goto('/create');
  await page.getByRole('button', { name: 'おためしの しゃしん →', exact: true }).click();
  await page.getByRole('button', { name: 'このはんいで きりぬく →' }).click();
  await page.getByRole('button', { name: 'このこで つづける →' }).click();
  await page.getByText('おとなの方へ · ことばでせいかくをつける', { exact: true }).click();
  await page.getByRole('textbox', { name: 'せいかくの設定文' }).fill('こわがりだけど、あわが好き');
  await page.getByLabel('誕生時にこの設定文だけをJevへ送る（任意）', { exact: true }).check();
  await page.getByRole('button', { name: '✧ うみに はなす', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('AIを使えなかったため、選んだせいかくで泳ぎます。', { exact: true })).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(Object.keys(calls[0] as object).sort()).toEqual(['fallback', 'note']);
  expect(JSON.stringify(calls)).not.toContain('data:image');
});
