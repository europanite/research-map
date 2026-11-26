import { useMemo } from 'react';
import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js-dist-min';
const Plot = createPlotlyComponent(Plotly);
import type { Data, Layout } from 'plotly.js-dist-min';
import type { MapData } from './types';
import { buildRegionLabels, choosePaperLabelIds } from './lib/region-labels';
import { buildRegionClouds } from './lib/clouds';
import { buildRegionCallouts } from './lib/region-callouts';
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
  const regionCallouts = useMemo(() => buildRegionCallouts(
    regionClouds.filter(c => visibleCluster === null || c.cluster === visibleCluster),
    data.points.filter(p => visibleCluster === null || p.cluster === visibleCluster),
  ), [regionClouds, data.points, visibleCluster]);
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
        line: { color: 'rgba(134,148,194,0.035)', width: 0.5 },
        hoverinfo: 'skip', showlegend: false });
    }
    if (showCitations) {
      scatter.push({ type: 'scatter3d', mode: 'lines', ...lineArrays('citation'),
        line: { color: 'rgba(255,189,121,0.07)', width: 0.65 },
        hoverinfo: 'skip', showlegend: false });
    }

    const nodeColors = filtered.map(p => palette(p.cluster));
    const baseSize = filtered.map(p => Math.min(12.5, 7.5 + Math.log10(1 + p.paper.cited_by_count) * 1.45) * pointScale);
    // Soft halos give the papers some presence against the low-contrast region volumes.
    scatter.push({
      type: 'scatter3d', mode: 'markers',
      x: filtered.map(p => p.x), y: filtered.map(p => p.y), z: filtered.map(p => p.z),
      marker: { color: nodeColors, opacity: 0.09, size: baseSize.map(size => size * 1.55) },
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
    // map_EXTERNAL_CALLOUTS_V1: leaders point toward the cloud surface, not papers.
    if (showRegionLabels) {
      for (const callout of regionCallouts) {
        scatter.push({
          type: 'scatter3d', mode: 'lines', x: callout.x, y: callout.y, z: callout.z,
          line: { color: palette(callout.cluster), width: 1.7 }, opacity: 0.85,
          hoverinfo: 'skip', showlegend: false,
        });
      }
    }
    return { traces: scatter, pointTraceIndex, visible: filtered };
  }, [data, selectedId, showCitations, showSimilarities, paperLabels, showRegionLabels,
    showClouds, cloudOpacity, pointScale, visibleCluster, regionClouds, regionCallouts]);

  const layout: Partial<Layout> = {
    autosize: true, paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)', showlegend: false,
    margin: { l: 0, r: 0, t: 0, b: 0 },
    uirevision: data.id,
    scene: {
      bgcolor: 'rgba(0,0,0,0)', aspectmode: 'cube',
      // Screen-space caption boxes at external 3D anchors stay readable during orbit.
      annotations: showRegionLabels ? regionCallouts.map(c => {
        const r = regionLabels.find(g => g.cluster === c.cluster);
        const color = CLUSTER_COLORS[((c.cluster % CLUSTER_COLORS.length) + CLUSTER_COLORS.length) % CLUSTER_COLORS.length];
        return {
          x: c.label[0], y: c.label[1], z: c.label[2],
          text: r?.keywords[0] || `Region ${c.cluster + 1}`,
          showarrow: false, captureevents: false,
          font: { size: 12, color, family: 'Inter, system-ui, sans-serif' },
          bgcolor: 'rgba(12,16,30,0.78)', bordercolor: color, borderwidth: 0, borderpad: 3,
        };
      }) : [],
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
    config={{ displaylogo: false, displayModeBar: 'hover', locale: 'en-US', responsive: true, scrollZoom: true,
      modeBarButtonsToRemove: ['toImage', 'lasso2d', 'select2d'] }}
    onClick={event => {
      const match = event.points.find((p: { curveNumber: number; pointNumber: number }) => p.curveNumber === pointTraceIndex);
      if (match && visible[match.pointNumber]) onSelect(visible[match.pointNumber].id);
    }}
  />;
}
