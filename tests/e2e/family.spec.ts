import { expect, test } from '@playwright/test';
import { creature } from '../fixtures';
import { noOverflow, sample, screen } from './helpers';

test('two independent devices join privately, acknowledge, reconnect and end', async ({ page, browser }, info) => {
  const guestContext = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 390, height: 844 } });
  const guest = await guestContext.newPage();
  const failures: string[] = [];
  for (const current of [page, guest]) current.on('pageerror', () => failures.push('uncaught browser error'));
  let roomId = ''; let ownerKey = '';
  try {
    await sample(guest, 'かぞくのさかな');
    await page.goto('/family');
    await page.getByRole('button', { name: '＋ みんなのうみを つくる', exact: true }).click();
    await expect(page.getByText('● つながっているよ', { exact: true })).toBeVisible();
    roomId = new URL(page.url()).pathname.split('/')[2];
    ownerKey = await page.evaluate(id => JSON.parse(sessionStorage.getItem(`umi-room:${id}`)!).owner, roomId);
    await page.getByRole('button', { name: '▦ 家族を しょうたい', exact: true }).click();
    await expect(page.getByLabel('招待リンクのQRコード')).toBeVisible();
    const invite = await page.getByLabel('共有する招待リンク', { exact: true }).inputValue();
    expect(invite.includes(ownerKey)).toBe(false);
    expect([...new URLSearchParams(new URL(invite).hash.slice(1)).keys()]).toEqual(['join']);
    await page.getByRole('button', { name: '▦ 家族を しょうたい', exact: true }).click();
    await page.getByRole('button', { name: 'いったん もどる', exact: true }).click();
    await expect(page).toHaveURL(/\/family$/);
    if (info.project.name === 'desktop') {
      await page.getByText('招待リンクを はりつけて参加', { exact: true }).click();
      await page.getByLabel('招待リンク', { exact: true }).fill(invite);
      await page.getByRole('button', { name: 'このうみに はいる', exact: true }).click();
    } else {
      try { await page.goto(invite); } catch { throw new Error('Owner return navigation failed (URL redacted)'); }
    }
    await expect(page.getByText('● つながっているよ', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'このうみを 終了する', exact: true })).toBeVisible();
    expect(await page.evaluate(async id => {
      const stored = JSON.parse(sessionStorage.getItem(`umi-room:${id}`)!);
      const response = await fetch(`/api/rooms/${id}`, { headers: { Authorization: `Bearer ${stored.owner}` } });
      return (await response.json()).role;
    }, roomId)).toBe('owner');
    try { await guest.goto(invite); } catch { throw new Error('Invite navigation failed (URL redacted)'); }
    await expect(guest.getByText('● つながっているよ', { exact: true })).toBeVisible();
    expect(new URL(guest.url()).hash).toBe('');
    await guest.getByLabel('共有するいきもの', { exact: true }).selectOption({ label: 'かぞくのさかな' });
    await guest.getByLabel('わたしのしるし', { exact: true }).selectOption('ももいろ');
    const posts: string[] = [];
    guest.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/creatures')) posts.push(request.postData() ?? ''); });
    await guest.getByRole('button', { name: 'このこを つれてくる', exact: true }).click();
    await expect(page.locator('.shared-member')).toHaveCount(0);
    await guest.getByRole('button', { name: '切り抜きだけ 送る', exact: true }).click();
    for (const current of [page, guest]) {
      await expect(current.locator('.shared-member')).toHaveCount(1);
      await expect(current.locator('.shared-member')).toHaveAttribute('data-ready', 'true');
      await expect(current.locator('.sea')).toHaveAttribute('data-loaded', '1');
      await noOverflow(current);
    }
    expect(posts).toHaveLength(1);
    expect(posts[0].includes('data:image/jpeg')).toBe(false);
    expect(Object.keys(JSON.parse(posts[0]).creature)).not.toContain('source');
    await screen(page, `${info.project.name}-family-owner`);
    await screen(guest, `${info.project.name}-family-phone`);
    await guest.reload();
    await expect(guest.locator('.shared-member')).toHaveAttribute('data-ready', 'true');
    await page.reload();
    await expect(page.locator('.sea')).toHaveAttribute('data-loaded', '1');
    await guest.getByLabel('共有するいきもの', { exact: true }).selectOption({ label: 'かぞくのさかな' });
    await guest.getByLabel('わたしのしるし', { exact: true }).selectOption('ももいろ');
    await guest.getByRole('button', { name: 'このこを つれてくる', exact: true }).click();
    await guest.getByRole('button', { name: '切り抜きだけ 送る', exact: true }).click();
    await expect(guest.getByText('このこは もう同じうみにいます。', { exact: true })).toBeVisible();
    await expect(page.locator('.shared-member')).toHaveCount(1);
    await guest.getByRole('button', { name: 'よぶ', exact: true }).click();
    await page.getByRole('button', { name: '共有から はずす', exact: true }).click();
    await page.getByRole('button', { name: '共有コピーを 消す', exact: true }).click();
    await expect(guest.locator('.shared-member')).toHaveCount(0);
    await page.getByRole('button', { name: 'このうみを 終了する', exact: true }).click();
    await page.getByRole('button', { name: '終了して 共有画像を消す', exact: true }).click();
    for (const current of [page, guest]) await expect(current.getByRole('heading', { name: 'このうみは、おやすみ。' })).toBeVisible();
    await guest.getByRole('link', { name: 'ずかん', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'かぞくのさかな', exact: true })).toBeVisible();
    expect(failures).toEqual([]);
  } finally {
    if (roomId && ownerKey) await page.request.delete(`/api/rooms/${roomId}`, { headers: { Authorization: `Bearer ${ownerKey}` } }).catch(() => {});
    await guestContext.close();
  }
});

test('real room API rejects unauthorized, malformed, oversized, foreign-origin and excess writes', async ({ request }, info) => {
  test.skip(info.project.name !== 'desktop', 'One bounded security room per suite');
  const created = await request.post('/api/rooms');
  expect(created.status()).toBe(201);
  const keys = await created.json();
  const route = `/api/rooms/${keys.id}`;
  const guestHeaders = { Authorization: `Bearer ${keys.join}` };
  const ownerHeaders = { Authorization: `Bearer ${keys.owner}` };
  try {
    expect((await request.get(route)).status()).toBe(401);
    expect((await request.get(route, { headers: { Authorization: `Bearer ${'0'.repeat(64)}` } })).status()).toBe(403);
    expect((await request.delete(route, { headers: guestHeaders })).status()).toBe(403);
    expect((await request.post(`${route}/creatures`, { headers: { ...guestHeaders, Origin: 'https://untrusted.invalid' }, data: {} })).status()).toBe(403);
    expect((await request.post(`${route}/creatures`, { headers: guestHeaders, data: { creature: { ...creature(), image: 'https://untrusted.invalid/pic.png' }, sender: 'みずいろ' } })).status()).toBe(400);
    expect((await request.post(`${route}/creatures`, { headers: { ...guestHeaders, 'Content-Type': 'application/json' }, data: '{' })).status()).toBe(400);
    expect((await request.post(`${route}/creatures`, { headers: guestHeaders, data: { pad: 'a'.repeat(260000) } })).status()).toBe(413);
    const body = { creature: creature(), sender: 'みずいろ' };
    expect((await request.post(`${route}/creatures`, { headers: guestHeaders, data: body })).status()).toBe(201);
    const duplicate = await request.post(`${route}/creatures`, { headers: guestHeaders, data: body });
    expect(duplicate.status()).toBe(200); expect((await duplicate.json()).duplicate).toBe(true);
    expect((await request.post(`${route}/creatures`, { headers: guestHeaders, data: { ...body, sender: 'ももいろ' } })).status()).toBe(409);
    expect((await request.get(`${route}/creatures/${body.creature.id}/image`)).status()).toBe(401);
    expect((await request.get(`${route}/creatures/${body.creature.id}/image`, { headers: guestHeaders })).headers()['content-type']).toContain('image/png');
    for (let index = 2; index <= 20; index++) expect((await request.post(`${route}/creatures`, { headers: guestHeaders, data: { creature: creature(index), sender: 'みずいろ' } })).status()).toBe(201);
    expect((await request.post(`${route}/creatures`, { headers: guestHeaders, data: { creature: creature(21), sender: 'みずいろ' } })).status()).toBe(409);
    const snapshot = await request.get(route, { headers: guestHeaders });
    expect((await snapshot.json()).creatures).toHaveLength(20);
    expect((await request.delete(route, { headers: ownerHeaders })).status()).toBe(200);
    expect((await request.get(route, { headers: guestHeaders })).status()).toBe(410);
  } finally { await request.delete(route, { headers: ownerHeaders }); }
});
