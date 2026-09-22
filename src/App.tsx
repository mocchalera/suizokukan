import { useEffect, useMemo, useState } from 'react';
import { LIMITS, isId, type Creature, type LocalCreature } from '../shared/model';
import { Editor } from './components/Editor';
import { Collection } from './components/Collection';
import { Family, FamilyRoom } from './components/Family';
import { DEMOS, Sea } from './components/Sea';
import { deleteCreature, importCreatures, loadCreatures, saveCreature } from './lib/storage';
import { api, messageOf } from './lib/api';

function NavIcon({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name === 'sea' ? <path d="M2 10q3-5 6 0t6 0t8 0M2 17q3-5 6 0t6 0t8 0" /> : name === 'create' ? <><path d="M4 7h4l2-3h4l2 3h4v13H4z" /><circle cx="12" cy="13" r="3.5" /></> : name === 'book' ? <><path d="M3 4q5-1 9 2q4-3 9-2v15q-5-1-9 2q-4-3-9-2zM12 6v15" /></> : <><rect x="2" y="4" width="16" height="12" rx="2" /><path d="M10 16v4M6 20h8" /><rect x="17" y="11" width="5" height="10" rx="1" /></>}</svg>;
}
export function App() {
  const [path, setPath] = useState(location.pathname);
  const [creatures, setCreatures] = useState<LocalCreature[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [storageReady, setStorageReady] = useState(false); const [jev, setJev] = useState(false);
  const [editing, setEditing] = useState<LocalCreature>(); const [findId, setFindId] = useState('');
  const [birth, setBirth] = useState<LocalCreature>(); const [notice, setNotice] = useState('');
  const [demos, setDemos] = useState(true);
  useEffect(() => {
    let alive = true;
    void loadCreatures().then(result => { if (alive) { setCreatures(result); setStorageReady(true); } }).catch(failure => { if (alive) setError(messageOf(failure)); }).finally(() => { if (alive) setLoading(false); });
    void api<{ jev: string }>('/api/health').then(result => { if (alive) setJev(result.jev === 'available'); }).catch(() => {});
    const back = () => { setPath(location.pathname); setEditing(undefined); setBirth(undefined); };
    window.addEventListener('popstate', back);
    return () => { alive = false; window.removeEventListener('popstate', back); };
  }, []);
  useEffect(() => { if (!birth) return; const timer = setTimeout(() => setBirth(undefined), 3400); return () => clearTimeout(timer); }, [birth]);
  const navigate = (next: string) => { if (location.pathname !== next) history.pushState({}, '', next); setPath(next); setNotice(''); window.scrollTo({ top: 0 }); };
  const active = useMemo(() => [...creatures.filter(creature => creature.inSea), ...(demos ? DEMOS : [])].slice(0, LIMITS.sea), [creatures, demos]);
  const assertStorage = () => { if (!storageReady) throw new Error('ずかんを読みこめていません。データを保護するため、保存せずに待っています。'); };
  const assertSpace = (id: string) => { if (creatures.filter(creature => creature.inSea && creature.id !== id).length >= LIMITS.sea) throw new Error('うみは20ひきまで。ずかんで、だれかを「やすむ」にしてね。'); };
  const save = async (creature: LocalCreature, message: string) => {
    assertStorage(); assertSpace(creature.id); await saveCreature(creature);
    setCreatures(current => [...current.filter(item => item.id !== creature.id), creature]); setEditing(undefined); setFindId(creature.id); navigate('/'); setBirth(creature); setNotice(message);
  };
  const toggle = async (creature: LocalCreature) => {
    assertStorage(); if (!creature.inSea) assertSpace(creature.id);
    const next = { ...creature, inSea: !creature.inSea }; await saveCreature(next); setCreatures(current => current.map(item => item.id === creature.id ? next : item));
  };
  const find = async (creature: LocalCreature) => { if (!creature.inSea) await toggle(creature); setFindId(creature.id); navigate('/'); };
  const roomId = /^\/room\/([^/]+)\/?$/.exec(path)?.[1];
  const current = path === '/create' ? 'create' : path === '/collection' ? 'book' : path === '/family' || roomId ? 'family' : 'sea';
  const nav = [{ path: '/', name: 'sea', label: 'あそぶ' }, { path: '/create', name: 'create', label: 'つくる' }, { path: '/collection', name: 'book', label: 'ずかん' }, { path: '/family', name: 'family', label: 'みんなのうみ' }];
  return <><header className="site-header"><a className="brand" href="/" onClick={event => { event.preventDefault(); navigate('/'); }} aria-label="おえかきのうみ ホーム"><img src="/icon.svg" alt="" /><span>おえかきのうみ<small>YOUR DRAWING, A LITTLE LIFE.</small></span></a><span className="header-note">その線のまま、泳ぎだす。</span><details className="about"><summary aria-label="保護者の方へ">?</summary><div><h2>保護者の方へ</h2><p>元の絵を描き直さず、端末の中で切り抜いて動かします。採点も、お世話の義務もありません。</p><p>写真はこのブラウザだけに保存。家族と共有する時だけ、確認した切り抜きを6時間のうみへ送ります。</p><p>性格AI：{jev ? '任意の設定文のみ・送信への同意が必要' : '未接続（選ぶだけで全て遊べます）'}</p><p>ずかんのバックアップを時々保存してください。招待リンクは家族以外に公開しないでください。</p></div></details></header>
    {error && <div className="page notice error" role="alert">{error} 保存済みデータは消していません。おためしのうみは遊べます。</div>}
    {loading ? <main className="page empty-state" role="status">うみを ひらいているよ…</main> : path === '/create' ? <Editor key={editing?.id ?? 'new'} initial={editing} onSave={save} jev={jev} /> : path === '/collection' ? <Collection creatures={creatures} onDelete={async id => { assertStorage(); await deleteCreature(id); setCreatures(current => current.filter(item => item.id !== id)); }} onImport={async (items: Creature[]) => { assertStorage(); await importCreatures(items); setCreatures(await loadCreatures()); }} onToggle={toggle} onEdit={creature => { setEditing(creature); navigate('/create'); }} onFind={find} /> : path === '/family' ? <Family navigate={navigate} /> : roomId && isId(roomId) ? <FamilyRoom key={roomId} id={roomId} collection={creatures} navigate={navigate} /> : path === '/' ? <main className="home page"><section className="hero-heading"><div><span className="eyebrow"><span /> A SMALL SEA, AN ENDLESS IMAGINATION</span><h1>きみのえが、<br className="mobile-only" /><em>いきてる。</em></h1><p>紙にかいた ふしぎなこ。<br className="mobile-only" /> ここは、そのこが泳ぐうみ。</p></div><button className="primary hero-create" onClick={() => { setEditing(undefined); navigate('/create'); }}><NavIcon name="create" /><span>いきものを つくる<small>しゃしんを とる・えらぶ</small></span><span aria-hidden="true">↗</span></button></section>
      <div className="home-sea"><Sea creatures={active} findId={findId} />{birth && <div className="birth-welcome" role="status"><span>✧</span><h2>{birth.name || 'あたらしいこ'}、うみへ ようこそ。</h2><p>きみの線が、泳ぎはじめたよ。</p></div>}</div>
      <div className="below-sea"><span>ゆびで ぽん。あわを つくってみよう。</span><label className="check-label"><input type="checkbox" checked={demos} onChange={event => setDemos(event.target.checked)} />おためしのこ</label></div>
      {notice && <p className="notice" role="status">{notice}</p>}
      <section className="story-strip"><div><span className="story-number">01</span><div><h2>かいて、ぱしゃ。</h2><p>どんなかたちも、たからもの。</p></div></div><div><span className="story-number">02</span><div><h2>そのまま、すいすい。</h2><p>線も、色も、はみだしたところも。</p></div></div><button className="story-family" onClick={() => navigate('/family')}><NavIcon name="family" /><span>おおきなうみで<br /><strong>家族と あそぼう</strong></span><span>↗</span></button></section>
    </main> : <main className="page empty-state"><h1>ここには うみがないみたい。</h1><button className="primary" onClick={() => navigate('/')}>うみへ もどる</button></main>}
    <footer className="site-footer">ひとつとして、おなじ線のないうみ。<span>おえかきのうみ</span></footer>
    <nav className="dock" aria-label="メインメニュー">{nav.map(item => <a key={item.name} className={current === item.name ? 'active' : ''} href={item.path} aria-current={current === item.name ? 'page' : undefined} onClick={event => { event.preventDefault(); if (item.name === 'create' && path !== '/create') setEditing(undefined); navigate(item.path); }}><NavIcon name={item.name} /><span>{item.label}</span></a>)}</nav>
  </>;
}
