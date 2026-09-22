import { expect, test } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { LIMITS } from '../../shared/model';
import { creature, png, replacePngData } from '../fixtures';
import { noOverflow, sample, screen } from './helpers';

test('real Worker converges pending uploads, deduplicates ACKs and rejects broken PNG data', async ({ page, browser, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'One isolated convergence room per suite');
  test.setTimeout(90000);
  const guestContext = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 390, height: 844 } });
  const guest = await guestContext.newPage();
  const failures: string[] = [];
  for (const current of [page, guest]) current.on('pageerror', () => failures.push('uncaught browser error'));
  let route = ''; let ownerKey = '';
  try {
    await sample(guest, 'おるすばんのこ');
    const created = await request.post('/api/rooms');
    expect(created.status()).toBe(201);
    const keys = await created.json();
    route = `/api/rooms/${keys.id}`; ownerKey = keys.owner;
    const guestHeaders = { Authorization: `Bearer ${keys.join}` };
    const ownerHeaders = { Authorization: `Bearer ${ownerKey}` };
    await page.goto('/family');
    const ticketResponse = await request.post(`${route}/ticket`, { headers: ownerHeaders });
    expect(ticketResponse.status()).toBe(200);
    const { ticket } = await ticketResponse.json();
    await page.evaluate(async ({ route, ticket }) => {
      const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${route}/socket`, ['umi-v1', ticket]);
      const probe = { socket, ready: [] as string[], snapshots: 0, barriers: 0 };
      (window as unknown as { roomProbe: typeof probe }).roomProbe = probe;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { socket.close(); reject(new Error('Socket probe timed out')); }, 10000);
        socket.onmessage = event => {
          if (event.data === 'pong') return;
          const message = JSON.parse(event.data);
          if (message.type === 'ready') probe.ready.push(message.id);
          if (message.type === 'interaction') probe.barriers++;
          if (message.type === 'snapshot') { probe.snapshots++; clearTimeout(timer); resolve(); }
        };
        socket.onerror = () => { clearTimeout(timer); reject(new Error('Socket probe failed')); };
      });
    }, { route, ticket });

    const original = png();
    const raw = Buffer.alloc((32 * 4 + 1) * 32);
    const invalidFilter = Buffer.from(raw); invalidFilter[0] = 5;
    const stream = deflateSync(raw);
    const broken = [
      Buffer.from('broken-deflate'), stream.subarray(0, -1),
      Buffer.concat([stream.subarray(0, -1), Buffer.from([stream[stream.length - 1] ^ 1])]),
      deflateSync(Buffer.alloc(raw.length - 1)), deflateSync(invalidFilter),
      Buffer.concat([stream, Buffer.from([0])]), deflateSync(Buffer.alloc(raw.length * 32)),
    ];
    for (const compressed of broken) {
      const bad = { ...creature(), image: replacePngData(original, compressed) };
      expect((await request.post(`${route}/creatures`, { headers: guestHeaders, data: { creature: bad, sender: 'みずいろ' } })).status()).toBe(400);
      expect((await request.get(`${route}/creatures/${bad.id}/image`, { headers: guestHeaders })).status()).toBe(404);
    }
    expect((await (await request.get(route, { headers: guestHeaders })).json()).creatures).toHaveLength(0);
    const readyCreature = { ...creature(), image: png(512) };
    expect((await request.post(`${route}/creatures`, { headers: guestHeaders, data: { creature: readyCreature, sender: 'みずいろ' } })).status()).toBe(201);
    await page.evaluate(id => {
      const probe = (window as unknown as { roomProbe: { socket: WebSocket } }).roomProbe;
      for (let repeat = 0; repeat < 5; repeat++) probe.socket.send(JSON.stringify({ type: 'ready', id }));
      probe.socket.send(JSON.stringify({ type: 'food', x: 0.5, y: 0.5 }));
    }, readyCreature.id);
    await expect.poll(() => page.evaluate(() => (window as unknown as { roomProbe: { ready: string[] } }).roomProbe.ready.length)).toBe(1);
    await expect.poll(async () => (await (await request.get(route, { headers: guestHeaders })).json()).creatures[0].ready).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as unknown as { roomProbe: { barriers: number } }).roomProbe.barriers)).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { roomProbe: { ready: string[] } }).roomProbe.ready.length)).toBe(1);
    await page.evaluate(() => (window as unknown as { roomProbe: { socket: WebSocket } }).roomProbe.socket.close());
    expect((await request.delete(`${route}/creatures/${readyCreature.id}`, { headers: ownerHeaders })).status()).toBe(200);

    const invite = `${info.project.use.baseURL}/room/${keys.id}#join=${keys.join}`;
    try { await guest.goto(invite); } catch { throw new Error('Invite navigation failed (URL redacted)'); }
    await expect(guest.getByText('● つながっているよ', { exact: true })).toBeVisible();
    await guest.getByLabel('共有するいきもの', { exact: true }).selectOption({ label: 'おるすばんのこ' });
    const posts: string[] = [];
    guest.on('request', current => { if (current.method() === 'POST' && current.url().endsWith('/creatures')) posts.push(current.postData() ?? ''); });
    await guest.getByRole('button', { name: 'このこを つれてくる', exact: true }).click();
    await guest.getByRole('button', { name: '切り抜きだけ 送る', exact: true }).click();
    await expect(guest.locator('.shared-member')).toHaveAttribute('data-ready', 'false');
    await expect(guest.locator('.shared-member')).toHaveAttribute('data-failed', 'false');
    await expect(guest.locator('.sea')).toHaveAttribute('data-loaded', '1');
    const body = JSON.parse(posts[0]);
    await expect(guest.locator('.shared-member')).toHaveAttribute('data-failed', 'true', { timeout: LIMITS.roomPendingMs + 10000 });
    await expect(guest.locator('.shared-member')).toHaveAttribute('data-ready', 'false');
    await expect(guest.locator('.sea')).toHaveAttribute('data-loaded', '0');
    await expect(guest.getByRole('button', { name: 'よぶ', exact: true })).toBeDisabled();
    expect(posts).toHaveLength(1);
    expect((await request.get(`${route}/creatures/${body.creature.id}/image`, { headers: guestHeaders })).status()).toBe(410);
    await guest.reload();
    await expect(guest.locator('.shared-member')).toHaveAttribute('data-failed', 'true');
    await guest.getByLabel('共有するいきもの', { exact: true }).selectOption({ label: 'おるすばんのこ' });
    await guest.getByRole('button', { name: 'このこを つれてくる', exact: true }).click();
    await guest.getByRole('button', { name: '切り抜きだけ 送る', exact: true }).click();
    await expect(guest.getByText('前の送信は届きませんでした。作成者が「共有から はずす」を押してから、もう一度送ってね。', { exact: true })).toBeVisible();
    await expect(guest.locator('.shared-member')).toHaveCount(1);
    await expect(guest.locator('.shared-member')).toHaveAttribute('data-failed', 'true');
    await noOverflow(guest);
    await screen(guest, 'desktop-family-pending-expired');
    expect((await request.delete(`${route}/creatures/${body.creature.id}`, { headers: ownerHeaders })).status()).toBe(200);
    await expect(guest.locator('.shared-member')).toHaveCount(0);
    expect((await request.delete(route, { headers: ownerHeaders })).status()).toBe(200);
    await expect(guest.getByRole('heading', { name: 'このうみは、おやすみ。' })).toBeVisible();
    await guest.getByRole('link', { name: 'ずかん', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'おるすばんのこ', exact: true })).toBeVisible();
    expect(failures).toEqual([]);
  } finally {
    if (route && ownerKey) await request.delete(route, { headers: { Authorization: `Bearer ${ownerKey}` } }).catch(() => {});
    await guestContext.close();
  }
});
