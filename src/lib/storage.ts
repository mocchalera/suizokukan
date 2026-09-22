import { LIMITS, validateCreature, type Creature, type LocalCreature } from '../../shared/model';

export async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open('oekaki-no-umi', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('creatures', { keyPath: 'id' });
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    request.onerror = () => reject(new Error('このブラウザに保存できません。プライベートモードや空き容量を確認してください。'));
    request.onblocked = () => { blocked = true; reject(new Error('別のタブを閉じて、もう一度おためしください。')); };
  });
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, done: (value: T) => void) => void): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('creatures', mode);
    let value: T;
    tx.oncomplete = () => { database.close(); resolve(value); };
    tx.onerror = tx.onabort = () => { database.close(); reject(new Error('保存できませんでした。空き容量を確認してから、もう一度おためしください。')); };
    try { action(tx.objectStore('creatures'), result => { value = result; }); } catch (error) { tx.abort(); database.close(); reject(error); }
  });
}
export async function loadCreatures(): Promise<LocalCreature[]> {
  const rows = await transaction<unknown[]>('readonly', (store, done) => { const request = store.getAll(); request.onsuccess = () => done(request.result); });
  return rows.map(row => {
    const valid = validateCreature(row);
    const source = (row as LocalCreature).source;
    if (source !== undefined && (typeof source !== 'string' || source.length > 3_000_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(source))) throw new Error('元写真の保存データを読めません。データを消さずに保護しています。');
    return { ...valid, source };
  });
}
export async function saveCreature(creature: LocalCreature): Promise<void> {
  validateCreature(creature);
  return transaction('readwrite', (store, done) => {
    const count = store.count();
    count.onsuccess = () => {
      const existing = store.getKey(creature.id);
      existing.onsuccess = () => {
        if (!existing.result && count.result >= LIMITS.collection) { store.transaction.abort(); return; }
        store.put(creature); done(undefined);
      };
    };
  });
}
export async function deleteCreature(id: string): Promise<void> {
  return transaction('readwrite', (store, done) => { store.delete(id); done(undefined); });
}
export async function importCreatures(creatures: Creature[]): Promise<void> {
  const validated = creatures.map(validateCreature);
  return transaction('readwrite', (store, done) => {
    const request = store.getAllKeys();
    request.onsuccess = () => {
      const existing = new Set(request.result);
      const additions = validated.filter(creature => !existing.has(creature.id));
      if (existing.size + additions.length > LIMITS.collection) { store.transaction.abort(); return; }
      for (const creature of additions) store.add({ ...creature, inSea: false });
      done(undefined);
    };
  });
}
