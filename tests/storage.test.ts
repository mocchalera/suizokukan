import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { deleteCreature, importCreatures, loadCreatures, openDatabase, saveCreature } from '../src/lib/storage';
import { creature } from './fixtures';

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); });
describe('IndexedDB transactional collection', () => {
  it('persists across opens, restores sources, and deletes explicitly', async () => {
    const entry = { ...creature(), source: 'data:image/jpeg;base64,YQ==' };
    await saveCreature(entry); expect(await loadCreatures()).toEqual([entry]);
    await deleteCreature(entry.id); expect(await loadCreatures()).toEqual([]);
  });
  it('imports without overwriting an existing creature and rests newcomers', async () => {
    await saveCreature(creature()); await importCreatures([{ ...creature(), name: 'do not replace' }, creature(2)]);
    const entries = await loadCreatures(); expect(entries[0].name).toBe(creature().name); expect(entries[1].inSea).toBe(false);
  });
  it('aborts the whole import over capacity; existing data is unchanged', async () => {
    await importCreatures(Array.from({ length: 39 }, (_, index) => creature(index + 1)));
    await expect(importCreatures([creature(40), creature(41)])).rejects.toThrow(); expect(await loadCreatures()).toHaveLength(39);
  });
  it('surfaces quota failure, never resolves a failed write', async () => {
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    await expect(saveCreature(creature())).rejects.toThrow(); put.mockRestore(); expect(await loadCreatures()).toEqual([]);
  });
  it('protects malformed records rather than silently overwriting or dropping them', async () => {
    const database = await openDatabase(); const tx = database.transaction('creatures', 'readwrite'); tx.objectStore('creatures').put({ id: 'broken', image: 'https://invalid' });
    await new Promise<void>(resolve => { tx.oncomplete = () => { database.close(); resolve(); }; });
    await expect(loadCreatures()).rejects.toThrow();
    const reopened = await openDatabase(); const request = reopened.transaction('creatures').objectStore('creatures').count();
    expect(await new Promise(resolve => { request.onsuccess = () => resolve(request.result); })).toBe(1); reopened.close();
  });
});
