import { useMemo } from 'react';
import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js-dist-min';
const Plot = createPlotlyComponent(Plotly);
import type { Data, Layout } from 'plotly.js-dist-min';
import type { MapData } from './types';
import { buildRegionLabels, choosePaperLabelIds } from './lib/region-labels';
import type { PaperLabelMode } from './lib/region-labels';

export const CLUSTER_COLORS = [
  '#a78bfa', '#5be3cd', '#f2aa69', '#7eafff', '#f289bd', '#a4d66f', '#ffd56d',
];

interface Props {
  data: MapData;
  selectedId: string | null;
  onSelect: (id: string) => void;
  showCitations: boolean;
  showSimilarities: boolean;
  paperLabels: PaperLabelMode;
  showRegionLabels: boolean;
  visibleCluster: number | null;
}

const short = (title: string, limit = 34) =>
  title.length > limit ? `${title.slice(0, limit - 1).trimEnd()}…` : title;

export default function MapScene({ data, selectedId, onSelect, showCitations, showSimilarities, paperLabels, showRegionLabels, visibleCluster }: Props) {
  // Derive labels from public map data: also works with old saved maps / imported JSON.
  const regionLabels = useMemo(() => buildRegionLabels(data.points), [data.points]);
  const { traces, pointTraceIndex, visible } = useMemo(() => {
    const filtered = data.points.filter(p => visibleCluster === null || p.cluster === visibleCluster);
    const byId = new Map(filtered.map(p => [p.id, p]));
    const labelIds = choosePaperLabelIds(filtered, paperLabels, selectedId);
    const lineArrays = (kind: 'citation' | 'similarity') => {
      const x: Array<number | null> = [], y: Array<number | null> = [], z: Array<number | null> = [];
      for (const edge of data.edges) {
        if (edge.kind !== kind) continue;
        const a = byId.get(edge.source), b = byId.get(edge.target);
        if (!a || !b) continue;
        x.push(a.x, b.x, null);
        y.push(a.y, b.y, null);
        z.push(a.z, b.z, null);
      }
      return { x, y, z };
    };
    const scatter: Data[] = [];
    if (showSimilarities) {
      scatter.push({ type: 'scatter3d', mode: 'lines', ...lineArrays('similarity'),
        line: { color: 'rgba(119,136,198,0.22)', width: 2 },
        hoverinfo: 'skip', showlegend: false });
    }
    if (showCitations) {
      scatter.push({ type: 'scatter3d', mode: 'lines', ...lineArrays('citation'),
        line: { color: 'rgba(255,187,117,0.62)', width: 3 },
        hoverinfo: 'skip', showlegend: false });
    }
    const pointTraceIndex = scatter.length;
    scatter.push({
      type: 'scatter3d', mode: paperLabels === 'off' ? 'markers' : 'markers+text',
      x: filtered.map(p => p.x), y: filtered.map(p => p.y), z: filtered.map(p => p.z),
      text: filtered.map(p => labelIds.has(p.id) ? short(p.paper.title) : ''),
      textposition: 'top center',
      textfont: { size: paperLabels === 'all' ? 9 : 11, color: 'rgba(239,240,255,0.93)' },
      customdata: filtered.map(p => [p.paper.year ?? '—', p.paper.cited_by_count, p.paper.title]),
      marker: {
        size: filtered.map(p => p.id === selectedId ? 11 : Math.min(9, 4.5 + Math.log10(1 + p.paper.cited_by_count) * 1.25)),
        color: filtered.map(p => p.id === selectedId ? '#ffffff' : CLUSTER_COLORS[p.cluster % CLUSTER_COLORS.length]),
        opacity: 0.94, line: { color: 'rgba(255,255,255,0.3)', width: 0.4 },
      },
      hovertemplate: '<b>%{customdata[2]}</b><br>Year: %{customdata[0]}<br>Citations: %{customdata[1]}<extra></extra>',
      showlegend: false,
    });
    if (showRegionLabels) {
      const regions = regionLabels.filter(g => visibleCluster === null || g.cluster === visibleCluster);
      scatter.push({
        type: 'scatter3d', mode: 'text',
        x: regions.map(r => r.x), y: regions.map(r => r.y), z: regions.map(r => r.z),
        text: regions.map(r => r.keywords.length ? r.keywords.join(' · ') : `Group ${r.cluster + 1}`),
        textposition: 'middle center',
        textfont: { size: 16, color: '#ffe9a6', family: 'Inter, system-ui, sans-serif' },
        hoverinfo: 'skip', showlegend: false,
      });
    }
    return { traces: scatter, pointTraceIndex, visible: filtered };
  }, [data, selectedId, showCitations, showSimilarities, paperLabels, showRegionLabels, visibleCluster, regionLabels]);

  const layout: Partial<Layout> = {
    autosize: true, paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)', showlegend: false,
    margin: { l: 0, r: 0, t: 0, b: 0 },
    uirevision: data.id,
    scene: {
      bgcolor: 'rgba(0,0,0,0)', aspectmode: 'cube',
      xaxis: { showbackground: false, showgrid: true, gridcolor: 'rgba(127,143,187,.11)', showspikes: false, zeroline: false, showticklabels: false, title: { text: '' } },
      yaxis: { showbackground: false, showgrid: true, gridcolor: 'rgba(127,143,187,.11)', showspikes: false, zeroline: false, showticklabels: false, title: { text: '' } },
      zaxis: { showbackground: false, showgrid: true, gridcolor: 'rgba(127,143,187,.11)', showspikes: false, zeroline: false, showticklabels: false, title: { text: '' } },
      camera: { eye: { x: 1.45, y: 1.35, z: 1.18 } },
      dragmode: 'orbit',
    },
    font: { color: '#e8e8f7', family: 'Inter, system-ui, sans-serif' },
  };
  return <Plot
    data={traces} layout={layout} useResizeHandler
    style={{ width: '100%', height: '100%' }}
    config={{ displaylogo: false, responsive: true, scrollZoom: true,
      modeBarButtonsToRemove: ['toImage', 'lasso2d', 'select2d'] }}
    onClick={event => {
      const match = event.points.find(p => p.curveNumber === pointTraceIndex);
      if (match && visible[match.pointNumber]) onSelect(visible[match.pointNumber].id);
    }}
  />;
}
