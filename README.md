# sanbu

Sanbu is a Next.js (App Router) app that compares:
- Fastest walking route
- Best walking route under a detour budget, scored by nearby POIs and cultural signals

No Google APIs are used.

## Stack

- Next.js 14 + TypeScript + App Router
- `maplibre-gl` client map
- Next.js Route Handlers under `app/api/*`
- Stadia Maps Routing + Geocoding APIs (server-side)
- OSM Overpass API (server-side) for POIs
- In-memory LRU + TTL cache for Overpass responses

## Quick start

1. Set environment variables:

```bash
cp .env.example .env
```

2. Put your Stadia API key in `.env`:

```env
STADIA_API_KEY=your_key_here
```

3. Build and run:

```bash
docker compose up --build
```

4. Open:

- http://localhost:3000

## Environment variables

- `STADIA_API_KEY` (required)
- `STADIA_BASE_URL` (optional, default `https://api.stadiamaps.com`)
- `STADIA_ACCEPT_LANGUAGE` (optional, default `en`)
- `OVERPASS_URLS` (optional comma-separated endpoint list)
- `OVERPASS_USER_AGENT` (optional user-agent for Overpass requests)
- `NEXT_PUBLIC_TILE_STYLE_URL` (optional MapLibre style URL)

## API

### `GET /api/geocode?q=...`

Behavior:
- If `q` is `lat,lng`, returns parsed coordinate.
- Otherwise uses Stadia forward geocoding.

Response:

```json
{ "lat": 38.8895, "lng": -77.0353, "displayName": "..." }
```

### `GET /api/suggest?q=...`

Returns up to 8 address/place suggestions for autocomplete (Stadia autocomplete, fallback to forward search).

```json
[
  { "lat": 38.8895, "lng": -77.0353, "displayName": "Washington Monument, ..." }
]
```

### `GET /api/route?origin=...&destination=...&detourPct=20&profile=balanced`

Response shape:

```json
{
  "fastest": { "polyline": "...", "durationSec": 720, "distanceM": 1200 },
  "best": {
    "polyline": "...",
    "durationSec": 840,
    "distanceM": 1450,
    "score": 123.4,
    "highlights": [
      {
        "name": "...",
        "lat": 0,
        "lng": 0,
        "category": "culture",
        "score": 9.1,
        "tags": { "wikidata": "Q...", "wikipedia": "..." }
      }
    ],
    "why": {
      "poiCounts": { "food": 22, "shops": 18, "culture": 7, "parks": 3 },
      "uniqueCategories": 4
    }
  },
  "candidates": [
    { "polyline": "...", "durationSec": 800, "distanceM": 1400, "score": 110.0 }
  ]
}
```

Notes:
- Routing uses Stadia pedestrian costing. Very long origin/destination pairs are rejected early (currently ~250 km straight-line guard).

## Best-route algorithm (implemented)

1. Compute fastest route (origin -> destination).
2. Sample ~20 points on fastest route.
3. Overpass query per sample (250m), rank sample clusters by POI score.
4. Pick top 6 waypoint samples.
5. Route origin -> waypoint -> destination for each.
6. Deduplicate route shapes.
7. Filter by detour budget (`<= fastest * (1 + detourPct/100)`).
8. Score each candidate:
   - ~30 route samples
   - Overpass around each sample (120m)
   - dedupe POIs (`osmType:id`)
   - POI score = category weight + quality bonuses, with distance decay `exp(-d/80)`
   - route score = sum(top 60 POI scores) + diversity bonus
9. Return highest-scoring budget-valid route as `best`.

If Overpass errors, the API gracefully degrades:
- `fastest` still returned
- `best` falls back to `fastest` with score `0` and no highlights

## Local development (optional)

```bash
npm install --no-audit --no-fund --loglevel=error
STADIA_API_KEY=your_key_here npm run dev
```
