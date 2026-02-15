import { geohashEncode } from '@/lib/geohash';
import { CORRIDOR_RADIUS_M, fetchPoisAround } from '@/lib/overpass';
import { sampleAlongLine } from '@/lib/sampling';
import type { ClassifiedPOI, InternalRouteResult, PoiStatus, RoutingProfile } from '@/lib/types';

const SAMPLES_PER_CANDIDATE = 10;
const DEFAULT_BUDGET_MS = 6000;
const BATCH_SIZE = 4;

export interface PoiCorridorResult {
  pool: Map<string, ClassifiedPOI>;
  status: PoiStatus;
}

export async function buildPoiCorridor(
  candidates: InternalRouteResult[],
  profile: RoutingProfile,
  budgetMs: number = DEFAULT_BUDGET_MS
): Promise<PoiCorridorResult> {
  const deadline = Date.now() + budgetMs;

  // 1. Sample all candidates, deduplicate by geohash-7
  const uniqueCells = new Map<string, { lat: number; lng: number }>();
  for (const candidate of candidates) {
    const samples = sampleAlongLine(candidate.coords, SAMPLES_PER_CANDIDATE);
    for (const sample of samples) {
      const gh = geohashEncode(sample.lat, sample.lng, 7);
      if (!uniqueCells.has(gh)) {
        uniqueCells.set(gh, sample);
      }
    }
  }

  // 2. Fetch in batches with budget awareness
  const cellPoints = Array.from(uniqueCells.values());
  const pool = new Map<string, ClassifiedPOI>();
  let hadFailure = false;

  for (let i = 0; i < cellPoints.length; i += BATCH_SIZE) {
    if (Date.now() >= deadline) {
      hadFailure = true;
      break;
    }

    const batch = cellPoints.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((point) => fetchPoisAround(point, CORRIDOR_RADIUS_M, profile))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const poi of result.value) {
          if (!pool.has(poi.key)) {
            pool.set(poi.key, poi);
          }
        }
      } else {
        hadFailure = true;
      }
    }
  }

  const status: PoiStatus =
    pool.size === 0 ? 'none' : hadFailure ? 'degraded' : 'full';

  return { pool, status };
}
