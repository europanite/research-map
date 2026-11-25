export interface Author { id: string; name: string }
export interface Paper {
  id: string; title: string; abstract: string; year: number | null;
  cited_by_count: number; authors: Author[]; doi: string | null; url: string;
}
export interface PaperRecord extends Paper {
  author_ids: string[]; referenced_works: string[];
}
export interface MapPoint {
  id: string; x: number; y: number; z: number;
  cluster: number; paper: Paper;
}
export interface MapEdge {
  source: string; target: string; kind: 'citation' | 'similarity'; strength: number;
}
export interface Weights { abstract: number; authors: number; citations: number }
export interface MapData {
  id: string; query: string; year_from: number | null; year_to: number | null;
  requested_limit: number; weights: Weights; points: MapPoint[];
  edges: MapEdge[]; metrics: {
    papers: number; citation_links: number; similarity_links: number;
    unique_authors: number; available_signals: Record<keyof Weights, boolean>;
    effective_weights: Weights; stale_provider_fallback?: boolean;
  }; created_at: string; cached: boolean; embedding_method: string;
}
export interface SearchInput {
  query: string; limit: number; year_from: number | null;
  year_to: number | null; weights: Weights;
}
export type AnalysisResult = Pick<MapData, 'points' | 'edges' | 'metrics'>;
