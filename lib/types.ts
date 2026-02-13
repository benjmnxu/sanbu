export type RoutingProfile = 'balanced' | 'culture' | 'food';

export type PoiCategory = 'culture' | 'food' | 'shops' | 'parks' | 'other';

export interface Coord {
  lat: number;
  lng: number;
}

export interface RouteSummary {
  polyline: string;
  durationSec: number;
  distanceM: number;
}

export interface RouteCandidateSummary extends RouteSummary {
  score: number;
}

export interface PoiCountSummary {
  culture: number;
  food: number;
  shops: number;
  parks: number;
}

export interface HighlightPOI {
  name: string;
  lat: number;
  lng: number;
  category: Exclude<PoiCategory, 'other'>;
  score: number;
  tags: Record<string, string>;
}

export interface BestRouteSummary extends RouteSummary {
  score: number;
  highlights: HighlightPOI[];
  why: {
    poiCounts: PoiCountSummary;
    uniqueCategories: number;
  };
}

export interface RouteApiResponse {
  fastest: RouteSummary;
  best: BestRouteSummary;
  candidates: RouteCandidateSummary[];
}

export interface ClassifiedPOI {
  osmType: 'node' | 'way' | 'relation';
  id: number;
  key: string;
  lat: number;
  lng: number;
  name: string;
  category: Exclude<PoiCategory, 'other'>;
  tags: Record<string, string>;
  qualityBonus: number;
}

export interface ScoredPOI extends ClassifiedPOI {
  distanceM: number;
  score: number;
}

export interface ScoredRoute {
  score: number;
  highlights: ScoredPOI[];
  poiCounts: PoiCountSummary;
  uniqueCategories: number;
}

export interface InternalRouteResult extends RouteSummary {
  coords: Coord[];
}
