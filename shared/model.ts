export const LIMITS = {
  collection: 40, sea: 20, roomCreatures: 20, pngBytes: 180_000, pngSide: 512,
  backupBytes: 10_000_000, photoBytes: 15_000_000, photoPixels: 40_000_000,
  roomMs: 6 * 60 * 60 * 1000, connections: 16, requestBytes: 245_000,
} as const;

export const SWIMS = ['swim', 'float', 'odd'] as const;
export const MOODS = ['curious', 'shy', 'calm'] as const;
export type Swim = typeof SWIMS[number];
export type Mood = typeof MOODS[number];
export type Personality = { mood: Mood; energy: number; bubbleLove: number };
export type Creature = {
  id: string; name: string; image: string; swim: Swim; personality: Personality;
  facing: 'left' | 'right'; createdAt: number; inSea: boolean;
};
export type LocalCreature = Creature & { source?: string };
export const PRESETS: Record<Mood, Personality> = {
  curious: { mood: 'curious', energy: 0.7, bubbleLove: 0.9 },
  shy: { mood: 'shy', energy: 0.4, bubbleLove: 0.7 },
  calm: { mood: 'calm', energy: 0.22, bubbleLove: 0.5 },
};
export const swimLabel: Record<Swim, string> = { swim: 'すいすい', float: 'ぷかぷか', odd: 'ふしぎ' };
export const moodLabel: Record<Mood, string> = { curious: 'わくわく', shy: 'はずかしがり', calm: 'のんびり' };
export const isId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export const isCapability = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('データのかたちがちがいます。');
  return value as Record<string, unknown>;
}
export function safeName(value: unknown): string {
  if (typeof value !== 'string' || value.length > 24 || /[<>\u0000-\u001f\u007f]|https?:|data:|javascript:|www\./i.test(value)) throw new Error('なまえは24文字まで。URLや記号のコードは使えません。');
  return value.trim();
}
export function personality(value: unknown): Personality {
  const candidate = object(value);
  if (!MOODS.includes(candidate.mood as Mood) || typeof candidate.energy !== 'number' || typeof candidate.bubbleLove !== 'number' || !Number.isFinite(candidate.energy) || !Number.isFinite(candidate.bubbleLove)) throw new Error('せいかくのデータを読めません。');
  return { mood: candidate.mood as Mood, energy: clamp(candidate.energy, 0, 1), bubbleLove: clamp(candidate.bubbleLove, 0, 1) };
}

function crc32(bytes: Uint8Array): number {
  let result = 0xffffffff;
  for (const byte of bytes) {
    result ^= byte;
    for (let bit = 0; bit < 8; bit++) result = (result >>> 1) ^ ((result & 1) ? 0xedb88320 : 0);
  }
  return (result ^ 0xffffffff) >>> 0;
}
export function validatePng(value: unknown): string {
  if (typeof value !== 'string' || value.length > LIMITS.pngBytes * 4 / 3 + 30 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('切り抜きPNGだけを使えます（180KBまで）。');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(value.slice(22)), character => character.charCodeAt(0)); } catch { throw new Error('画像を読めません。'); }
  if (bytes.length > LIMITS.pngBytes || bytes.length < 45 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) throw new Error('PNG画像ではありません。');
  const view = new DataView(bytes.buffer);
  let offset = 8;
  let ended = false;
  let hasData = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const kind = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (length > bytes.length - offset - 12 || !['IHDR', 'IDAT', 'IEND', 'PLTE', 'tRNS', 'sRGB', 'gAMA', 'cHRM', 'pHYs'].includes(kind)) throw new Error('画像に非対応の情報が含まれています。撮り直してください。');
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length)) throw new Error('画像がこわれています。');
    if (offset === 8) {
      if (kind !== 'IHDR' || length !== 13) throw new Error('画像ヘッダーが不正です。');
      const width = view.getUint32(offset + 8);
      const height = view.getUint32(offset + 12);
      if (width < 1 || height < 1 || width > LIMITS.pngSide || height > LIMITS.pngSide || bytes[offset + 16] !== 8 || ![0, 2, 3, 4, 6].includes(bytes[offset + 17]) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] !== 0) throw new Error('画像は512px以内のPNGにしてください。');
    } else if (kind === 'IHDR') throw new Error('画像ヘッダーが重複しています。');
    if (kind === 'IDAT') hasData = true;
    offset += length + 12;
    if (kind === 'IEND') { ended = length === 0; break; }
  }
  if (!ended || !hasData || offset !== bytes.length) throw new Error('画像の末尾が不正です。');
  return value;
}

export function validateCreature(value: unknown): Creature {
  const candidate = object(value);
  if (!isId(candidate.id) || !SWIMS.includes(candidate.swim as Swim) || !['left', 'right'].includes(candidate.facing as string) || typeof candidate.createdAt !== 'number' || !Number.isFinite(candidate.createdAt) || candidate.createdAt < 0 || candidate.createdAt > 4_102_444_800_000 || typeof candidate.inSea !== 'boolean') throw new Error('いきもののデータが不正です。');
  return {
    id: candidate.id, name: safeName(candidate.name), image: validatePng(candidate.image),
    swim: candidate.swim as Swim, personality: personality(candidate.personality), facing: candidate.facing as Creature['facing'],
    createdAt: candidate.createdAt, inSea: candidate.inSea,
  };
}
export function parseBackup(text: string): Creature[] {
  if (new TextEncoder().encode(text).length > LIMITS.backupBytes) throw new Error('バックアップは10MBまでです。');
  let data: Record<string, unknown>;
  try { data = object(JSON.parse(text)); } catch { throw new Error('バックアップを読めません。JSONファイルを選んでください。'); }
  if (data.format !== 'oekaki-no-umi' || data.version !== 1 || !Array.isArray(data.creatures) || data.creatures.length > LIMITS.collection) throw new Error('対応していないバックアップです。');
  const creatures = data.creatures.map(validateCreature);
  if (new Set(creatures.map(creature => creature.id)).size !== creatures.length) throw new Error('いきもののIDが重複しています。');
  return creatures;
}
export function makeBackup(creatures: LocalCreature[]): string {
  return JSON.stringify({ format: 'oekaki-no-umi', version: 1, exportedAt: new Date().toISOString(), creatures: creatures.map(validateCreature) });
}
