import { useEffect, useRef, useState } from 'react';
import { isCapability, isId, type Creature } from '../../shared/model';
import type { SeaEvent } from '../../shared/behavior';
import { api, messageOf } from './api';
import { imageElement } from './images';

export type RoomKeys = { join: string; owner?: string };
export type MemberCreature = Omit<Creature, 'image'> & { ready: boolean; failed: boolean; sender: string };
type Snapshot = { creatures: MemberCreature[]; expiresAt: number; role?: 'owner' | 'guest' };
export const sessionKey = (id: string) => `umi-room:${id}`;
export function storeRoom(id: string, keys: RoomKeys) {
  if (!isId(id) || !isCapability(keys.join) || (keys.owner !== undefined && !isCapability(keys.owner))) throw new Error('招待のデータがちがいます。');
  let previous: RoomKeys | null = null;
  try { previous = JSON.parse(sessionStorage.getItem(sessionKey(id)) ?? 'null') as RoomKeys | null; } catch {}
  const owner = keys.owner ?? (previous?.join === keys.join && isCapability(previous.owner) ? previous.owner : undefined);
  sessionStorage.setItem(sessionKey(id), JSON.stringify({ join: keys.join, ...(owner ? { owner } : {}) }));
}
export function readRoom(id: string): RoomKeys | null {
  if (!isId(id)) return null;
  const fragment = new URLSearchParams(location.hash.slice(1)); const invitation = fragment.get('join');
  if (location.hash) history.replaceState({}, '', location.pathname);
  try {
    const stored = sessionStorage.getItem(sessionKey(id)); const value = stored ? JSON.parse(stored) as RoomKeys : null;
    if (invitation && isCapability(invitation)) { const keys = { join: invitation, ...(value?.join === invitation && isCapability(value.owner) ? { owner: value.owner } : {}) }; storeRoom(id, keys); return keys; }
    return value && isCapability(value.join) && (!value.owner || isCapability(value.owner)) ? value : null;
  } catch { return null; }
}
export function useRoom(id: string, keys: RoomKeys | null) {
  const [status, setStatus] = useState<'connecting' | 'online' | 'offline' | 'closed' | 'error'>('connecting');
  const [error, setError] = useState(''); const [members, setMembers] = useState<MemberCreature[]>([]); const [creatures, setCreatures] = useState<Creature[]>([]); const [expiresAt, setExpiresAt] = useState(0);
  const [remoteEvent, setRemoteEvent] = useState<(Omit<SeaEvent, 'age'> & { sequence: number })>();
  const [attempt, setAttempt] = useState(0); const socket = useRef<WebSocket | null>(null); const cache = useRef(new Map<string, string>());
  const headers = keys ? { Authorization: `Bearer ${keys.owner ?? keys.join}` } : undefined;
  useEffect(() => {
    if (!keys) { setStatus('error'); setError('招待リンクから このうみを開いてください。リンクは家族だけで共有してね。'); return; }
    let disposed = false; let closed = false; let tries = 0; let timer = 0; let heartbeat = 0; let generation = 0; let sequence = 0;
    const controller = new AbortController();
    const receiveSnapshot = async (snapshot: Snapshot) => {
      const current = ++generation; setExpiresAt(snapshot.expiresAt); setMembers(snapshot.creatures);
      const active = snapshot.creatures.filter(creature => !creature.failed);
      try {
        const prepared = await Promise.all(active.map(async creature => {
          let source = cache.current.get(creature.id);
          if (!source) {
            const response = await fetch(`/api/rooms/${id}/creatures/${creature.id}/image`, { headers, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
            if (!response.ok) throw new Error('共有画像を読みこめませんでした。再接続してください。');
            const blob = await response.blob(); if (blob.size > 180000 || blob.type !== 'image/png') throw new Error('共有画像の形式がちがいます。');
            source = URL.createObjectURL(blob);
            try { await imageElement(source); } catch (failure) { URL.revokeObjectURL(source); throw failure; }
            if (disposed || current !== generation) { URL.revokeObjectURL(source); return null; }
            cache.current.set(creature.id, source);
          }
          return { ...creature, image: source };
        }));
        if (disposed || current !== generation) return;
        for (const [creatureId, source] of cache.current) if (!active.some(creature => creature.id === creatureId)) { URL.revokeObjectURL(source); cache.current.delete(creatureId); }
        setCreatures(prepared.filter((creature): creature is NonNullable<typeof creature> => !!creature));
        if (keys.owner && socket.current?.readyState === WebSocket.OPEN) for (const creature of active) if (!creature.ready) socket.current.send(JSON.stringify({ type: 'ready', id: creature.id }));
      } catch (failure) { if (!disposed && current === generation) setError(messageOf(failure)); }
    };
    const connect = async () => {
      if (disposed || closed) return;
      setStatus('connecting'); setError('');
      try {
        const response = await fetch(`/api/rooms/${id}`, { headers, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (response.status === 410) { closed = true; setStatus('closed'); setCreatures([]); setMembers([]); sessionStorage.removeItem(sessionKey(id)); return; }
        if (!response.ok) { closed = true; setStatus('error'); setError('この招待では参加できません。家族に新しいリンクをもらってね。'); return; }
        const snapshot = await response.json() as Snapshot; setExpiresAt(snapshot.expiresAt);
        const { ticket } = await api<{ ticket: string }>(`/api/rooms/${id}/ticket`, { method: 'POST', headers, signal: controller.signal });
        if (disposed) return;
        const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/rooms/${id}/socket`, ['umi-v1', ticket]); socket.current = ws;
        const connecting = window.setTimeout(() => ws.close(), 10000);
        ws.onopen = () => { clearTimeout(connecting); if (disposed) { ws.close(); return; } tries = 0; setStatus('online'); heartbeat = window.setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 20000); };
        ws.onmessage = event => {
          if (disposed || event.data === 'pong') return;
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'snapshot') void receiveSnapshot(data);
            if (data.type === 'ready') setMembers(current => current.map(creature => creature.id === data.id ? { ...creature, ready: true } : creature));
            if (data.type === 'interaction') setRemoteEvent({ ...data.interaction, sequence: ++sequence });
            if (data.type === 'closed') { closed = true; generation++; setStatus('closed'); setCreatures([]); setMembers([]); sessionStorage.removeItem(sessionKey(id)); }
            if (data.type === 'error') setError('操作を少し待って、もう一度。');
          } catch { setError('同期データを読めませんでした。'); }
        };
        ws.onclose = () => { clearTimeout(connecting); clearInterval(heartbeat); if (!disposed && !closed) { setStatus('offline'); retry(); } };
        ws.onerror = () => { if (!disposed && !closed) setError('接続が切れました。自動でつなぎなおします。'); };
      } catch (failure) { if (!disposed && !closed) { setStatus('offline'); setError(messageOf(failure)); retry(); } }
    };
    const retry = () => { if (tries++ < 8) timer = window.setTimeout(() => void connect(), Math.min(15000, 1000 * 2 ** Math.min(tries, 4))); else setError('つなぎなおすボタンで再接続してください。'); };
    void connect();
    return () => { disposed = true; generation++; controller.abort(); clearTimeout(timer); clearInterval(heartbeat); socket.current?.close(); socket.current = null; for (const source of cache.current.values()) URL.revokeObjectURL(source); cache.current.clear(); };
  }, [id, keys, attempt]);
  const send = (event: Omit<SeaEvent, 'age'>) => { if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(event)); };
  return { status, error, members, creatures, expiresAt, remoteEvent, headers, send, retry: () => setAttempt(value => value + 1) };
}
