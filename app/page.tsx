'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type {
  LngLatBoundsLike,
  Map as MapLibreMap,
  Marker,
  StyleSpecification
} from 'maplibre-gl';

import { decodePolyline } from '@/lib/polyline';
import type { HighlightPOI, RouteApiResponse, RoutingProfile } from '@/lib/types';

interface GeocodeSuggestion {
  lat: number;
  lng: number;
  displayName: string;
}

function toLatLngString(lat: number, lng: number): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

function isLatLngInput(value: string): boolean {
  return /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(value.trim());
}

const DEFAULT_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: 'OpenStreetMap contributors'
    }
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm'
    }
  ]
};

const FASTEST_SOURCE_ID = 'fastest-source';
const BEST_SOURCE_ID = 'best-source';

function toLineFeature(coords: Array<{ lat: number; lng: number }>): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: coords.map((coord) => [coord.lng, coord.lat])
    }
  };
}

function emptyFeature(): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: []
    }
  };
}

function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

function formatDistance(distanceM: number): string {
  return `${(distanceM / 1000).toFixed(2)} km`;
}

export default function HomePage(): JSX.Element {
  const [origin, setOrigin] = useState('39.9535,-75.1953');
  const [destination, setDestination] = useState('38.9072,-77.0369');
  const [selectedOriginCoord, setSelectedOriginCoord] = useState<string | null>(null);
  const [selectedDestinationCoord, setSelectedDestinationCoord] = useState<string | null>(
    null
  );
  const [originSuggestions, setOriginSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [activeSuggestionField, setActiveSuggestionField] = useState<
    'origin' | 'destination' | null
  >(null);
  const [detourPct, setDetourPct] = useState(20);
  const [profile, setProfile] = useState<RoutingProfile>('balanced');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RouteApiResponse | null>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<typeof import('maplibre-gl') | null>(null);
  const highlightMarkersRef = useRef<Marker[]>([]);

  const detourDelta = useMemo(() => {
    if (!result) {
      return null;
    }
    const delta = result.best.durationSec - result.fastest.durationSec;
    return {
      sec: delta,
      pct: result.fastest.durationSec > 0 ? (delta / result.fastest.durationSec) * 100 : 0
    };
  }, [result]);

  useEffect(() => {
    let canceled = false;

    async function initMap(): Promise<void> {
      if (!mapContainerRef.current || mapRef.current) {
        return;
      }

      const maplibre = await import('maplibre-gl');
      if (canceled || !mapContainerRef.current) {
        return;
      }

      maplibreRef.current = maplibre;

      const map = new maplibre.Map({
        container: mapContainerRef.current,
        style: process.env.NEXT_PUBLIC_TILE_STYLE_URL || DEFAULT_STYLE,
        center: [-77.0369, 38.9072],
        zoom: 13
      });

      map.addControl(new maplibre.NavigationControl(), 'top-right');
      map.on('load', () => {
        if (map.getSource(FASTEST_SOURCE_ID)) {
          return;
        }

        map.addSource(FASTEST_SOURCE_ID, {
          type: 'geojson',
          data: emptyFeature()
        });

        map.addLayer({
          id: 'fastest-line',
          type: 'line',
          source: FASTEST_SOURCE_ID,
          paint: {
            'line-color': '#2563eb',
            'line-width': 4,
            'line-opacity': 0.85
          }
        });

        map.addSource(BEST_SOURCE_ID, {
          type: 'geojson',
          data: emptyFeature()
        });

        map.addLayer({
          id: 'best-line',
          type: 'line',
          source: BEST_SOURCE_ID,
          paint: {
            'line-color': '#ef4444',
            'line-width': 5,
            'line-opacity': 0.85,
            'line-dasharray': [1.5, 1]
          }
        });
      });

      mapRef.current = map;
    }

    initMap().catch(() => {
      setError('Failed to initialize map.');
    });

    return () => {
      canceled = true;
      highlightMarkersRef.current.forEach((marker) => marker.remove());
      highlightMarkersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    if (!map || !maplibre || !result) {
      return;
    }

    const fastestCoords = decodePolyline(result.fastest.polyline);
    const bestCoords = decodePolyline(result.best.polyline);

    const fastestSource = map.getSource(FASTEST_SOURCE_ID) as
      | import('maplibre-gl').GeoJSONSource
      | undefined;
    const bestSource = map.getSource(BEST_SOURCE_ID) as
      | import('maplibre-gl').GeoJSONSource
      | undefined;

    if (fastestSource) {
      fastestSource.setData(toLineFeature(fastestCoords));
    }
    if (bestSource) {
      bestSource.setData(toLineFeature(bestCoords));
    }

    highlightMarkersRef.current.forEach((marker) => marker.remove());
    highlightMarkersRef.current = [];

    for (const poi of result.best.highlights) {
      const markerEl = document.createElement('button');
      markerEl.type = 'button';
      markerEl.style.width = '14px';
      markerEl.style.height = '14px';
      markerEl.style.borderRadius = '999px';
      markerEl.style.border = '2px solid #111827';
      markerEl.style.background = '#f59e0b';
      markerEl.style.cursor = 'pointer';

      const popup = new maplibre.Popup({ offset: 15 }).setHTML(
        `<strong>${poi.name}</strong><br/>${poi.category} | score ${poi.score.toFixed(1)}`
      );

      const marker = new maplibre.Marker({ element: markerEl })
        .setLngLat([poi.lng, poi.lat])
        .setPopup(popup)
        .addTo(map);

      highlightMarkersRef.current.push(marker);
    }

    const allCoords = [...fastestCoords, ...bestCoords];
    if (allCoords.length > 0) {
      const lats = allCoords.map((coord) => coord.lat);
      const lngs = allCoords.map((coord) => coord.lng);
      const bounds: LngLatBoundsLike = [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)]
      ];
      map.fitBounds(bounds, { padding: 60, duration: 500 });
    }
  }, [result]);

  useEffect(() => {
    const query = origin.trim();
    if (query.length < 3) {
      setOriginSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/suggest?q=${encodeURIComponent(query)}`, {
          signal: controller.signal
        });
        if (!response.ok) {
          setOriginSuggestions([]);
          return;
        }

        const data = (await response.json()) as GeocodeSuggestion[];
        setOriginSuggestions(Array.isArray(data) ? data.slice(0, 5) : []);
      } catch (suggestionError) {
        if ((suggestionError as Error).name !== 'AbortError') {
          setOriginSuggestions([]);
        }
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [origin]);

  useEffect(() => {
    const query = destination.trim();
    if (query.length < 3) {
      setDestinationSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/suggest?q=${encodeURIComponent(query)}`, {
          signal: controller.signal
        });
        if (!response.ok) {
          setDestinationSuggestions([]);
          return;
        }

        const data = (await response.json()) as GeocodeSuggestion[];
        setDestinationSuggestions(Array.isArray(data) ? data.slice(0, 5) : []);
      } catch (suggestionError) {
        if ((suggestionError as Error).name !== 'AbortError') {
          setDestinationSuggestions([]);
        }
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [destination]);

  function applySuggestion(
    field: 'origin' | 'destination',
    suggestion: GeocodeSuggestion
  ): void {
    if (field === 'origin') {
      setOrigin(suggestion.displayName);
      setSelectedOriginCoord(toLatLngString(suggestion.lat, suggestion.lng));
      setOriginSuggestions([]);
    } else {
      setDestination(suggestion.displayName);
      setSelectedDestinationCoord(toLatLngString(suggestion.lat, suggestion.lng));
      setDestinationSuggestions([]);
    }
    setActiveSuggestionField(null);
  }

  async function fetchTopSuggestion(query: string): Promise<GeocodeSuggestion | null> {
    const response = await fetch(`/api/suggest?q=${encodeURIComponent(query)}`);
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as GeocodeSuggestion[];
    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    return data[0];
  }

  async function fetchGeocode(query: string): Promise<GeocodeSuggestion | null> {
    const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as GeocodeSuggestion;
    if (!data || typeof data.lat !== 'number' || typeof data.lng !== 'number') {
      return null;
    }

    return data;
  }

  async function tryResolveInput(query: string): Promise<GeocodeSuggestion | null> {
    const geocoded = await fetchGeocode(query);
    if (geocoded) {
      return geocoded;
    }
    return fetchTopSuggestion(query);
  }

  async function handleRoute(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    setActiveSuggestionField(null);
    setOriginSuggestions([]);
    setDestinationSuggestions([]);

    try {
      let originParam = selectedOriginCoord ?? origin;
      let destinationParam = selectedDestinationCoord ?? destination;

      if (!selectedOriginCoord && !isLatLngInput(origin)) {
        const suggestion = await tryResolveInput(origin);
        if (suggestion) {
          const coord = toLatLngString(suggestion.lat, suggestion.lng);
          setOrigin(suggestion.displayName);
          setSelectedOriginCoord(coord);
          originParam = coord;
        }
      }

      if (!selectedDestinationCoord && !isLatLngInput(destination)) {
        const suggestion = await tryResolveInput(destination);
        if (suggestion) {
          const coord = toLatLngString(suggestion.lat, suggestion.lng);
          setDestination(suggestion.displayName);
          setSelectedDestinationCoord(coord);
          destinationParam = coord;
        }
      }

      const params = new URLSearchParams({
        origin: originParam,
        destination: destinationParam,
        detourPct: String(detourPct),
        profile
      });

      const response = await fetch(`/api/route?${params.toString()}`);
      const data = (await response.json()) as RouteApiResponse | { error: string };

      if (!response.ok) {
        throw new Error((data as { error?: string }).error ?? 'Routing request failed');
      }

      setResult(data as RouteApiResponse);
    } catch (routeError) {
      setResult(null);
      setError(routeError instanceof Error ? routeError.message : 'Routing request failed');
    } finally {
      setIsLoading(false);
    }
  }

  function focusHighlight(index: number): void {
    const map = mapRef.current;
    const marker = highlightMarkersRef.current[index];
    if (!map || !marker) {
      return;
    }

    const lngLat = marker.getLngLat();
    map.flyTo({ center: [lngLat.lng, lngLat.lat], zoom: 16, duration: 400 });
    marker.togglePopup();
  }

  return (
    <main className="layout">
      <aside className="panel">
        <h1>Sanbu</h1>
        <p className="sub">Fastest vs best walking route, ranked by POIs + cultural signal.</p>

        <form onSubmit={handleRoute} className="form">
          <label>
            Origin
            <div className="inputWrap">
              <input
                value={origin}
                onChange={(event) => {
                  setOrigin(event.target.value);
                  setSelectedOriginCoord(null);
                  setActiveSuggestionField('origin');
                }}
                autoComplete="off"
                spellCheck={false}
                onFocus={() => setActiveSuggestionField('origin')}
                onBlur={() => {
                  window.setTimeout(() => {
                    setActiveSuggestionField((current) =>
                      current === 'origin' ? null : current
                    );
                  }, 120);
                }}
                placeholder="lat,lng or address"
                required
              />
              {activeSuggestionField === 'origin' && originSuggestions.length > 0 ? (
                <ul className="suggestionList">
                  {originSuggestions.map((suggestion, index) => (
                    <li key={`origin-${suggestion.lat}-${suggestion.lng}-${index}`}>
                      <button
                        type="button"
                        className="suggestionButton"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          applySuggestion('origin', suggestion);
                        }}
                      >
                        {suggestion.displayName}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </label>

          <label>
            Destination
            <div className="inputWrap">
              <input
                value={destination}
                onChange={(event) => {
                  setDestination(event.target.value);
                  setSelectedDestinationCoord(null);
                  setActiveSuggestionField('destination');
                }}
                autoComplete="off"
                spellCheck={false}
                onFocus={() => setActiveSuggestionField('destination')}
                onBlur={() => {
                  window.setTimeout(() => {
                    setActiveSuggestionField((current) =>
                      current === 'destination' ? null : current
                    );
                  }, 120);
                }}
                placeholder="lat,lng or address"
                required
              />
              {activeSuggestionField === 'destination' &&
              destinationSuggestions.length > 0 ? (
                <ul className="suggestionList">
                  {destinationSuggestions.map((suggestion, index) => (
                    <li key={`destination-${suggestion.lat}-${suggestion.lng}-${index}`}>
                      <button
                        type="button"
                        className="suggestionButton"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          applySuggestion('destination', suggestion);
                        }}
                      >
                        {suggestion.displayName}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </label>

          <label>
            Detour budget ({detourPct}%)
            <input
              type="range"
              min={10}
              max={40}
              value={detourPct}
              onChange={(event) => setDetourPct(Number(event.target.value))}
            />
          </label>

          <label>
            Profile
            <select
              value={profile}
              onChange={(event) => setProfile(event.target.value as RoutingProfile)}
            >
              <option value="balanced">Balanced</option>
              <option value="culture">Culture</option>
              <option value="food">Food</option>
            </select>
          </label>

          <button type="submit" disabled={isLoading} className="routeButton">
            {isLoading ? 'Routing...' : 'Route'}
          </button>
        </form>

        {error ? <p className="error">{error}</p> : null}

        {result ? (
          <section className="summary">
            <h2>Route summary</h2>
            <p>
              Fastest: {formatDuration(result.fastest.durationSec)} ({formatDistance(result.fastest.distanceM)})
            </p>
            <p>
              Best: {formatDuration(result.best.durationSec)} ({formatDistance(result.best.distanceM)})
            </p>
            <p>
              Delta: {detourDelta ? `${formatDuration(Math.max(0, detourDelta.sec))} (${detourDelta.pct.toFixed(1)}%)` : '-'}
            </p>
            <p>Best score: {result.best.score.toFixed(1)}</p>
            <p>
              POIs: culture {result.best.why.poiCounts.culture}, food {result.best.why.poiCounts.food}, shops{' '}
              {result.best.why.poiCounts.shops}, parks {result.best.why.poiCounts.parks}
            </p>
            <p>Unique categories: {result.best.why.uniqueCategories}</p>
            <p>Candidates considered: {result.candidates.length}</p>

            <h3>Top highlights</h3>
            <ul>
              {result.best.highlights.map((poi: HighlightPOI, index: number) => (
                <li key={`${poi.name}-${index}`}>
                  <button
                    type="button"
                    onClick={() => focusHighlight(index)}
                    className="highlightButton"
                  >
                    {poi.name} ({poi.category}, {poi.score.toFixed(1)})
                  </button>
                </li>
              ))}
              {result.best.highlights.length === 0 ? <li>No highlights available.</li> : null}
            </ul>
          </section>
        ) : null}
      </aside>

      <section className="mapArea">
        <div ref={mapContainerRef} className="mapContainer" />
      </section>

      <style jsx>{`
        .layout {
          display: grid;
          grid-template-columns: 360px 1fr;
          min-height: 100vh;
          background: #e9eef5;
        }

        .panel {
          background: #ffffff;
          padding: 20px;
          border-right: 1px solid #dbe2ea;
          overflow-y: auto;
        }

        h1 {
          margin: 0;
          font-size: 1.5rem;
        }

        .sub {
          color: #475569;
          margin-top: 8px;
          margin-bottom: 20px;
          font-size: 0.95rem;
        }

        .form {
          display: grid;
          gap: 12px;
        }

        label {
          display: grid;
          gap: 6px;
          font-size: 0.9rem;
          color: #334155;
        }

        input,
        select {
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 10px;
          font-size: 0.95rem;
        }

        .inputWrap {
          position: relative;
        }

        .suggestionList {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          right: 0;
          margin: 0;
          padding: 6px;
          list-style: none;
          background: #ffffff;
          border: 1px solid #dbe2ea;
          border-radius: 10px;
          max-height: 220px;
          overflow-y: auto;
          z-index: 20;
          display: grid;
          gap: 4px;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
        }

        .suggestionButton {
          width: 100%;
          border: none;
          border-radius: 8px;
          padding: 8px 10px;
          text-align: left;
          background: #ffffff;
          color: #0f172a;
          cursor: pointer;
          font-size: 0.9rem;
        }

        .suggestionButton:hover {
          background: #f1f5f9;
        }

        .routeButton {
          border-radius: 8px;
          padding: 10px;
          background: #1d4ed8;
          border: none;
          color: #fff;
          font-weight: 600;
          cursor: pointer;
          font-size: 0.95rem;
        }

        .routeButton:disabled {
          opacity: 0.7;
          cursor: progress;
        }

        .error {
          margin-top: 12px;
          color: #b91c1c;
          font-weight: 600;
        }

        .summary {
          margin-top: 20px;
          font-size: 0.92rem;
          color: #0f172a;
        }

        .summary h2,
        .summary h3 {
          margin-bottom: 8px;
        }

        .summary p {
          margin: 6px 0;
        }

        .summary ul {
          margin: 0;
          padding-left: 0;
          list-style: none;
          display: grid;
          gap: 6px;
        }

        .summary li .highlightButton {
          text-align: left;
          width: 100%;
          background: #f8fafc;
          color: #0f172a;
          border: 1px solid #dbe2ea;
          border-radius: 8px;
          padding: 10px;
          font-weight: 500;
          cursor: pointer;
        }

        .mapArea {
          min-width: 0;
        }

        .mapContainer {
          width: 100%;
          height: 100vh;
        }

        @media (max-width: 900px) {
          .layout {
            grid-template-columns: 1fr;
          }

          .panel {
            border-right: none;
            border-bottom: 1px solid #dbe2ea;
          }

          .mapContainer {
            height: 60vh;
          }
        }
      `}</style>
    </main>
  );
}
