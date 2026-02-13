import { geohashEncode } from '@/lib/geohash';
import { LruTtlCache } from '@/lib/lru';
import { classifyPoiCategory, qualityBonus } from '@/lib/scoring';
import { PromiseThrottler } from '@/lib/throttler';
import type { ClassifiedPOI, Coord, RoutingProfile } from '@/lib/types';

const DEFAULT_OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
const OVERPASS_URLS =
  process.env.OVERPASS_URLS
    ?.split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0) ?? DEFAULT_OVERPASS_URLS;
const OVERPASS_USER_AGENT =
  process.env.OVERPASS_USER_AGENT ?? 'sanbu/1.0 (+https://github.com/example/sanbu)';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const cache = new LruTtlCache<string, ClassifiedPOI[]>(5000, CACHE_TTL_MS);
const throttler = new PromiseThrottler(200);

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function makeCacheKey(point: Coord, radiusM: number, profile: RoutingProfile): string {
  return `${geohashEncode(point.lat, point.lng, 7)}|${radiusM}|${profile}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryStatus(status: number): boolean {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
}

async function fetchOverpassJson(
  bodyEncoded: string
): Promise<{ elements?: OverpassElement[] }> {
  let lastError: Error | null = null;

  for (const url of OVERPASS_URLS) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await throttler.schedule(async () =>
          fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': OVERPASS_USER_AGENT,
              Accept: 'application/json'
            },
            body: bodyEncoded,
            cache: 'no-store'
          })
        );

        if (!response.ok) {
          const status = response.status;
          const text = (await response.text()).trim();
          const message = `Overpass error ${status} at ${url}: ${text || response.statusText}`;

          if (shouldRetryStatus(status) && attempt < 3) {
            await sleep(200 * attempt);
            continue;
          }

          throw new Error(message);
        }

        return (await response.json()) as { elements?: OverpassElement[] };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < 3) {
          await sleep(200 * attempt);
        }
      }
    }
  }

  throw lastError ?? new Error('Overpass request failed');
}

function buildQuery(point: Coord, radiusM: number): string {
  return `
[out:json][timeout:25];
(
  nwr(around:${radiusM},${point.lat},${point.lng})[tourism];
  nwr(around:${radiusM},${point.lat},${point.lng})[historic];
  nwr(around:${radiusM},${point.lat},${point.lng})[amenity~"^(cafe|restaurant|bar|pub)$"];
  nwr(around:${radiusM},${point.lat},${point.lng})[shop];
  nwr(around:${radiusM},${point.lat},${point.lng})[leisure~"^(park|garden)$"];
);
out center tags;
`;
}

function toClassifiedPoi(element: OverpassElement): ClassifiedPOI | null {
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;

  if (
    typeof lat !== 'number' ||
    !Number.isFinite(lat) ||
    typeof lng !== 'number' ||
    !Number.isFinite(lng)
  ) {
    return null;
  }

  const tags = element.tags ?? {};
  const category = classifyPoiCategory(tags);
  if (!category) {
    return null;
  }

  return {
    osmType: element.type,
    id: element.id,
    key: `${element.type}:${element.id}`,
    lat,
    lng,
    name: tags.name ?? `${category}:${element.id}`,
    category,
    tags,
    qualityBonus: qualityBonus(tags)
  };
}

export async function fetchPoisAround(
  point: Coord,
  radiusM: number,
  profile: RoutingProfile
): Promise<ClassifiedPOI[]> {
  const key = makeCacheKey(point, radiusM, profile);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const body = new URLSearchParams();
  body.set('data', buildQuery(point, radiusM));
  const data = await fetchOverpassJson(body.toString());

  const elements = Array.isArray(data.elements) ? data.elements : [];
  const dedup = new Map<string, ClassifiedPOI>();

  for (const element of elements) {
    const poi = toClassifiedPoi(element);
    if (!poi) {
      continue;
    }

    if (!dedup.has(poi.key)) {
      dedup.set(poi.key, poi);
    }
  }

  const pois = Array.from(dedup.values());
  cache.set(key, pois);
  return pois;
}
