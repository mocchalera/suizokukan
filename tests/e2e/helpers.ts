import { expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const artifactDirectory = process.env.E2E_ARTIFACT_DIR || 'test-artifacts/runtime/e2e';

export async function sample(page: Page, name = 'さんごちゃん') {
  await page.goto('/create');
  await page.getByRole('button', { name: 'おためしの しゃしん →', exact: true }).click();
  const source = await page.locator('.crop-view img').getAttribute('src');
  if (source?.startsWith('data:image/jpeg;base64,')) {
    await mkdir(`${artifactDirectory}/fixtures`, { recursive: true });
    await writeFile(`${artifactDirectory}/fixtures/original-synthetic-drawing.jpg`, Buffer.from(source.split(',')[1], 'base64'));
  }
  await expect(page.getByRole('button', { name: '左上の切り抜き位置' })).toBeVisible();
  await page.getByRole('button', { name: '左上の切り抜き位置' }).press('ArrowRight');
  await page.getByRole('button', { name: 'このはんいで きりぬく →' }).click();
  await expect(page.getByRole('button', { name: 'このこで つづける →' })).toBeEnabled();
  await page.getByRole('button', { name: 'このこで つづける →' }).click();
  await page.getByRole('textbox', { name: 'なまえ', exact: true }).fill(name);
  await page.getByRole('button', { name: 'ぷかぷか', exact: false }).click();
  await page.getByRole('button', { name: '↔ あたまの むきを はんたいに' }).click();
  await page.getByRole('button', { name: '✧ うみに はなす', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.sea')).toHaveAttribute('data-loaded', '5');
}

export async function screen(page: Page, name: string) {
  await mkdir(artifactDirectory, { recursive: true });
  await page.screenshot({ path: `${artifactDirectory}/${name}.png`, fullPage: true, animations: 'disabled' });
}

export async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
