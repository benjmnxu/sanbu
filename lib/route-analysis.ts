import { haversineMeters } from '@/lib/geo';
import { routeWithStadia } from '@/lib/routing';
import {
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

const POI_CUTOFF_M = 200;
const SCORING_SAMPLES = 20;

export async function generateCandidateRoutes(
  origin: Coord,
  destination: Coord,
  fastest: InternalRouteResult
): Promise<InternalRouteResult[]> {
  const midLat = (origin.lat + destination.lat) / 2;
  const midLng = (origin.lng + destination.lng) / 2;

  const dLat = destination.lat - origin.lat;
  const dLng = destination.lng - origin.lng;

  // Scale perpendicular offset based on route distance (~100-200m for typical walks)
  const beelineM = haversineMeters(origin, destination);
  const offsetScale = Math.min(0.002, beelineM / 5_000_000);

  const waypoints: Coord[] = [
    { lat: midLat + dLng * offsetScale, lng: midLng - dLat * offsetScale },
    { lat: midLat - dLng * offsetScale, lng: midLng + dLat * offsetScale }
  ];

  // For longer routes, add a 1/3 offset as well
  if (beelineM > 1500) {
    const thirdLat = origin.lat + dLat / 3;
    const thirdLng = origin.lng + dLng / 3;
    waypoints.push({
      lat: thirdLat + dLng * offsetScale * 0.7,
      lng: thirdLng - dLat * offsetScale * 0.7
    });
  }

  const routeResults = await Promise.allSettled(
    waypoints.map((wp) => routeWithStadia([origin, wp, destination]))
  );

  const dedup = new Map<string, InternalRouteResult>();
  dedup.set(hashSimplifiedCoords(fastest.coords), fastest);

  for (const result of routeResults) {
    if (result.status === 'fulfilled') {
      const key = hashSimplifiedCoords(result.value.coords);
      if (!dedup.has(key)) {
        dedup.set(key, result.value);
      }
    }
  }

  return Array.from(dedup.values());
}

export function scoreRouteFromPool(
  route: InternalRouteResult,
  poiPool: Map<string, ClassifiedPOI>,
  profile: RoutingProfile
): ScoredRoute {
  const samples = sampleAlongLine(route.coords, SCORING_SAMPLES);
  const poiDistanceMap = new Map<string, { poi: ClassifiedPOI; distanceM: number }>();

  for (const sample of samples) {
    for (const poi of poiPool.values()) {
      const distanceM = haversineMeters(sample, { lat: poi.lat, lng: poi.lng });
      if (distanceM > POI_CUTOFF_M) continue;

      const existing = poiDistanceMap.get(poi.key);
      if (!existing || distanceM < existing.distanceM) {
        poiDistanceMap.set(poi.key, { poi, distanceM });
      }
    }
  }

  return buildScoredRoute(poiDistanceMap, profile);
}

function buildScoredRoute(
  poiDistanceMap: Map<string, { poi: ClassifiedPOI; distanceM: number }>,
  profile: RoutingProfile
): ScoredRoute {
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
