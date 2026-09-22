import { useEffect, useId, useRef, type ReactNode } from 'react';

export function Confirm({ title, children, confirm, onConfirm, onCancel, busy = false }: { title: string; children: ReactNode; confirm: string; onConfirm: () => void; onCancel: () => void; busy?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  return <dialog ref={dialog} className="modal" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}><h2 id={titleId}>{title}</h2>{children}<div className="button-row"><button className="primary" disabled={busy} onClick={onConfirm}>{busy ? 'じゅんび中…' : confirm}</button><button disabled={busy} onClick={onCancel}>やめておく</button></div></dialog>;
}
