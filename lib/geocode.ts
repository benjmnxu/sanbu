import { parseLatLng } from '@/lib/geo';
import { buildStadiaUrl, getStadiaAuthHeaders } from '@/lib/stadia';
import type { Coord } from '@/lib/types';

export interface GeocodeResult extends Coord {
  displayName: string;
}

export interface GeocodeSuggestion extends GeocodeResult {}

const STADIA_ACCEPT_LANGUAGE = process.env.STADIA_ACCEPT_LANGUAGE ?? 'en';

interface StadiaFeature {
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
  properties?: Record<string, unknown>;
}

interface StadiaGeoResponse {
  features?: StadiaFeature[];
}

function asPointCoordinates(value: unknown): { lat: number; lng: number } | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const lng = Number(value[0]);
  const lat = Number(value[1]);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

function pickDisplayName(properties: Record<string, unknown> | undefined): string {
  if (!properties) {
    return 'Unnamed place';
  }

  const maybeString = [
    properties.label,
    properties.formatted,
    properties.name,
    properties.display_name
  ].find((value) => typeof value === 'string' && value.trim().length > 0);

  if (typeof maybeString === 'string') {
    return maybeString;
  }

  return 'Unnamed place';
}

function normalizeFeatures(features: StadiaFeature[]): GeocodeSuggestion[] {
  const items: GeocodeSuggestion[] = [];

  for (const feature of features) {
    const point = asPointCoordinates(feature.geometry?.coordinates);
    if (!point) {
      continue;
    }

    items.push({
      ...point,
      displayName: pickDisplayName(feature.properties)
    });
  }

  return items;
}

async function stadiaFetch(pathname: string, params: Record<string, string>): Promise<StadiaGeoResponse> {
  const url = new URL(buildStadiaUrl(pathname));
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url.toString(), {
    headers: {
      ...getStadiaAuthHeaders(),
      Accept: 'application/json',
      'Accept-Language': STADIA_ACCEPT_LANGUAGE
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Stadia geocoding error: ${response.status}`);
  }

  return (await response.json()) as StadiaGeoResponse;
}

async function stadiaForwardSearch(query: string, limit: number): Promise<GeocodeSuggestion[]> {
  let data: StadiaGeoResponse;
  try {
    data = await stadiaFetch('/geocoding/v1/search', {
      text: query,
      size: String(limit)
    });
  } catch {
    data = await stadiaFetch('/geocoding/v1/search', {
      q: query,
      size: String(limit)
    });
  }

  const features = Array.isArray(data.features) ? data.features : [];
  return normalizeFeatures(features).slice(0, limit);
}

async function stadiaAutocomplete(query: string, limit: number): Promise<GeocodeSuggestion[]> {
  let data: StadiaGeoResponse;
  try {
    data = await stadiaFetch('/geocoding/v2/autocomplete', {
      text: query,
      size: String(limit)
    });
  } catch {
    data = await stadiaFetch('/geocoding/v1/autocomplete', {
      text: query,
      size: String(limit)
    });
  }

  const features = Array.isArray(data.features) ? data.features : [];
  return normalizeFeatures(features).slice(0, limit);
}

export async function geocodeQuery(query: string): Promise<GeocodeResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error('Location query is empty');
  }

  const parsed = parseLatLng(trimmed);
  if (parsed) {
    return {
      ...parsed,
      displayName: `${parsed.lat}, ${parsed.lng}`
    };
  }

  const results = await stadiaForwardSearch(trimmed, 1);

  if (results.length === 0) {
    throw new Error('No geocoding result found');
  }

  return results[0];
}

export async function suggestLocations(query: string): Promise<GeocodeSuggestion[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const parsed = parseLatLng(trimmed);
  if (parsed) {
    return [
      {
        ...parsed,
        displayName: `${parsed.lat}, ${parsed.lng}`
      }
    ];
  }

  try {
    return await stadiaAutocomplete(trimmed, 8);
  } catch {
    return stadiaForwardSearch(trimmed, 8);
  }
}
