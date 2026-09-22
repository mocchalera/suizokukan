import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { PRESETS, MOODS, SWIMS, moodLabel, safeName, swimLabel, type LocalCreature, type Mood, type Personality, type Swim } from '../../shared/model';
import { brushPixels, type Pixels } from '../../shared/cutout';
import { canvasOf, contextOf, cutoutPng, decodePhoto, imageElement, samplePhoto } from '../lib/images';
import { api, messageOf } from '../lib/api';
import { Sea } from './Sea';

function Camera({ onPhoto, onClose, onError }: { onPhoto: (source: string) => void; onClose: () => void; onError: (error: string) => void }) {
  const video = useRef<HTMLVideoElement>(null); const stream = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false;
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) { onError('カメラを使えません。「しゃしんをえらぶ」か「おためし」を使ってね。'); onClose(); return; }
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false }).then(async result => {
      if (disposed) { result.getTracks().forEach(track => track.stop()); return; }
      stream.current = result;
      if (video.current) { video.current.srcObject = result; await video.current.play(); if (!disposed) setReady(true); }
    }).catch(() => { if (!disposed) { onError('カメラの許可がないか、ほかで使われています。写真選択・おためしでも遊べます。'); onClose(); } });
    return () => { disposed = true; stream.current?.getTracks().forEach(track => track.stop()); if (video.current) video.current.srcObject = null; };
  }, []);
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="camera-title"><h2 id="camera-title">えを うつそう</h2><p>あかるいところで、紙をまっすぐ。1まいに1ひきがおすすめ。</p><video ref={video} muted playsInline aria-label="カメラの映像" /><div className="button-row"><button className="primary" disabled={!ready} onClick={() => {
    const current = video.current; if (!current?.videoWidth) return;
    const ratio = Math.min(1, 1200 / Math.max(current.videoWidth, current.videoHeight));
    const canvas = canvasOf(Math.round(current.videoWidth * ratio), Math.round(current.videoHeight * ratio));
    contextOf(canvas).drawImage(current, 0, 0, canvas.width, canvas.height); onPhoto(canvas.toDataURL('image/jpeg', 0.88)); onClose();
  }}>このしゃしんにする</button><button onClick={onClose}>とじる</button></div></section></div>;
}
function DrawPad({ onPhoto, onClose }: { onPhoto: (source: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null); const [color, setColor] = useState('#d98775'); const drawing = useRef(false);
  const clear = () => { if (ref.current) { const context = contextOf(ref.current); context.fillStyle = '#fff'; context.fillRect(0, 0, 900, 680); } };
  useEffect(clear, []);
  const draw = (event: PointerEvent<HTMLCanvasElement>, start: boolean) => {
    const canvas = event.currentTarget; const context = contextOf(canvas); const rect = canvas.getBoundingClientRect();
    const horizontal = (event.clientX - rect.left) / rect.width * canvas.width; const vertical = (event.clientY - rect.top) / rect.height * canvas.height;
    context.strokeStyle = color; context.lineWidth = 14; context.lineCap = 'round'; context.lineJoin = 'round';
    if (start) { context.beginPath(); context.moveTo(horizontal, vertical); context.lineTo(horizontal + 0.1, vertical); } else context.lineTo(horizontal, vertical);
    context.stroke();
  };
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="draw-title"><h2 id="draw-title">ここに かいてもいいよ</h2><div className="swatches">{['#d98775', '#e8ba58', '#78a599', '#a193bf', '#355f61'].map(value => <button key={value} style={{ background: value }} aria-label={`いろ ${value}`} aria-pressed={color === value} onClick={() => setColor(value)} />)}</div><canvas ref={ref} width={900} height={680} className="draw-pad" aria-label="おえかきキャンバス" onPointerDown={event => { drawing.current = true; event.currentTarget.setPointerCapture(event.pointerId); draw(event, true); }} onPointerMove={event => { if (drawing.current) draw(event, false); }} onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} /><div className="button-row"><button className="primary" onClick={() => { if (ref.current) { onPhoto(ref.current.toDataURL('image/jpeg', 0.9)); onClose(); } }}>このえにする</button><button onClick={clear}>ぜんぶ けす</button><button onClick={onClose}>とじる</button></div></section></div>;
}
type Crop = [number, number, number, number];
export function Editor({ initial, onSave, jev }: { initial?: LocalCreature; onSave: (creature: LocalCreature, notice: string) => Promise<void>; jev: boolean }) {
  const [source, setSource] = useState(initial?.source ?? ''); const [stage, setStage] = useState<'input' | 'crop' | 'cut' | 'name'>(initial?.source ? 'crop' : 'input');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [camera, setCamera] = useState(false); const [draw, setDraw] = useState(false);
  const [crop, setCrop] = useState<Crop>([0, 0, 1, 1]); const cropRef = useRef<HTMLDivElement>(null);
  const [threshold, setThreshold] = useState(40); const [paper, setPaper] = useState(false); const [brush, setBrush] = useState<'keep' | 'erase'>('erase');
  const [radius, setRadius] = useState(15); const [historyCount, setHistoryCount] = useState(0); const history = useRef<Uint8ClampedArray[]>([]);
  const original = useRef<Pixels | null>(null); const working = useRef<Pixels | null>(null); const canvas = useRef<HTMLCanvasElement>(null); const painting = useRef(false);
  const worker = useRef<Worker | null>(null); const requestId = useRef(0); const alive = useRef(true); const releaseAbort = useRef<AbortController | null>(null);
  const [image, setImage] = useState(initial?.image ?? ''); const [name, setName] = useState(initial?.name ?? ''); const [swim, setSwim] = useState<Swim>(initial?.swim ?? 'swim');
  const [mood, setMood] = useState<Mood>(initial?.personality.mood ?? 'curious'); const [facing, setFacing] = useState<'left' | 'right'>(initial?.facing ?? 'right');
  const [note, setNote] = useState(''); const [consent, setConsent] = useState(false);
  const creatureId = useRef(initial?.id ?? crypto.randomUUID());
  const refresh = () => {
    if (!canvas.current || !working.current) return;
    canvas.current.width = working.current.width; canvas.current.height = working.current.height;
    contextOf(canvas.current).putImageData(new ImageData(new Uint8ClampedArray(working.current.data), working.current.width, working.current.height), 0, 0);
    try { setImage(cutoutPng(canvas.current)); setError(''); } catch (failure) { setImage(''); setError(messageOf(failure)); }
  };
  useEffect(() => {
    alive.current = true;
    const instance = new Worker(new URL('../lib/pixels.worker.ts', import.meta.url), { type: 'module' }); worker.current = instance;
    instance.onmessage = event => {
      const result = event.data as { id: number; width: number; height: number; buffer: ArrayBuffer; error?: string };
      if (result.id !== requestId.current) return;
      setBusy(false);
      if (result.error) { setError(result.error); setImage(''); return; }
      working.current = { width: result.width, height: result.height, data: new Uint8ClampedArray(result.buffer) };
      history.current = []; setHistoryCount(0); refresh();
    };
    instance.onerror = () => { setBusy(false); setError('切り抜きの準備に失敗しました。ページを開き直してください。'); };
    return () => { alive.current = false; instance.terminate(); releaseAbort.current?.abort(); original.current = null; working.current = null; history.current = []; };
  }, []);
  const process = (value = threshold, keepPaper = paper) => {
    if (!original.current || !worker.current) return;
    setBusy(true); setError(''); const copy = original.current.data.slice();
    worker.current.postMessage({ id: ++requestId.current, width: original.current.width, height: original.current.height, buffer: copy.buffer, threshold: value, paperMode: keepPaper }, [copy.buffer]);
  };
  const accept = (photo: string) => { setSource(photo); setStage('crop'); setCrop([0, 0, 1, 1]); setError(''); };
  const fileInput = async (file?: File) => { if (!file) return; setBusy(true); setError(''); try { const result = await decodePhoto(file); if (alive.current) accept(result); } catch (failure) { setError(messageOf(failure)); } finally { if (alive.current) setBusy(false); } };
  const confirmCrop = async () => {
    setBusy(true); setError('');
    try {
      const decoded = await imageElement(source); if (!alive.current) return;
      const width = Math.max(24, Math.round((crop[2] - crop[0]) * decoded.width)); const height = Math.max(24, Math.round((crop[3] - crop[1]) * decoded.height));
      const output = canvasOf(width, height); contextOf(output).drawImage(decoded, crop[0] * decoded.width, crop[1] * decoded.height, width, height, 0, 0, width, height);
      original.current = { width, height, data: contextOf(output).getImageData(0, 0, width, height).data };
      setStage('cut'); setTimeout(() => { if (alive.current) process(); }, 0);
    } catch (failure) { setBusy(false); setError(messageOf(failure)); }
  };
  const paint = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!painting.current || !working.current || !original.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    brushPixels(working.current, original.current, (event.clientX - rect.left) / rect.width * working.current.width, (event.clientY - rect.top) / rect.height * working.current.height, radius / rect.width * working.current.width, brush === 'keep');
    contextOf(event.currentTarget).putImageData(new ImageData(new Uint8ClampedArray(working.current.data), working.current.width, working.current.height), 0, 0);
  };
  const release = async () => {
    setBusy(true); setError('');
    try {
      const cleanName = safeName(name); let selected: Personality = PRESETS[mood]; let notice = 'えらんだ せいかくで うまれたよ。';
      if (note.trim() && consent && jev) {
        const controller = new AbortController(); releaseAbort.current = controller;
        const timer = window.setTimeout(() => controller.abort(), 4500);
        try { const result = await api<{ personality: Personality; notice: string }>('/api/personality', { method: 'POST', body: JSON.stringify({ note, fallback: selected }), signal: controller.signal }); selected = result.personality; notice = result.notice; }
        catch { notice = 'AIを使えなかったため、選んだせいかくで泳ぎます。'; }
        finally { clearTimeout(timer); }
      } else if (note.trim()) notice = 'AIは未接続です。選んだせいかくで泳ぎます。';
      if (!alive.current) return;
      await onSave({ id: creatureId.current, name: cleanName, image, source, swim, personality: selected, facing, inSea: true, createdAt: initial?.createdAt ?? Date.now() }, notice);
    } catch (failure) { if (alive.current) setError(messageOf(failure)); }
    finally { if (alive.current) setBusy(false); }
  };
  const preview: LocalCreature = { id: creatureId.current, name, image, swim, personality: PRESETS[mood], facing, inSea: true, createdAt: 0 };
  return <main className="page editor-page"><div className="page-heading"><span className="eyebrow">A LITTLE DRAWING, A BIG ADVENTURE</span><h1>きみのえに、いのちを。</h1><p>そのままの線。そのままのいろ。<br className="mobile-only" />どんなこが うまれるかな。</p></div>
    <ol className="steps" aria-label="つくる順番"><li className={['input', 'crop'].includes(stage) ? 'current' : ''}><span>1</span>えを えらぶ</li><li className={stage === 'cut' ? 'current' : ''}><span>2</span>きりぬく</li><li className={stage === 'name' ? 'current' : ''}><span>3</span>うみに はなす</li></ol>
    {error && <p className="notice error" role="alert">{error}</p>}
    {stage === 'input' && <section className="input-layout"><div className="capture-card"><div className="paper-illustration"><img src="/art/fish-coral.svg" alt="白い紙に描いた、さんごいろの魚" /><span className="paper-spark">✧</span></div><h2>かいたこを、つれてこよう</h2><p>白い紙に1ひき。<br />ふとい線も、ぬりのこしも、たからもの。</p><div className="button-row"><button className="primary" onClick={() => setCamera(true)}>◎ カメラで とる</button><label className="button file-button">▧ しゃしんを えらぶ<input aria-label="しゃしんをえらぶ" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => void fileInput(event.target.files?.[0])} /></label></div><label className="text-button file-button">スマホのカメラアプリで とる<input aria-label="スマホのカメラアプリでとる" type="file" capture="environment" accept="image/jpeg,image/png,image/webp" onChange={event => void fileInput(event.target.files?.[0])} /></label><small>写真は端末内だけで処理します。JPEG・PNG・WebP / 15MBまで。HEICはJPEGに変換してください。</small></div><aside className="try-card"><span className="eyebrow">まだ、えがなくても。</span><h2>まずは おためし</h2><img src="/art/jelly-lilac.svg" alt="おためしのクラゲ" /><button disabled={busy} onClick={async () => { setBusy(true); try { accept(await samplePhoto()); } catch (failure) { setError(messageOf(failure)); } finally { setBusy(false); } }}>おためしの しゃしん →</button><button className="text-button" onClick={() => setDraw(true)}>ここで かいてみる ✎</button></aside></section>}
    {stage === 'crop' && <section className="work-card"><div><h2>えの まわりを かこもう</h2><p>四すみの丸をうごかして、ほかの物を入れないように。紙がななめなら、まっすぐ撮りなおしてね。</p></div><div className="crop-view" ref={cropRef}><img src={source} alt="取り込んだ元の写真" /><div className="crop-box" style={{ left: `${crop[0] * 100}%`, top: `${crop[1] * 100}%`, width: `${(crop[2] - crop[0]) * 100}%`, height: `${(crop[3] - crop[1]) * 100}%` }}>{['左上', '右上', '右下', '左下'].map((label, index) => <button key={label} aria-label={`${label}の切り抜き位置`} className={`crop-handle corner-${index}`} onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const rect = cropRef.current!.getBoundingClientRect(); const horizontal = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)); const vertical = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)); setCrop(current => { const next = [...current] as Crop; const left = index === 0 || index === 3; const top = index < 2; next[left ? 0 : 2] = left ? Math.min(horizontal, current[2] - 0.08) : Math.max(horizontal, current[0] + 0.08); next[top ? 1 : 3] = top ? Math.min(vertical, current[3] - 0.08) : Math.max(vertical, current[1] + 0.08); return next; }); }} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); setCrop(current => { const next = [...current] as Crop; const target = event.key.includes('Left') || event.key.includes('Right') ? index === 0 || index === 3 ? 0 : 2 : index < 2 ? 1 : 3; next[target] = Math.max(0, Math.min(1, next[target] + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -0.02 : 0.02))); return next[2] - next[0] >= 0.08 && next[3] - next[1] >= 0.08 ? next : current; }); } }} />)}</div></div><div className="button-row"><button className="primary" disabled={busy} onClick={() => void confirmCrop()}>このはんいで きりぬく →</button><button onClick={() => setCrop([0, 0, 1, 1])}>はんいを もどす</button><button onClick={() => setStage('input')}>えを えらびなおす</button></div></section>}
    {stage === 'cut' && <section className="cut-layout"><div className="work-card"><h2>しろい紙を そっと はずす</h2><p>目のしろ・囲まれたしろは残します。はみ出しはブラシでなおせるよ。</p><div className="checker"><canvas ref={canvas} className="cut-canvas" aria-label="切り抜き画像。ブラシで修正できます" onPointerDown={event => { if (busy || !working.current) return; history.current = [...history.current.slice(-3), working.current.data.slice()]; setHistoryCount(history.current.length); painting.current = true; event.currentTarget.setPointerCapture(event.pointerId); paint(event); }} onPointerMove={paint} onPointerUp={() => { painting.current = false; refresh(); }} onPointerCancel={() => { painting.current = false; refresh(); }} /></div><label className="range-label">紙をはずす つよさ <output>{threshold}</output><input aria-label="紙をはずすつよさ" type="range" min="5" max="110" value={threshold} disabled={busy || paper} onChange={event => { const value = Number(event.target.value); setThreshold(value); process(value); }} /></label><small>つよさ・紙モードを変えるとブラシ修正はリセットされます。</small><div className="button-row"><button aria-pressed={brush === 'erase'} onClick={() => setBrush('erase')}>けす ブラシ</button><button aria-pressed={brush === 'keep'} onClick={() => setBrush('keep')}>のこす ブラシ</button><button disabled={!historyCount || busy} onClick={() => { const pixels = history.current.pop(); if (pixels && working.current) { working.current.data = pixels; setHistoryCount(history.current.length); refresh(); } }}>ひとつ もどす</button><button disabled={busy} onClick={() => process()}>修正を リセット</button></div><label className="range-label">ブラシの おおきさ<input type="range" aria-label="ブラシのおおきさ" min="5" max="45" value={radius} onChange={event => setRadius(Number(event.target.value))} /></label><label className="check-label"><input type="checkbox" checked={paper} disabled={busy} onChange={event => { setPaper(event.target.checked); process(threshold, event.target.checked); }} />紙をのこす（うまく抜けないとき）</label><div className="button-row"><button className="primary" disabled={!image || busy} onClick={() => setStage('name')}>このこで つづける →</button><button onClick={() => { requestId.current++; setBusy(false); setStage('crop'); }}>はんいを なおす</button></div></div><aside className="preview-card"><span className="eyebrow">もう、うごきたそう。</span><h3>うみでの すがた</h3>{image && <Sea creatures={[preview]} quiet />}<p>線も、いろも、かきなおしていません。</p></aside></section>}
    {stage === 'name' && <section className="birth-layout"><div className="preview-card"><span className="eyebrow">NICE TO MEET YOU</span><h2>はじめまして、{name || 'あたらしいこ'}。</h2><Sea creatures={[preview]} quiet /><button onClick={() => setFacing(current => current === 'right' ? 'left' : 'right')}>↔ あたまの むきを はんたいに</button><small>いまの原画：あたまは{facing === 'right' ? '右' : '左'}。泳ぐ向きにあわせて反転します。</small></div><div className="work-card birth-form"><label>なまえ（なくても だいじょうぶ）<input aria-label="なまえ" type="text" maxLength={24} value={name} placeholder="どんな なまえにする？" onChange={event => setName(event.target.value)} /></label><fieldset><legend>およぎかた</legend><div className="choice-grid">{SWIMS.map(value => <button key={value} aria-pressed={swim === value} onClick={() => setSwim(value)}><span>{value === 'swim' ? '〰' : value === 'float' ? '◌' : '✧'}</span>{swimLabel[value]}</button>)}</div></fieldset><fieldset><legend>どんな せいかく？</legend><div className="choice-grid">{MOODS.map((value, index) => <button key={value} aria-pressed={mood === value} onClick={() => setMood(value)}><img src={`/art/${['fish-sun', 'jelly-lilac', 'odd-mint'][index]}.svg`} alt="" />{moodLabel[value]}</button>)}</div></fieldset><details className="parent-note"><summary>おとなの方へ · ことばでせいかくをつける</summary><p>{jev ? 'Jevに設定文だけを送り、泳ぐ速さ・距離・泡への反応へ変換します。' : 'AIは未接続です。絵付きのせいかく選択だけで、すべて遊べます。'}</p><p>画像・元写真は送りません。子どもの名前、年齢、連絡先などの個人情報を書かないでください。</p><textarea aria-label="せいかくの設定文" maxLength={160} value={note} onChange={event => setNote(event.target.value)} placeholder="こわがりだけど、あわが好き" /><label className="check-label"><input type="checkbox" checked={consent} disabled={!jev} onChange={event => setConsent(event.target.checked)} />誕生時にこの設定文だけをJevへ送る（任意）</label><small>最大160文字・誕生操作ごと1回。応答がないときは選んだせいかくを使います。</small></details><button className="primary release-button" disabled={busy || !image} onClick={() => void release()}>{busy ? 'じゅんびしているよ…' : '✧ うみに はなす'}</button><button className="text-button" disabled={busy} onClick={() => { setStage('cut'); setTimeout(refresh, 0); }}>きりぬきを なおす</button><small>この端末のずかんに保存します。共有はあとで、確認してから。</small></div></section>}
    {busy && stage !== 'name' && <p className="notice" role="status">えを じゅんびしているよ…</p>}
    {camera && <Camera onPhoto={accept} onClose={() => setCamera(false)} onError={setError} />}
    {draw && <DrawPad onPhoto={accept} onClose={() => setDraw(false)} />}
  </main>;
}
