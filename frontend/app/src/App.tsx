import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight, ArrowUpRight, Atom, ChevronDown,
  Compass, ExternalLink, Filter, GitBranch, LoaderCircle,
  RotateCcw, Search, SlidersHorizontal, X, FileDown, FileUp, KeyRound,
} from 'lucide-react';
import MapScene, { CLUSTER_COLORS } from './MapScene';
import { buildRegionLabels, regionCaption } from './lib/region-labels';
import type { PaperLabelMode } from './lib/region-labels';
import { createMap, exportMap, importMap, loadMap, reweightMap } from './api';
import type { MapData, Weights } from './types';

const DEFAULT_WEIGHTS: Weights = { abstract: 0.65, authors: 0.15, citations: 0.20 };
const shortTitle = (s: string, n = 58) => s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
const fmt = (n: number) => new Intl.NumberFormat('en-US').format(n);

// Preserve English diagnostics; never display untranslated internal status text.
const hasCjk = (s: string) => /[\u3040-\u30ff\u3400-\u9fff]/u.test(s);
const englishStatus = (s: string, fallback: string) => hasCjk(s) ? fallback : s;
const errorMessage = (err: unknown, fallback: string) => err instanceof Error ? englishStatus(err.message, fallback) : fallback;

function WeightControl({ label, description, value, onChange, disabled = false, color }: {
  label: string; description: string; value: number; onChange: (value: number) => void; disabled?: boolean; color: string;
}) {
  return <div className={`weight-row ${disabled ? 'weight-disabled' : ''}`} title={disabled ? `${description} — no signal in this map` : description}>
    <div className="weight-header"><span className="weight-label"><span className="weight-dot" style={{ background: color }} />{label}</span><strong>{Math.round(value * 100)}%</strong></div>
    <input className="range" aria-label={label} title={description} type="range" min="0" max="1" step="0.05" value={value}
      onChange={e => onChange(Number(e.target.value))} style={{ '--slider-color': color } as React.CSSProperties} />
  </div>;
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (s: string) => void; placeholder: string }) {
  return <label className="small-field"><span>{label}</span><input type="number" min="1850" max="2100" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></label>;
}

export default function App() {
  const [query, setQuery] = useState('');
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
  const [showSimilarities, setShowSimilarities] = useState(false);
  const [showClouds, setShowClouds] = useState(true);
  const [cloudOpacity, setCloudOpacity] = useState(0.12);
  const [pointScale, setPointScale] = useState(1.7);
  const [paperLabels, setPaperLabels] = useState<PaperLabelMode>('off');
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
    }).catch(err => { if (alive) setError(errorMessage(err, 'Could not load map.')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const selected = map?.points.find(p => p.id === selectedId) ?? null;
  const regionLabels = useMemo(() => map ? buildRegionLabels(map.points) : [], [map]);
  const selectedRegion = selected ? regionLabels.find(r => r.cluster === selected.cluster) : undefined;
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
    if (!query.trim() || query.trim().length < 3) { setError('Enter at least 3 characters.'); return; }
    if (yearFrom && yearTo && Number(yearFrom) > Number(yearTo)) { setError('Start year must not exceed end year.'); return; }
    if (Object.values(weights).every(v => v === 0)) { setError('Set at least one positive weight.'); return; }
    setLoading(true);
    try {
      const result = await createMap({ query: query.trim(), limit, year_from: yearFrom ? Number(yearFrom) : null,
        year_to: yearTo ? Number(yearTo) : null, weights }, { apiKey, onProgress: message => setProgress(englishStatus(message, 'Generating map…')) });
      setMap(result); setSelectedId(null); setDetailOpen(false);
      setVisibleCluster(null); setPaperFilter(''); setSidebarOpen(false);
      window.history.replaceState({}, '', `?map=${encodeURIComponent(result.id)}`);
    } catch (err) { setError(errorMessage(err, 'Search failed.')); }
    finally { setLoading(false); setProgress(''); }
  };
  const reweight = async () => {
    if (!map) return;
    if (Object.values(weights).every(v => v === 0)) { setError('Set at least one positive weight.'); return; }
    setError(''); setReweighting(true);
    try { const result = await reweightMap(map.id, weights); setMap(result); setVisibleCluster(null); }
    catch (err) { setError(errorMessage(err, 'Recalculation failed.')); }
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
    } catch (err) { setError(errorMessage(err, 'Export failed.')); }
  };
  const importJson = async (file: File | undefined) => {
    if (!file) return;
    setError(''); setLoading(true); setProgress('Importing map…');
    try {
      const result = await importMap(file);
      setMap(result); setQuery(result.query); setLimit(result.requested_limit); setWeights(result.weights);
      setYearFrom(result.year_from?.toString() ?? ''); setYearTo(result.year_to?.toString() ?? '');
      setSelectedId(null); setDetailOpen(false); setVisibleCluster(null); setSidebarOpen(false);
      window.history.replaceState({}, '', `?map=${encodeURIComponent(result.id)}`);
    } catch (err) { setError(errorMessage(err, 'Import failed.')); }
    finally { setLoading(false); setProgress(''); }
  };
  const weightChanged = map && Object.keys(weights).some(k => weights[k as keyof Weights] !== map.weights[k as keyof Weights]);
  const canReweight = Boolean(map && (weightChanged || map.metrics.topic_clustering?.version !== 2) && !loading && !reweighting);
  const activePaperIds = new Set(map?.points.map(p => p.id) ?? []);
  const inboundCitations = selected && map ? map.edges.filter(e => e.kind === 'citation' && e.target === selected.id && activePaperIds.has(e.source)) : [];
  const outboundCitations = selected && map ? map.edges.filter(e => e.kind === 'citation' && e.source === selected.id && activePaperIds.has(e.target)) : [];
  const foundName = (id: string) => map?.points.find(p => p.id === id)?.paper.title ?? id;

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="https://github.com/europanite/research-map" target="_blank" rel="noopener noreferrer" title="View source on GitHub" aria-label="Research Map — GitHub repository (opens in a new tab)" style={{ color: 'inherit', textDecoration: 'none', cursor: 'pointer' }}>
        <div className="brand-icon"><Atom size={22} strokeWidth={1.9} /></div>
        <span>RESEARCH <b>map</b></span>
        <ExternalLink size={12} aria-hidden="true" />
      </a>
      <a className="topbar-link" href="https://docs.openalex.org/" target="_blank" rel="noreferrer">OpenAlex <ExternalLink size={13}/></a>
      <button type="button" className="icon-btn mobile-only topbar-search" aria-label="Open search panel" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><SlidersHorizontal size={20}/></button>
    </header>
    <div className="workspace">
      <aside className={`left-sidebar ${sidebarOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-scroll">
          <div className="panel-head"><div><h2>Search</h2></div><button className="icon-btn mobile-only" onClick={() => setSidebarOpen(false)} aria-label="Close search panel"><X size={19}/></button></div>
          <form onSubmit={search}>
            <label className="field-label" htmlFor="topic">Research topic</label>
            <div className="search-area"><Search size={17}/><textarea id="topic" rows={2} value={query} maxLength={200} onChange={e => setQuery(e.target.value)} placeholder="Explore a research area..." /></div>
            <div className="sidebar-divider"/>
            <div className="section-heading"><Filter size={15}/><span>Search parameters</span></div>
            <div className="field-row"><Field label="From year" value={yearFrom} onChange={setYearFrom} placeholder="Any" /><Field label="To year" value={yearTo} onChange={setYearTo} placeholder="Any" /></div>
            <label className="field-label space-above" htmlFor="limit">Papers</label>
            <div className="select-wrap"><select id="limit" value={limit} onChange={e => setLimit(Number(e.target.value))}><option value={20}>20</option><option value={40}>40</option><option value={60}>60</option><option value={100}>100</option><option value={120}>120</option></select><ChevronDown size={15}/></div>
            <details className="api-key-section"><summary><KeyRound size={14}/> API key (optional)</summary>
              <label htmlFor="openalex-key" className="field-label">API key</label>
              <input id="openalex-key" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                autoComplete="off" spellCheck={false} placeholder="Paste your key (not saved)" />
              <p className="subtle small">Sent only to OpenAlex; not saved. <a href="https://openalex.org/" target="_blank" rel="noreferrer">Get a key</a>.</p>
            </details>
            <div className="sidebar-divider"/>
            <div className="section-heading"><SlidersHorizontal size={15}/><span>Weights</span></div>
            <WeightControl label="Abstract + Title" description="Text similarity" color="#ac91ff" value={weights.abstract} onChange={v => setWeights(w => ({...w, abstract: v}))} disabled={map?.metrics.available_signals.abstract === false} />
            <WeightControl label="Authors" description="Shared authors" color="#5de0c7" value={weights.authors} onChange={v => setWeights(w => ({...w, authors: v}))} disabled={map?.metrics.available_signals.authors === false} />
            <WeightControl label="Citation network" description="Shared references and direct citations" color="#f7af6e" value={weights.citations} onChange={v => setWeights(w => ({...w, citations: v}))} disabled={map?.metrics.available_signals.citations === false} />
            <button className="primary-btn" type="submit" disabled={loading || reweighting}>
              {loading ? <LoaderCircle className="spin" size={17}/> : <Compass size={18}/>} {loading ? 'Generating…' : 'Generate map'} <ArrowUpRight size={16}/>
            </button>
            {map && <button type="button" className="secondary-btn" disabled={!canReweight} onClick={reweight}>
              {reweighting ? <LoaderCircle className="spin" size={15}/> : <RotateCcw size={15}/>} {reweighting ? 'Recalculating…' : 'Recalculate'}
              {canReweight && <span className="modified-dot"/>}
            </button>}
          </form>
          {loading && progress && <div className="progress-note" role="status">{progress}</div>}
          <div className="local-actions">
            <button className="secondary-btn" type="button" disabled={loading || reweighting} onClick={() => fileInput.current?.click()}><FileUp size={15}/> Import JSON</button>
            {map && <button className="secondary-btn" type="button" onClick={downloadJson}><FileDown size={15}/> Export JSON</button>}
            <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="Import map JSON" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void importJson(file); }} />
          </div>
          {error && <div className="error-box" role="alert">{error}</div>}
          {map && <details className="compact-details map-info"><summary>Map info</summary>
            <p className="map-query">{map.query}</p>
            <dl><dt>Papers</dt><dd>{fmt(map.metrics.papers)}</dd><dt>Citation links</dt><dd>{fmt(map.metrics.citation_links)}</dd><dt>Similarity links</dt><dd>{fmt(map.metrics.similarity_links)}</dd><dt>Authors</dt><dd>{fmt(map.metrics.unique_authors)}</dd><dt>Text</dt><dd>Technical term TF-IDF</dd><dt>Projection</dt><dd>MDS</dd><dt>Silhouette</dt><dd>{map.metrics.topic_clustering ? (map.metrics.topic_clustering.silhouette?.toFixed(3) ?? 'No clear separation') : 'Legacy map — recalculate'}</dd><dt>Text silhouette</dt><dd>{map.metrics.topic_clustering?.text_silhouette?.toFixed(3) ?? 'N/A'}</dd><dt>Source</dt><dd>{map.cached ? 'Local cache' : 'OpenAlex'}</dd></dl>
            <p>Stored in this browser. Export JSON to share.</p>
          </details>}
        </div>
      </aside>
      <main className="main-panel">
        {map ? <>
          {map.metrics.stale_provider_fallback && <div className="cache-notice" role="status">OpenAlex unavailable — using cached papers.</div>}
          <div className="visual-body">
            <div className="map-area">
              <MapScene data={map} selectedId={selectedId} onSelect={choose} showCitations={showCitations} showSimilarities={showSimilarities} paperLabels={paperLabels} showRegionLabels={showRegionLabels} showClouds={showClouds} cloudOpacity={cloudOpacity} pointScale={pointScale} visibleCluster={visibleCluster}/>
              <div className="map-overlay-bottom region-caption-overlay" aria-label="Filter regions">
                <div className="cluster-legend caption-legend">
                  <button type="button" aria-pressed={visibleCluster === null} className={visibleCluster === null ? 'cluster-option region-all on' : 'cluster-option region-all'} onClick={() => setVisibleCluster(null)}>All</button>
                  {regionLabels.map(r => <button type="button" key={r.cluster}
                    aria-pressed={visibleCluster === r.cluster}
                    aria-label={`Group ${r.cluster + 1}: ${regionCaption(r)}, ${r.paperCount} papers`}
                    title={`Region ${r.cluster + 1}: ${regionCaption(r)} (${r.paperCount} papers) — extracted terms`}
                    className={visibleCluster === r.cluster ? 'cluster-option region-caption-option on' : 'cluster-option region-caption-option'}
                    style={{ '--region-color': CLUSTER_COLORS[((r.cluster % CLUSTER_COLORS.length) + CLUSTER_COLORS.length) % CLUSTER_COLORS.length] } as React.CSSProperties}
                    onClick={() => setVisibleCluster(v => v === r.cluster ? null : r.cluster)}>
                    <span className="cluster-dot" style={{ background: CLUSTER_COLORS[((r.cluster % CLUSTER_COLORS.length) + CLUSTER_COLORS.length) % CLUSTER_COLORS.length] }}/>
                    <span className="region-caption-content">
                      <strong>{r.cluster + 1}</strong>
                    </span>
                  </button>)}
                </div>
              </div>
              <details className="map-layers"><summary><SlidersHorizontal size={13}/> Layers</summary><div className="layer-controls">
                <label><input type="checkbox" checked={showClouds} onChange={e => setShowClouds(e.target.checked)}/><span className="layer-cloud"/> Region clouds</label>
                <label className="layer-range-label">Cloud intensity <output>{Math.round(cloudOpacity * 100)}%</output></label>
                <input aria-label="Cloud intensity" className="layer-range" type="range" min="0.04" max="0.24" step="0.02" value={cloudOpacity} disabled={!showClouds} onChange={e => setCloudOpacity(Number(e.target.value))}/>
                <label className="layer-range-label">Paper size <output>{Math.round(pointScale * 100)}%</output></label>
                <input aria-label="Paper size" className="layer-range" type="range" min="0.8" max="2.4" step="0.1" value={pointScale} onChange={e => setPointScale(Number(e.target.value))}/>
                <div className="layer-separator"/>
                <label><input type="checkbox" checked={showCitations} onChange={e => setShowCitations(e.target.checked)}/><span className="layer-line citation"/> Citation links</label>
                <label><input type="checkbox" checked={showSimilarities} onChange={e => setShowSimilarities(e.target.checked)}/><span className="layer-line similarity"/> Similarity links</label>
                <div className="layer-separator"/>
                <label><input type="checkbox" checked={showRegionLabels} onChange={e => setShowRegionLabels(e.target.checked)}/> Region keywords</label>
                <label className="layer-label-select">Paper labels<select aria-label="Paper labels" value={paperLabels} onChange={e => setPaperLabels(e.target.value as PaperLabelMode)}><option value="off">Off</option><option value="key">Key papers</option><option value="all">All papers</option></select></label>
              </div></details>
            </div>
            <div className="paper-panel">
              <div className="paper-panel-head"><h3>Papers <span>{filteredPapers.length}</span></h3></div>
              <div className="filter-input"><Search size={15}/><input value={paperFilter} onChange={e => setPaperFilter(e.target.value)} placeholder="Filter papers…" aria-label="Filter papers"/></div>
              <div className="sort-row"><div><select aria-label="Sort papers" value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}><option value="relevance">Relevance</option><option value="citations">Most cited</option><option value="year">Newest</option></select><ChevronDown size={12}/></div></div>
              <div className="paper-list">{filteredPapers.map((point, index) => <button key={point.id} className={selectedId === point.id ? 'paper-item active' : 'paper-item'} onClick={() => choose(point.id)}><div className="paper-item-head"><span className="paper-index">{String(index + 1).padStart(2, '0')}</span><span className="paper-cluster-dot" style={{background: CLUSTER_COLORS[point.cluster % CLUSTER_COLORS.length]}}/><span className="paper-year">{point.paper.year ?? '—'}</span></div><h4>{point.paper.title}</h4><p>{point.paper.authors.slice(0, 3).map(a => a.name).join(', ')}{point.paper.authors.length > 3 ? ' et al.' : ''}</p><div className="paper-item-foot"><span><GitBranch size={12}/> {fmt(point.paper.cited_by_count)} citations</span><ArrowUpRight size={14}/></div></button>)}{filteredPapers.length === 0 && <div className="empty-filter">No matching papers.</div>}</div>
            </div>
          </div>
        </> : <div className="map-empty" aria-hidden="true"/>}
      </main>
    </div>
    {selected && <div className={detailOpen ? 'detail-shade open' : 'detail-shade'} onClick={() => setDetailOpen(false)}><aside className="detail-drawer" onClick={e => e.stopPropagation()}><div className="detail-header"><div className="eyebrow">Paper details</div><button className="icon-btn" aria-label="Close paper details" onClick={() => setDetailOpen(false)}><X size={20}/></button></div><div className="detail-scroll"><div className="detail-year"><span className="cluster-dot" style={{background: CLUSTER_COLORS[selected.cluster % CLUSTER_COLORS.length]}}/> {selected.paper.year ?? 'Year unknown'} <span>·</span> {fmt(selected.paper.cited_by_count)} citations</div><h2>{selected.paper.title}</h2><div className="eyebrow detail-section">Region</div><div className="detail-region-caption"><span className="cluster-dot" style={{background: CLUSTER_COLORS[((selected.cluster % CLUSTER_COLORS.length) + CLUSTER_COLORS.length) % CLUSTER_COLORS.length]}}/>{selectedRegion ? regionCaption(selectedRegion) : `Group ${selected.cluster + 1}`}</div><div className="eyebrow detail-section">Authors</div><div className="author-list">{selected.paper.authors.length ? selected.paper.authors.map(a => <span key={a.id || a.name}>{a.name}</span>) : <span>No authors listed</span>}</div><div className="eyebrow detail-section">Abstract</div><p className="abstract-text">{selected.paper.abstract || 'Abstract unavailable.'}</p><div className="eyebrow detail-section">Citations in map</div><div className="connection-counts"><span><GitBranch size={14}/> Cited by {inboundCitations.length}</span><span><GitBranch size={14}/> References {outboundCitations.length}</span></div>{inboundCitations.slice(0, 6).map(e => <button className="connected-paper" key={`${e.source}-${e.target}`} onClick={() => choose(e.source)}><ArrowDownRight size={15}/>{shortTitle(foundName(e.source), 65)}</button>)}{outboundCitations.slice(0, 6).map(e => <button className="connected-paper" key={`${e.source}-${e.target}`} onClick={() => choose(e.target)}><ArrowUpRight size={15}/>{shortTitle(foundName(e.target), 65)}</button>)}{inboundCitations.length + outboundCitations.length === 0 && <p className="subtle">No citations within this map.</p>}</div><div className="detail-actions"><a target="_blank" rel="noreferrer" href={selected.paper.url}>Open in OpenAlex <ExternalLink size={15}/></a>{selected.paper.doi && <a target="_blank" rel="noreferrer" href={selected.paper.doi}>View DOI <ExternalLink size={15}/></a>}</div></aside></div>}
  </div>;
}
