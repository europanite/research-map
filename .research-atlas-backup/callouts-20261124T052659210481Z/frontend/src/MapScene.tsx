import { useMemo } from 'react';
import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js-dist-min';
const Plot = createPlotlyComponent(Plotly);
import type { Data, Layout } from 'plotly.js-dist-min';
import type { MapData } from './types';
import { buildRegionLabels, choosePaperLabelIds, regionCaption } from './lib/region-labels';
import { buildRegionClouds } from './lib/clouds';
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
  showClouds: boolean;
  cloudOpacity: number;
  pointScale: number;
  visibleCluster: number | null;
}

const short = (title: string, limit = 34) =>
  title.length > limit ? `${title.slice(0, limit - 1).trimEnd()}…` : title;

export default function MapScene({ data, selectedId, onSelect, showCitations, showSimilarities,
  paperLabels, showRegionLabels, showClouds, cloudOpacity, pointScale, visibleCluster }: Props) {
  // Derive regions purely from the displayed map. Existing JSON and IndexedDB maps work.
  const regionLabels = useMemo(() => buildRegionLabels(data.points), [data.points]);
  const regionClouds = useMemo(() => buildRegionClouds(data.points), [data.points]);
  const { traces, pointTraceIndex, visible } = useMemo(() => {
    const filtered = data.points.filter(p => visibleCluster === null || p.cluster === visibleCluster);
    const byId = new Map(filtered.map(p => [p.id, p]));
    const labelIds = choosePaperLabelIds(filtered, paperLabels, selectedId);
    const palette = (cluster: number) => CLUSTER_COLORS[((cluster % CLUSTER_COLORS.length) + CLUSTER_COLORS.length) % CLUSTER_COLORS.length];
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

    // Cloud volumes are a *visual approximation* of cluster spread, not semantic borders.
    // Meshes are drawn before links and paper points so the latter remain the focus.
    if (showClouds) {
      for (const cloud of regionClouds) {
        if (visibleCluster !== null && cloud.cluster !== visibleCluster) continue;
        scatter.push({
          type: 'mesh3d', x: cloud.x, y: cloud.y, z: cloud.z,
          i: cloud.i, j: cloud.j, k: cloud.k,
          color: palette(cloud.cluster), opacity: cloudOpacity,
          flatshading: false,
          hoverinfo: 'skip', showlegend: false,
        });
      }
    }
    // Links are context: both are intentionally faint compared with the paper dots.
    if (showSimilarities) {
      scatter.push({ type: 'scatter3d', mode: 'lines', ...lineArrays('similarity'),
        line: { color: 'rgba(134,148,194,0.075)', width: 1 },
        hoverinfo: 'skip', showlegend: false });
    }
    if (showCitations) {
      scatter.push({ type: 'scatter3d', mode: 'lines', ...lineArrays('citation'),
        line: { color: 'rgba(255,189,121,0.17)', width: 1.2 },
        hoverinfo: 'skip', showlegend: false });
    }

    const nodeColors = filtered.map(p => palette(p.cluster));
    const baseSize = filtered.map(p => Math.min(12.5, 7.5 + Math.log10(1 + p.paper.cited_by_count) * 1.45) * pointScale);
    // Soft halos give the papers some presence against the low-contrast region volumes.
    scatter.push({
      type: 'scatter3d', mode: 'markers',
      x: filtered.map(p => p.x), y: filtered.map(p => p.y), z: filtered.map(p => p.z),
      marker: { color: nodeColors, opacity: 0.15, size: baseSize.map(size => size * 1.8) },
      hoverinfo: 'skip', showlegend: false,
    });
    if (selectedId) {
      const chosen = byId.get(selectedId);
      if (chosen) scatter.push({
        type: 'scatter3d', mode: 'markers',
        x: [chosen.x], y: [chosen.y], z: [chosen.z],
        marker: { color: palette(chosen.cluster), opacity: 0.26, size: 29 * pointScale },
        hoverinfo: 'skip', showlegend: false,
      });
    }

    const pointTraceIndex = scatter.length;
    scatter.push({
      type: 'scatter3d', mode: paperLabels === 'off' ? 'markers' : 'markers+text',
      x: filtered.map(p => p.x), y: filtered.map(p => p.y), z: filtered.map(p => p.z),
      text: filtered.map(p => labelIds.has(p.id) ? short(p.paper.title) : ''),
      textposition: 'top center',
      textfont: { size: paperLabels === 'all' ? 9 : 11, color: 'rgba(239,240,255,0.92)' },
      customdata: filtered.map(p => [p.paper.year ?? '—', p.paper.cited_by_count, p.paper.title]),
      marker: {
        size: filtered.map((p, idx) => p.id === selectedId ? 16 * pointScale : baseSize[idx]),
        color: filtered.map(p => p.id === selectedId ? '#ffffff' : palette(p.cluster)),
        opacity: 1, line: { color: 'rgba(250,251,255,0.87)', width: 1 },
      },
      hovertemplate: '<b>%{customdata[2]}</b><br>Year: %{customdata[0]}<br>Citations: %{customdata[1]}<extra></extra>',
      showlegend: false,
    });
    if (showRegionLabels) {
      const regions = regionLabels.filter(g => visibleCluster === null || g.cluster === visibleCluster);
      // A caption is colored exactly like its cloud and its legend card.
      for (const r of regions) {
        scatter.push({
          type: 'scatter3d', mode: 'text',
          x: [r.x], y: [r.y], z: [r.z],
          text: [regionCaption(r)],
          textposition: 'middle center',
          textfont: { size: 15, color: palette(r.cluster), family: 'Inter, system-ui, sans-serif' },
          hoverinfo: 'skip', showlegend: false,
        });
      }
    }
    return { traces: scatter, pointTraceIndex, visible: filtered };
  }, [data, selectedId, showCitations, showSimilarities, paperLabels, showRegionLabels,
    showClouds, cloudOpacity, pointScale, visibleCluster, regionLabels, regionClouds]);

  const layout: Partial<Layout> = {
    autosize: true, paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)', showlegend: false,
    margin: { l: 0, r: 0, t: 0, b: 0 },
    uirevision: data.id,
    scene: {
      bgcolor: 'rgba(0,0,0,0)', aspectmode: 'cube',
      xaxis: { showbackground: false, showgrid: false, showspikes: false, zeroline: false, showticklabels: false, title: { text: '' } },
      yaxis: { showbackground: false, showgrid: false, showspikes: false, zeroline: false, showticklabels: false, title: { text: '' } },
      zaxis: { showbackground: false, showgrid: false, showspikes: false, zeroline: false, showticklabels: false, title: { text: '' } },
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
