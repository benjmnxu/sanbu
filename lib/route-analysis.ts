import { haversineMeters } from '@/lib/geo';
import { fetchPoisAround } from '@/lib/overpass';
import { routeWithStadia } from '@/lib/routing';
import {
  PROFILE_WEIGHTS,
  computePoiScore,
  countPoiCategories,
  uniqueCategoryCount
} from '@/lib/scoring';
import { hashSimplifiedCoords, sampleAlongLine } from '@/lib/sampling';
import type {
  ClassifiedPOI,
  Coord,
  InternalRouteResult,
  RoutingProfile,
  ScoredPOI,
  ScoredRoute
} from '@/lib/types';

function clusterScore(pois: ClassifiedPOI[], profile: RoutingProfile): number {
  let total = 0;
  for (const poi of pois) {
    total += PROFILE_WEIGHTS[profile][poi.category] + poi.qualityBonus;
  }
  return total;
}

export async function generateRouteCandidates(
  origin: Coord,
  destination: Coord,
  fastest: InternalRouteResult,
  profile: RoutingProfile
): Promise<InternalRouteResult[]> {
  const samples = sampleAlongLine(fastest.coords, 20);

  const scoredSampleResults = await Promise.allSettled(
    samples.map(async (point) => {
      const pois = await fetchPoisAround(point, 250, profile);
      return {
        point,
        score: clusterScore(pois, profile)
      };
    })
  );
  const scoredSamples = scoredSampleResults.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }

    return {
      point: samples[index],
      score: 0
    };
  });

  const topWaypoints = scoredSamples
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((item) => item.point);

  const routedWaypointResults = await Promise.allSettled(
    topWaypoints.map((waypoint) => routeWithStadia([origin, waypoint, destination]))
  );
  const routedWaypointCandidates = routedWaypointResults
    .filter(
      (result): result is PromiseFulfilledResult<InternalRouteResult> =>
        result.status === 'fulfilled'
    )
    .map((result) => result.value);

  const dedup = new Map<string, InternalRouteResult>();
  const all = [fastest, ...routedWaypointCandidates];

  for (const candidate of all) {
    const key = hashSimplifiedCoords(candidate.coords);
    if (!dedup.has(key)) {
      dedup.set(key, candidate);
    }
  }

  return Array.from(dedup.values());
}

export async function scoreRouteByPois(
  route: InternalRouteResult,
  profile: RoutingProfile
): Promise<ScoredRoute> {
  const samples = sampleAlongLine(route.coords, 30);
  const poiDistanceMap = new Map<string, { poi: ClassifiedPOI; distanceM: number }>();

  for (const sample of samples) {
    let pois: ClassifiedPOI[] = [];
    try {
      pois = await fetchPoisAround(sample, 120, profile);
    } catch {
      continue;
    }
    for (const poi of pois) {
      const distanceM = haversineMeters(sample, { lat: poi.lat, lng: poi.lng });
      const existing = poiDistanceMap.get(poi.key);
      if (!existing || distanceM < existing.distanceM) {
        poiDistanceMap.set(poi.key, { poi, distanceM });
      }
    }
  }

  const scoredPois: ScoredPOI[] = Array.from(poiDistanceMap.values()).map(({ poi, distanceM }) => ({
    ...poi,
    distanceM,
    score: computePoiScore(poi, profile, distanceM)
  }));

  scoredPois.sort((a, b) => b.score - a.score);

  const top60 = scoredPois.slice(0, 60);
  const baseScore = top60.reduce((sum, poi) => sum + poi.score, 0);
  const uniqueCategories = uniqueCategoryCount(scoredPois);
  const diversityBonus = 0.5 * Math.min(6, uniqueCategories);

  return {
    score: baseScore + diversityBonus,
    highlights: scoredPois.slice(0, 8),
    poiCounts: countPoiCategories(scoredPois),
    uniqueCategories
  };
}
