import { geohashEncode } from '@/lib/geohash';
import { LruTtlCache } from '@/lib/lru';
import { FOOD_AMENITIES, classifyPoiCategory, qualityBonus } from '@/lib/scoring';
import { PromiseThrottler } from '@/lib/throttler';
import type { ClassifiedPOI, Coord, RoutingProfile } from '@/lib/types';

const DEFAULT_OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];
const OVERPASS_URLS =
  process.env.OVERPASS_URLS
    ?.split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0) ?? DEFAULT_OVERPASS_URLS;
const OVERPASS_USER_AGENT =
  process.env.OVERPASS_USER_AGENT ?? 'sanbu/1.0 (+https://github.com/example/sanbu)';
export const CORRIDOR_RADIUS_M = 150;
const parsedTimeoutMs = Number(process.env.OVERPASS_TIMEOUT_MS ?? '5000');
const OVERPASS_TIMEOUT_MS =
  Number.isFinite(parsedTimeoutMs) && parsedTimeoutMs > 0 ? parsedTimeoutMs : 5000;
const parsedMaxConcurrency = Number(process.env.OVERPASS_MAX_CONCURRENCY ?? '4');
const OVERPASS_MAX_CONCURRENCY =
  Number.isFinite(parsedMaxConcurrency) && parsedMaxConcurrency > 0
    ? Math.floor(parsedMaxConcurrency)
    : 4;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const cache = new LruTtlCache<string, ClassifiedPOI[]>(5000, CACHE_TTL_MS);
const throttler = new PromiseThrottler(200);
const inflight = new Map<string, Promise<ClassifiedPOI[]>>();
const concurrencyWaiters: Array<() => void> = [];
let activeOverpassRequests = 0;

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

async function withConcurrencySlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeOverpassRequests >= OVERPASS_MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => {
      concurrencyWaiters.push(resolve);
    });
  }

  activeOverpassRequests += 1;
  try {
    return await task();
  } finally {
    activeOverpassRequests = Math.max(0, activeOverpassRequests - 1);
    const next = concurrencyWaiters.shift();
    if (next) {
      next();
    }
  }
}

async function fetchOverpassJson(
  bodyEncoded: string
): Promise<{ elements?: OverpassElement[] }> {
  let lastError: Error | null = null;

  for (const url of OVERPASS_URLS) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await withConcurrencySlot(() =>
          throttler.schedule(async () => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
          try {
            return await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': OVERPASS_USER_AGENT,
                Accept: 'application/json'
              },
              body: bodyEncoded,
              cache: 'no-store',
              signal: controller.signal
            });
          } finally {
            clearTimeout(timeout);
          }
          })
        );

        if (!response.ok) {
          const status = response.status;
          const text = (await response.text()).trim();
          const message = `Overpass error ${status} at ${url}: ${text || response.statusText}`;

          if (shouldRetryStatus(status) && attempt < 2) {
            await sleep(200 * attempt);
            continue;
          }

          throw new Error(message);
        }

        return (await response.json()) as { elements?: OverpassElement[] };
      } catch (error) {
        const asError = error instanceof Error ? error : new Error(String(error));
        if (asError.name === 'AbortError') {
          lastError = new Error(`Overpass request timed out after ${OVERPASS_TIMEOUT_MS}ms`);
        } else {
          lastError = asError;
        }
        if (attempt < 2) {
          await sleep(200 * attempt);
        }
      }
    }
  }

  throw lastError ?? new Error('Overpass request failed');
}

function buildQuery(point: Coord, radiusM: number): string {
  const foodAmenityPattern = FOOD_AMENITIES.join('|');

  return `
[out:json][timeout:5];
(
  nwr(around:${radiusM},${point.lat},${point.lng})[tourism];
  nwr(around:${radiusM},${point.lat},${point.lng})[historic];
  nwr(around:${radiusM},${point.lat},${point.lng})[amenity~"^(${foodAmenityPattern})$"];
  nwr(around:${radiusM},${point.lat},${point.lng})[cuisine];
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
    console.log(`[POI] Cache hit: ${key} (${cached.length} POIs)`);
    return cached;
  }

  const pending = inflight.get(key);
  if (pending) {
    console.log(`[POI] Inflight hit: ${key}`);
    return pending;
  }

  console.log(`[POI] Fetching: ${point.lat.toFixed(4)},${point.lng.toFixed(4)} r=${radiusM}`);
  const promise = (async () => {
    const body = new URLSearchParams();
    body.set('data', buildQuery(point, radiusM));
    const data = await fetchOverpassJson(body.toString());
    console.log(`[POI] Got ${data.elements?.length ?? 0} elements`);

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
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}
