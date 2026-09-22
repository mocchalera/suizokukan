import { useEffect, useRef, useState } from 'react';
import type { Creature } from '../../shared/model';
import { LIMITS, PRESETS } from '../../shared/model';
import { createSwimmer, tickSwimmer, type SeaEvent, type Swimmer } from '../../shared/behavior';

export const DEMOS: Creature[] = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'さんごちゃん', image: '/art/fish-coral.svg', swim: 'swim', personality: PRESETS.curious, facing: 'right', createdAt: 0, inSea: true },
  { id: '00000000-0000-4000-8000-000000000002', name: 'ぷかり', image: '/art/jelly-lilac.svg', swim: 'float', personality: PRESETS.calm, facing: 'right', createdAt: 0, inSea: true },
  { id: '00000000-0000-4000-8000-000000000003', name: 'おひさま', image: '/art/fish-sun.svg', swim: 'swim', personality: PRESETS.shy, facing: 'right', createdAt: 0, inSea: true },
  { id: '00000000-0000-4000-8000-000000000004', name: 'もじゃ', image: '/art/odd-mint.svg', swim: 'odd', personality: PRESETS.curious, facing: 'right', createdAt: 0, inSea: true },
];
type Interaction = Omit<SeaEvent, 'age'>;
type Props = { creatures: Creature[]; onInteraction?: (event: Interaction) => void; remoteEvent?: Interaction & { sequence: number }; findId?: string; quiet?: boolean };

export function Sea({ creatures, onInteraction, remoteEvent, findId, quiet = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const creatureRef = useRef(creatures); creatureRef.current = creatures.slice(0, LIMITS.sea);
  const swimmers = useRef(new Map<string, Swimmer>());
  const images = useRef(new Map<string, { image: HTMLImageElement; source: string }>());
  const events = useRef<SeaEvent[]>([]);
  const [mode, setMode] = useState<'bubble' | 'food'>('bubble');
  const [announcement, setAnnouncement] = useState('うみを さわってみてね');
  const [loaded, setLoaded] = useState(0);
  useEffect(() => {
    let disposed = false;
    const current = creatures.slice(0, LIMITS.sea);
    for (const [id] of images.current) if (!current.some(creature => creature.id === id)) { images.current.delete(id); swimmers.current.delete(id); }
    for (const creature of current) {
      if (!swimmers.current.has(creature.id)) swimmers.current.set(creature.id, createSwimmer(creature.id));
      if (images.current.get(creature.id)?.source === creature.image) continue;
      const image = new Image(); image.src = creature.image;
      void image.decode().then(() => { if (!disposed) { images.current.set(creature.id, { image, source: creature.image }); setLoaded(images.current.size); } }).catch(() => { if (!disposed) setAnnouncement('ひとつの画像を読みこめませんでした'); });
    }
    setLoaded(images.current.size);
    return () => { disposed = true; };
  }, [creatures]);
  useEffect(() => {
    if (remoteEvent) events.current.push({ ...remoteEvent, age: 0 });
    events.current = events.current.slice(-24);
  }, [remoteEvent]);
  useEffect(() => {
    if (!findId) return;
    events.current.push({ type: 'call', id: findId, x: 0.5, y: 0.4, age: 0 });
    const state = swimmers.current.get(findId); if (state) { state.x = 0.5; state.y = 0.4; state.reaction = 1; }
    setAnnouncement(`${creatureRef.current.find(creature => creature.id === findId)?.name || 'このこ'}、ここにいるよ！`);
  }, [findId]);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const context = canvas.getContext('2d'); if (!context) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let width = 1; let height = 1; let frame = 0; let last = 0; let disposed = false;
    const resize = () => { const rect = canvas.getBoundingClientRect(); width = rect.width; height = rect.height; const ratio = Math.min(2, devicePixelRatio || 1); canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); context.setTransform(ratio, 0, 0, ratio, 0, 0); };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    const render = (time: number) => {
      if (disposed || document.hidden) return;
      const delta = last ? Math.min(0.05, (time - last) / 1000) : 0; last = time;
      context.clearRect(0, 0, width, height);
      for (const event of events.current) event.age += delta;
      events.current = events.current.filter(event => event.age < 5).slice(-24);
      for (const creature of creatureRef.current) {
        const state = swimmers.current.get(creature.id); const resource = images.current.get(creature.id); if (!state || !resource) continue;
        const event = [...events.current].reverse().find(item => !item.id || item.id === creature.id);
        if (!motion.matches) tickSwimmer(state, creature, delta, event);
        const depth = 0.75 + (state.seed % 4) * 0.1;
        const size = Math.min(width < 600 ? 142 : 190, width * 0.29) * depth * (creatureRef.current.length > 12 ? 0.74 : 1);
        const ratio = resource.image.naturalHeight / resource.image.naturalWidth;
        const drawWidth = ratio > 1.3 ? size * 0.72 : size; const drawHeight = Math.min(size * 1.4, drawWidth * ratio);
        context.save(); context.translate(state.x * width, state.y * height);
        if (state.direction !== (creature.facing === 'right' ? 1 : -1)) context.scale(-1, 1);
        context.globalAlpha = 0.85 + depth * 0.12;
        if (creature.swim === 'odd' && !motion.matches) context.rotate(Math.sin(state.phase) * 0.055);
        const strips = 12; const sourceWidth = resource.image.naturalWidth / strips;
        for (let strip = 0; strip < strips; strip++) {
          const tail = creature.facing === 'right' ? 1 - strip / strips : strip / strips;
          const offset = motion.matches ? 0 : Math.sin(state.phase * 2.4 + strip * 0.33) * tail * tail * drawHeight * 0.035;
          context.drawImage(resource.image, strip * sourceWidth, 0, sourceWidth, resource.image.naturalHeight, -drawWidth / 2 + strip * drawWidth / strips, -drawHeight / 2 + offset, drawWidth / strips + 0.6, drawHeight);
        }
        context.restore();
        if (state.reaction > 0.1 || (event?.id === creature.id)) {
          context.save(); context.fillStyle = '#225c59'; context.font = '600 13px sans-serif'; context.textAlign = 'center'; context.fillText(creature.name || 'わたしのこ', state.x * width, state.y * height + drawHeight / 2 + 22); context.restore();
        }
      }
      for (const event of events.current) {
        if (event.type === 'call') continue;
        context.save(); context.globalAlpha = Math.max(0, 1 - event.age / 5);
        for (let particle = 0; particle < (event.type === 'food' ? 5 : 4); particle++) {
          const horizontal = event.x * width + Math.sin(particle * 2.5) * 20;
          const vertical = event.y * height + (motion.matches ? 0 : event.type === 'food' ? event.age * 13 : -event.age * (22 + particle * 8));
          context.beginPath(); context.arc(horizontal, vertical + particle * 9, event.type === 'food' ? 3 : 5 + particle * 2, 0, Math.PI * 2);
          if (event.type === 'food') { context.fillStyle = '#bc813f'; context.fill(); } else { context.strokeStyle = '#fff'; context.lineWidth = 1.8; context.stroke(); context.fillStyle = '#ffffff20'; context.fill(); }
        }
        context.restore();
      }
      frame = requestAnimationFrame(render);
    };
    const visibility = () => { cancelAnimationFrame(frame); last = 0; if (!document.hidden) frame = requestAnimationFrame(render); };
    document.addEventListener('visibilitychange', visibility); frame = requestAnimationFrame(render);
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('visibilitychange', visibility); images.current.clear(); swimmers.current.clear(); events.current = []; };
  }, []);
  const interact = (horizontal: number, vertical: number) => {
    const event = { x: horizontal, y: vertical, type: mode };
    events.current.push({ ...event, age: 0 }); onInteraction?.(event);
    setAnnouncement(mode === 'bubble' ? 'ぷくぷく。あわが できたよ！' : 'おやつ、どうぞ！');
  };
  return <div className={`sea ${quiet ? 'sea-preview' : ''}`} data-loaded={loaded}>
    <div className="light-rays" /><div className="sand sand-back" /><div className="sea-plant plant-left" /><div className="sea-plant plant-right" /><div className="sand" />
    <canvas ref={canvasRef} aria-label="さわると あわや おやつが出るうみ" role="button" tabIndex={0} onPointerDown={event => { const rect = event.currentTarget.getBoundingClientRect(); interact((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); interact(0.5, 0.5); } }} />
    {!quiet && <><div className="sea-status"><span className="status-dot" />{creatures.length}ひきの うみ</div><div className="sea-hint" aria-live="polite">{announcement}</div><div className="sea-tools" aria-label="うみのあそび"><button className={mode === 'bubble' ? 'active' : ''} aria-pressed={mode === 'bubble'} onClick={() => { setMode('bubble'); setAnnouncement('すきなところを さわってね'); }}><span>◌</span> あわ</button><button className={mode === 'food' ? 'active' : ''} aria-pressed={mode === 'food'} onClick={() => { setMode('food'); setAnnouncement('おやつを あげるところを さわってね'); }}><span>✧</span> おやつ</button></div></>}
  </div>;
}
