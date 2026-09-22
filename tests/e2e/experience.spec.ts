import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { creature } from '../fixtures';
import { noOverflow, sample, screen } from './helpers';

test('photo → birth → play → collection → reload → backup → delete → import', async ({ page }, info) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  const external: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(info.project.use.baseURL!).origin) external.push(request.url()); });
  await page.goto('/');
  await expect(page.locator('.sea')).toHaveAttribute('data-loaded', '4');
  await noOverflow(page);
  await screen(page, `${info.project.name}-home`);
  await sample(page);
  await expect(page.getByText('えらんだ せいかくで うまれたよ。')).toBeVisible();
  await page.locator('.sea canvas').click({ position: { x: 90, y: 100 } });
  await expect(page.getByText('ぷくぷく。あわが できたよ！')).toBeVisible();
  await page.getByRole('button', { name: '✧ おやつ', exact: true }).click();
  await page.locator('.sea canvas').click({ position: { x: 120, y: 150 } });
  await expect(page.getByText('おやつ、どうぞ！')).toBeVisible();
  await page.getByRole('link', { name: 'ずかん', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'さんごちゃん', exact: true })).toBeVisible();
  await noOverflow(page);
  await screen(page, `${info.project.name}-collection`);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '↓ バックアップを 保存' }).click();
  const downloaded = await downloading;
  const backup = await readFile((await downloaded.path())!);
  const decoded = JSON.parse(backup.toString());
  expect(backup.toString().includes('data:image/jpeg')).toBe(false);
  expect(decoded.creatures).toHaveLength(1);
  await page.getByRole('button', { name: 'さんごちゃんを削除' }).click();
  await page.getByRole('button', { name: 'やめておく' }).click();
  await expect(page.locator('.creature-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'さんごちゃんを削除' }).click();
  await page.getByRole('button', { name: 'この端末から 消す' }).click();
  await expect(page.locator('.creature-card')).toHaveCount(0);
  await page.getByLabel('バックアップを読みこむ', { exact: true }).setInputFiles({ name: 'umi.json', mimeType: 'application/json', buffer: backup });
  await page.getByRole('button', { name: '上書きせず 読みこむ' }).click();
  await expect(page.locator('.creature-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'うみへ もどす', exact: true }).click();
  await page.getByRole('button', { name: 'うみで さがす', exact: true }).click();
  await expect(page.locator('.sea')).toHaveAttribute('data-loaded', '5');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'さんごちゃん', exact: true })).toBeVisible();
  expect(failures).toEqual([]);
  expect(external).toEqual([]);
});

test('photo errors, manual repair, original source and reduced motion', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/create');
  await page.getByLabel('しゃしんをえらぶ', { exact: true }).setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('しゃしんをえらぶ', { exact: true }).setInputFiles('test-artifacts/fixtures/original-synthetic-drawing.jpg');
  const cropButton = page.getByRole('button', { name: '左上の切り抜き位置' });
  expect((await cropButton.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await cropButton.press('ArrowRight');
  await page.getByRole('button', { name: 'このはんいで きりぬく →' }).click();
  const next = page.getByRole('button', { name: 'このこで つづける →' });
  await expect(next).toBeEnabled();
  await page.locator('.cut-canvas').click({ position: { x: 70, y: 70 } });
  await page.getByRole('button', { name: 'ひとつ もどす', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ひとつ もどす', exact: true })).toBeDisabled();
  await page.getByLabel('紙をのこす（うまく抜けないとき）').check();
  await expect(next).toBeEnabled();
  await page.getByLabel('紙をのこす（うまく抜けないとき）').uncheck();
  await expect(next).toBeEnabled();
  await screen(page, `${info.project.name}-cutout`);
  await next.click();
  await page.getByRole('textbox', { name: 'なまえ', exact: true }).fill('もういちど');
  await page.getByRole('button', { name: '✧ うみに はなす' }).click();
  await page.getByRole('link', { name: 'ずかん', exact: true }).click();
  await page.getByRole('button', { name: 'きりぬきを なおす', exact: true }).click();
  await expect(page.locator('.crop-view img')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'もういちど', exact: true })).toBeVisible();
});

test('twenty creatures, navigation and cache cleanup stay bounded', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('/');
  await expect(page.locator('.sea')).toHaveAttribute('data-loaded', '4');
  await page.evaluate(async items => {
    await new Promise<void>((resolve, reject) => {
      const opening = indexedDB.open('oekaki-no-umi', 1);
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const database = opening.result;
        const transaction = database.transaction('creatures', 'readwrite');
        for (const item of items) transaction.objectStore('creatures').put(item);
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onabort = () => { database.close(); reject(transaction.error); };
      };
    });
  }, Array.from({ length: 20 }, (_, index) => creature(index + 1)));
  await page.reload();
  await expect(page.locator('.sea')).toHaveAttribute('data-loaded', '20');
  for (let index = 0; index < 5; index++) {
    await page.getByRole('link', { name: 'ずかん', exact: true }).click();
    await expect(page.locator('.creature-card')).toHaveCount(20);
    await page.getByRole('link', { name: 'あそぶ', exact: true }).click();
    await expect(page.locator('.sea')).toHaveAttribute('data-loaded', '20');
    await page.locator('.sea canvas').click({ position: { x: 150, y: 200 } });
  }
  await page.waitForTimeout(1500);
  expect(failures).toEqual([]);
});
