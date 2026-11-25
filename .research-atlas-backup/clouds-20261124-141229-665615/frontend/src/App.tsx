import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight, ArrowUpRight, Atom, BookOpen, Check, ChevronDown, CircleHelp,
  Compass, ExternalLink, Filter, GitBranch, LoaderCircle, Maximize2,
  Network, RotateCcw, Search, SlidersHorizontal, Sparkles, X, FileDown, FileUp, KeyRound,
} from 'lucide-react';
import MapScene, { CLUSTER_COLORS } from './MapScene';
import type { PaperLabelMode } from './lib/region-labels';
import { createMap, exportMap, importMap, loadMap, reweightMap } from './api';
import type { MapData, Weights } from './types';

const DEFAULT_WEIGHTS: Weights = { abstract: 0.65, authors: 0.15, citations: 0.20 };
const SUGGESTIONS = ['Interpreting Adversarial Examples', 'Explainable Artificial Intelligence', 'Evolutionary Optimization'];
const shortTitle = (s: string, n = 58) => s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
const fmt = (n: number) => new Intl.NumberFormat('ja-JP').format(n);

function WeightControl({ label, description, value, onChange, disabled = false, color }: {
  label: string; description: string; value: number; onChange: (value: number) => void; disabled?: boolean; color: string;
}) {
  return <div className={`weight-row ${disabled ? 'weight-disabled' : ''}`}>
    <div className="weight-header"><span className="weight-label"><span className="weight-dot" style={{ background: color }} />{label}</span><strong>{Math.round(value * 100)}%</strong></div>
    <input className="range" aria-label={label} type="range" min="0" max="1" step="0.05" value={value}
      onChange={e => onChange(Number(e.target.value))} style={{ '--slider-color': color } as React.CSSProperties} />
    <div className="subtle small">{description}{disabled ? ' · 現在の論文集合に接続なし' : ''}</div>
  </div>;
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (s: string) => void; placeholder: string }) {
  return <label className="small-field"><span>{label}</span><input type="number" min="1850" max="2100" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></label>;
}

export default function App() {
  const [query, setQuery] = useState(SUGGESTIONS[0]);
  const [limit, setLimit] = useState(60);
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [weights, setWeights] = useState<Weights>({ ...DEFAULT_WEIGHTS });
  const [apiKey, setApiKey] = useState(''); // memory-only: never persist the key
  const [progress, setProgress] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [map, setMap] = useState<MapData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reweighting, setReweighting] = useState(false);
  const [error, setError] = useState('');
  const [showCitations, setShowCitations] = useState(true);
  const [showSimilarities, setShowSimilarities] = useState(true);
  const [paperLabels, setPaperLabels] = useState<PaperLabelMode>('key');
  const [showRegionLabels, setShowRegionLabels] = useState(true);
  const [visibleCluster, setVisibleCluster] = useState<number | null>(null);
  const [paperFilter, setPaperFilter] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'relevance' | 'citations' | 'year'>('relevance');

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('map');
    if (!id) return;
    let alive = true;
    setLoading(true);
    loadMap(id).then(result => {
      if (!alive) return;
      setMap(result); setQuery(result.query); setLimit(result.requested_limit);
      setYearFrom(result.year_from?.toString() ?? ''); setYearTo(result.year_to?.toString() ?? '');
      setWeights(result.weights);
    }).catch(err => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const selected = map?.points.find(p => p.id === selectedId) ?? null;
  const clusters = useMemo(() => map ? [...new Set(map.points.map(p => p.cluster))].sort() : [], [map]);
  const filteredPapers = useMemo(() => {
    if (!map) return [];
    const filter = paperFilter.trim().toLowerCase();
    const records = map.points.filter(p =>
      (visibleCluster === null || p.cluster === visibleCluster) &&
      (!filter || `${p.paper.title} ${p.paper.authors.map(a => a.name).join(' ')}`.toLowerCase().includes(filter))
    );
    if (sortBy === 'citations') return records.sort((a, b) => b.paper.cited_by_count - a.paper.cited_by_count);
    if (sortBy === 'year') return records.sort((a, b) => (b.paper.year ?? 0) - (a.paper.year ?? 0));
    return records;
  }, [map, paperFilter, visibleCluster, sortBy]);

  const choose = (id: string) => { setSelectedId(id); setDetailOpen(true); };
  const search = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    if (!query.trim() || query.trim().length < 3) { setError('検索テーマは3文字以上で入力してください。'); return; }
    if (yearFrom && yearTo && Number(yearFrom) > Number(yearTo)) { setError('開始年は終了年以前に設定してください。'); return; }
    if (Object.values(weights).every(v => v === 0)) { setError('少なくとも1つの類似度の重みを設定してください。'); return; }
    setLoading(true);
    try {
      const result = await createMap({ query: query.trim(), limit, year_from: yearFrom ? Number(yearFrom) : null,
        year_to: yearTo ? Number(yearTo) : null, weights }, { apiKey, onProgress: setProgress });
      setMap(result); setSelectedId(null); setDetailOpen(false);
      setVisibleCluster(null); setPaperFilter(''); setSidebarOpen(false);
      window.history.replaceState({}, '', `?map=${encodeURIComponent(result.id)}`);
    } catch (err) { setError(err instanceof Error ? err.message : '検索に失敗しました'); }
    finally { setLoading(false); setProgress(''); }
  };
  const reweight = async () => {
    if (!map) return;
    if (Object.values(weights).every(v => v === 0)) { setError('少なくとも1つの類似度の重みを設定してください。'); return; }
    setError(''); setReweighting(true);
    try { const result = await reweightMap(map.id, weights); setMap(result); }
    catch (err) { setError(err instanceof Error ? err.message : '再計算に失敗しました'); }
    finally { setReweighting(false); }
  };
  const downloadJson = async () => {
    if (!map) return;
    try {
      const blob = await exportMap(map.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `research-map-${map.id}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (err) { setError(err instanceof Error ? err.message : '書き出しに失敗しました'); }
  };
  const importJson = async (file: File | undefined) => {
    if (!file) return;
    setError(''); setLoading(true); setProgress('JSONからローカルマップを復元中');
    try {
      const result = await importMap(file);
      setMap(result); setQuery(result.query); setLimit(result.requested_limit); setWeights(result.weights);
      setYearFrom(result.year_from?.toString() ?? ''); setYearTo(result.year_to?.toString() ?? '');
      setSelectedId(null); setDetailOpen(false); setVisibleCluster(null); setSidebarOpen(false);
      window.history.replaceState({}, '', `?map=${encodeURIComponent(result.id)}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'JSON読込に失敗しました'); }
    finally { setLoading(false); setProgress(''); }
  };
  const weightChanged = map && Object.keys(weights).some(k => weights[k as keyof Weights] !== map.weights[k as keyof Weights]);
  const canReweight = Boolean(map && weightChanged && !loading && !reweighting);
  const activePaperIds = new Set(map?.points.map(p => p.id) ?? []);
  const inboundCitations = selected && map ? map.edges.filter(e => e.kind === 'citation' && e.target === selected.id && activePaperIds.has(e.source)) : [];
  const outboundCitations = selected && map ? map.edges.filter(e => e.kind === 'citation' && e.source === selected.id && activePaperIds.has(e.target)) : [];
  const foundName = (id: string) => map?.points.find(p => p.id === id)?.paper.title ?? id;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-icon"><Atom size={22} strokeWidth={1.9} /></div><span>RESEARCH <b>map</b></span><span className="beta">BETA</span></div>
      <div className="topbar-middle"><span className="pulse" /> Browser-first · Direct OpenAlex</div>
      <a className="topbar-link" href="https://docs.openalex.org/" target="_blank" rel="noreferrer">Powered by OpenAlex <ExternalLink size={13}/></a>
    </header>
    <div className="workspace">
      <aside className={`left-sidebar ${sidebarOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-scroll">
          <div className="panel-head"><div><div className="eyebrow">DISCOVERY ENGINE</div><h2>Explore a field</h2></div><button className="icon-btn mobile-only" onClick={() => setSidebarOpen(false)} aria-label="検索パネルを閉じる"><X size={19}/></button></div>
          <form onSubmit={search}>
            <label className="field-label" htmlFor="topic">Research topic</label>
            <div className="search-area"><Search size={17}/><textarea id="topic" rows={2} value={query} maxLength={200} onChange={e => setQuery(e.target.value)} placeholder="Explore a research area..." /></div>
            <div className="suggestion-caption">SUGGESTED TOPICS</div>
            <div className="suggestions">{SUGGESTIONS.map(t => <button key={t} type="button" className={query === t ? 'topic-chip selected' : 'topic-chip'} onClick={() => setQuery(t)}>{t}</button>)}</div>
            <div className="sidebar-divider"/>
            <div className="section-heading"><Filter size={15}/><span>Search parameters</span></div>
            <div className="field-row"><Field label="From year" value={yearFrom} onChange={setYearFrom} placeholder="Any" /><Field label="To year" value={yearTo} onChange={setYearTo} placeholder="Any" /></div>
            <label className="field-label space-above" htmlFor="limit">Number of papers</label>
            <div className="select-wrap"><select id="limit" value={limit} onChange={e => setLimit(Number(e.target.value))}><option value={20}>20 papers · quick</option><option value={40}>40 papers</option><option value={60}>60 papers · balanced</option><option value={100}>100 papers · detailed</option><option value={120}>120 papers · maximum</option></select><ChevronDown size={15}/></div>
            <details className="api-key-section"><summary><KeyRound size={14}/> OpenAlex API key (optional)</summary>
              <label htmlFor="openalex-key" className="field-label">Your personal API key</label>
              <input id="openalex-key" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                autoComplete="off" spellCheck={false} placeholder="Paste your key (not saved)" />
              <p className="subtle small">このキーはブラウザ内だけで保持し、OpenAlexに直接送信します。コードやDBには保存しません。
                <a href="https://openalex.org/" target="_blank" rel="noreferrer"> OpenAlex</a>で取得できます。</p>
            </details>
            <div className="sidebar-divider"/>
            <div className="section-heading"><SlidersHorizontal size={15}/><span>Similarity dimensions</span></div>
            <p className="section-copy">重みを変更して、研究領域を別の角度から見てみましょう。</p>
            <WeightControl label="Abstract + Title" description="テキストの類似度" color="#ac91ff" value={weights.abstract} onChange={v => setWeights(w => ({...w, abstract: v}))} disabled={map?.metrics.available_signals.abstract === false} />
            <WeightControl label="Authors" description="共著者の重なり" color="#5de0c7" value={weights.authors} onChange={v => setWeights(w => ({...w, authors: v}))} disabled={map?.metrics.available_signals.authors === false} />
            <WeightControl label="Citation network" description="共通参考文献と直接引用" color="#f7af6e" value={weights.citations} onChange={v => setWeights(w => ({...w, citations: v}))} disabled={map?.metrics.available_signals.citations === false} />
            <button className="primary-btn" type="submit" disabled={loading || reweighting}>
              {loading ? <LoaderCircle className="spin" size={17}/> : <Compass size={18}/>} {loading ? 'マップを生成中...' : 'Generate 3D Map'} <ArrowUpRight size={16}/>
            </button>
            {map && <button type="button" className="secondary-btn" disabled={!canReweight} onClick={reweight}>
              {reweighting ? <LoaderCircle className="spin" size={15}/> : <RotateCcw size={15}/>} {reweighting ? '再計算中...' : 'Recalculate weights'}
              {canReweight && <span className="modified-dot"/>}
            </button>}
          </form>
          {loading && progress && <div className="progress-note" role="status">{progress}</div>}
          <div className="local-actions">
            <button className="secondary-btn" type="button" disabled={loading || reweighting} onClick={() => fileInput.current?.click()}><FileUp size={15}/> Import map JSON</button>
            {map && <button className="secondary-btn" type="button" onClick={downloadJson}><FileDown size={15}/> Export map JSON</button>}
            <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="JSONマップを読み込む" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void importJson(file); }} />
          </div>
          {error && <div className="error-box" role="alert">{error}</div>}
          <div className="sidebar-footer"><CircleHelp size={15} /> 無料モードはブラウザ内でTF-IDFを計算。データ保存はこのブラウザのIndexedDBのみです。</div>
        </div>
      </aside>
      <main className="main-panel">
        <div className="main-topline"><div><div className="eyebrow">KNOWLEDGE LANDSCAPE <span className="slash">/</span> 3D ANALYSIS</div><h1>{map ? shortTitle(map.query, 78) : 'See the connections.'}</h1><p>{map ? 'Abstract · Authors · Citations を統合した研究領域マップ' : 'Discover how research ideas connect, evolve and diverge.'}</p></div>
          <div className="main-top-actions"><span className="status-pill"><span className="pulse" /> {map ? 'MAP READY' : 'READY TO EXPLORE'}</span><button className="icon-btn mobile-only" aria-label="検索条件を表示" onClick={() => setSidebarOpen(true)}><SlidersHorizontal size={20}/></button></div></div>
        {map ? <>
          <div className="stats-bar">
            <div className="stat"><BookOpen size={17}/><div><strong>{fmt(map.metrics.papers)}</strong><span>PAPERS</span></div></div>
            <div className="stat"><GitBranch size={17}/><div><strong>{fmt(map.metrics.citation_links)}</strong><span>CITATION LINKS</span></div></div>
            <div className="stat"><Network size={17}/><div><strong>{fmt(map.metrics.similarity_links)}</strong><span>SIMILARITY LINKS</span></div></div>
            <div className="stat"><Sparkles size={17}/><div><strong>{fmt(map.metrics.unique_authors)}</strong><span>AUTHORS</span></div></div>
            <div className="stat-note"><Check size={13}/>{map.cached ? 'Local cache' : 'Direct OpenAlex'}</div>
          </div>
          <div className="visual-body">
            <div className="map-area">
              <div className="map-toolbar"><div className="map-marker"><span className="marker-glow" /> INTERACTIVE 3D SPACE</div><div className="map-toolbar-actions"><span><Maximize2 size={13}/> Drag to rotate · Scroll to zoom</span></div></div>
              <MapScene data={map} selectedId={selectedId} onSelect={choose} showCitations={showCitations} showSimilarities={showSimilarities} paperLabels={paperLabels} showRegionLabels={showRegionLabels} visibleCluster={visibleCluster}/>
              <div className="map-overlay-bottom"><div className="map-legend-title">CLUSTERS <span>click to filter</span></div><div className="cluster-legend"><button className={visibleCluster === null ? 'cluster-option on' : 'cluster-option'} onClick={() => setVisibleCluster(null)}>All</button>{clusters.map((cluster, i) => <button key={cluster} className={visibleCluster === cluster ? 'cluster-option on' : 'cluster-option'} onClick={() => setVisibleCluster(v => v === cluster ? null : cluster)}><span className="cluster-dot" style={{ background: CLUSTER_COLORS[cluster % CLUSTER_COLORS.length] }}/>{`Group ${i + 1}`}</button>)}</div></div>
              <div className="map-layers"><div className="layers-heading">LAYERS</div><label><input type="checkbox" checked={showCitations} onChange={e => setShowCitations(e.target.checked)} /><span className="layer-line citation"/> Citation links</label><label><input type="checkbox" checked={showSimilarities} onChange={e => setShowSimilarities(e.target.checked)}/><span className="layer-line similarity"/> Similarity links</label><div className="layer-separator"/><label><input type="checkbox" checked={showRegionLabels} onChange={e => setShowRegionLabels(e.target.checked)}/> Region keywords</label><label className="layer-label-select">Paper labels<select aria-label="論文ラベルの表示" value={paperLabels} onChange={e => setPaperLabels(e.target.value as PaperLabelMode)}><option value="off">Off</option><option value="key">Key papers</option><option value="all">All papers</option></select></label></div>
            </div>
            <div className="paper-panel">
              <div className="paper-panel-head"><div className="eyebrow">DOCUMENT EXPLORER</div><h3>Paper library <span>{filteredPapers.length}</span></h3></div>
              <div className="filter-input"><Search size={15}/><input value={paperFilter} onChange={e => setPaperFilter(e.target.value)} placeholder="Filter by title or author..." aria-label="論文を絞り込む"/></div>
              <div className="sort-row"><span>Results</span><div><select aria-label="並び替え" value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}><option value="relevance">Relevance</option><option value="citations">Most cited</option><option value="year">Newest</option></select><ChevronDown size={12}/></div></div>
              <div className="paper-list">{filteredPapers.map((point, index) => <button key={point.id} className={selectedId === point.id ? 'paper-item active' : 'paper-item'} onClick={() => choose(point.id)}><div className="paper-item-head"><span className="paper-index">{String(index + 1).padStart(2, '0')}</span><span className="paper-cluster-dot" style={{background: CLUSTER_COLORS[point.cluster % CLUSTER_COLORS.length]}}/><span className="paper-year">{point.paper.year ?? '—'}</span></div><h4>{point.paper.title}</h4><p>{point.paper.authors.slice(0, 3).map(a => a.name).join(', ')}{point.paper.authors.length > 3 ? ' et al.' : ''}</p><div className="paper-item-foot"><span><GitBranch size={12}/> {fmt(point.paper.cited_by_count)} citations</span><ArrowUpRight size={14}/></div></button>)}{filteredPapers.length === 0 && <div className="empty-filter">該当する論文がありません。</div>}</div>
            </div>
          </div>
          <div className="bottom-bar"><span>TEXT: TF-IDF COSINE (BROWSER) <i/> PROJECTION: CLASSICAL MDS</span><span>{map.metrics.stale_provider_fallback && 'OpenAlex制限のため保存済みデータを使用 · '}このブラウザに保存 · 別の端末への共有はJSONで</span></div>
        </> : <div className="landing-canvas"><div className="orb orb-one"/><div className="orb orb-two"/><div className="landing-center"><div className="orbit-icon"><Atom size={42} strokeWidth={1.1}/></div><div className="eyebrow">YOUR RESEARCH, IN A NEW DIMENSION</div><h2>Ideas form constellations.</h2><p>論文を探し、Abstract・共著者・引用ネットワークを掛け合わせて<br className="desktop-only"/>研究領域の関係を3次元で可視化します。</p><div className="landing-points"><span><span className="mini-dot purple"/> Text similarity</span><span><span className="mini-dot green"/> Co-authorship</span><span><span className="mini-dot orange"/> Citation network</span></div><button className="landing-action" onClick={() => document.getElementById('topic')?.focus()}>左の検索条件からマップを生成 <ArrowDownRight size={16}/></button></div></div>}
      </main>
    </div>
    {selected && <div className={detailOpen ? 'detail-shade open' : 'detail-shade'} onClick={() => setDetailOpen(false)}><aside className="detail-drawer" onClick={e => e.stopPropagation()}><div className="detail-header"><div className="eyebrow">RESEARCH INSIGHT <span className="slash">/</span> PAPER DETAIL</div><button className="icon-btn" aria-label="詳細を閉じる" onClick={() => setDetailOpen(false)}><X size={20}/></button></div><div className="detail-scroll"><div className="detail-year"><span className="cluster-dot" style={{background: CLUSTER_COLORS[selected.cluster % CLUSTER_COLORS.length]}}/> {selected.paper.year ?? 'Year unknown'} <span>·</span> {fmt(selected.paper.cited_by_count)} citations</div><h2>{selected.paper.title}</h2><div className="eyebrow detail-section">AUTHORS</div><div className="author-list">{selected.paper.authors.length ? selected.paper.authors.map(a => <span key={a.id || a.name}>{a.name}</span>) : <span>著者情報なし</span>}</div><div className="eyebrow detail-section">ABSTRACT</div><p className="abstract-text">{selected.paper.abstract || 'Abstract unavailable.'}</p><div className="eyebrow detail-section">CITATION LINKS WITHIN THIS MAP</div><div className="connection-counts"><span><GitBranch size={14}/> Cited by {inboundCitations.length}</span><span><GitBranch size={14}/> References {outboundCitations.length}</span></div>{inboundCitations.slice(0, 6).map(e => <button className="connected-paper" key={`${e.source}-${e.target}`} onClick={() => choose(e.source)}><ArrowDownRight size={15}/>{shortTitle(foundName(e.source), 65)}</button>)}{outboundCitations.slice(0, 6).map(e => <button className="connected-paper" key={`${e.source}-${e.target}`} onClick={() => choose(e.target)}><ArrowUpRight size={15}/>{shortTitle(foundName(e.target), 65)}</button>)}{inboundCitations.length + outboundCitations.length === 0 && <p className="subtle">表示中の論文間に直接引用はありません。マップ外の引用はここには表示されません。</p>}</div><div className="detail-actions"><a target="_blank" rel="noreferrer" href={selected.paper.url}>Open in OpenAlex <ExternalLink size={15}/></a>{selected.paper.doi && <a target="_blank" rel="noreferrer" href={selected.paper.doi}>View DOI <ExternalLink size={15}/></a>}</div></aside></div>}
  </div>;
}
