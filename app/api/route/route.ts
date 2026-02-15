import { NextRequest, NextResponse } from 'next/server';

import { geocodeQuery } from '@/lib/geocode';
import { haversineMeters } from '@/lib/geo';
import { buildPoiCorridor } from '@/lib/poi-corridor';
import { generateCandidateRoutes, scoreRouteFromPool } from '@/lib/route-analysis';
import { routeWithStadia } from '@/lib/routing';
import type { RouteApiResponse, RouteCandidateSummary, RoutingProfile } from '@/lib/types';

const VALID_PROFILES: RoutingProfile[] = ['balanced', 'culture', 'food'];
const MAX_WALKING_BEELINE_METERS = 250_000;

function parseProfile(input: string | null): RoutingProfile {
  if (!input) {
    return 'balanced';
  }
  return VALID_PROFILES.includes(input as RoutingProfile)
    ? (input as RoutingProfile)
    : 'balanced';
}

function parseDetourPct(input: string | null): number {
  const parsed = Number(input ?? '20');
  if (!Number.isFinite(parsed)) {
    return 20;
  }
  return Math.min(40, Math.max(10, parsed));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const originRaw = request.nextUrl.searchParams.get('origin') ?? '';
  const destinationRaw = request.nextUrl.searchParams.get('destination') ?? '';
  const profile = parseProfile(request.nextUrl.searchParams.get('profile'));
  const detourPct = parseDetourPct(request.nextUrl.searchParams.get('detourPct'));

  if (!originRaw.trim() || !destinationRaw.trim()) {
    return NextResponse.json(
      { error: 'Missing origin or destination query parameter' },
      { status: 400 }
    );
  }

  try {
    const [origin, destination] = await Promise.all([
      geocodeQuery(originRaw),
      geocodeQuery(destinationRaw)
    ]);

    const beelineM = haversineMeters(
      { lat: origin.lat, lng: origin.lng },
      { lat: destination.lat, lng: destination.lng }
    );
    if (beelineM > MAX_WALKING_BEELINE_METERS) {
      return NextResponse.json(
        {
          error:
            'This pair is too far for pedestrian routing in one request. Use points within ~250 km straight-line distance.'
        },
        { status: 400 }
      );
    }

    // Phase 1: Fastest route
    const fastestRoute = await routeWithStadia([
      { lat: origin.lat, lng: origin.lng },
      { lat: destination.lat, lng: destination.lng }
    ]);

    const budgetDurationSec = fastestRoute.durationSec * (1 + detourPct / 100);

    // Phase 2: Generate 2-3 alternate candidates (Stadia only, fast)
    const allCandidates = await generateCandidateRoutes(
      { lat: origin.lat, lng: origin.lng },
      { lat: destination.lat, lng: destination.lng },
      fastestRoute
    );

    const budgetCandidates = allCandidates.filter(
      (candidate) => candidate.durationSec <= budgetDurationSec
    );
    const filteredCandidates =
      budgetCandidates.length > 0 ? budgetCandidates : [fastestRoute];

    // Phase 3: Build shared POI corridor (geohash-deduped Overpass calls)
    const corridor = await buildPoiCorridor(filteredCandidates, profile);

    // Phase 4: Score all candidates from pool (pure math, no API calls)
    const scoredCandidates = filteredCandidates.map((candidate) => ({
      candidate,
      score: scoreRouteFromPool(candidate, corridor.pool, profile)
    }));

    const best = scoredCandidates.reduce((top, current) =>
      current.score.score > top.score.score ? current : top
    );

    const candidateSummaries: RouteCandidateSummary[] = scoredCandidates.map(
      (item) => ({
        polyline: item.candidate.polyline,
        durationSec: item.candidate.durationSec,
        distanceM: item.candidate.distanceM,
        score: item.score.score
      })
    );

    const response: RouteApiResponse = {
      fastest: {
        polyline: fastestRoute.polyline,
        durationSec: fastestRoute.durationSec,
        distanceM: fastestRoute.distanceM
      },
      best: {
        polyline: best.candidate.polyline,
        durationSec: best.candidate.durationSec,
        distanceM: best.candidate.distanceM,
        score: best.score.score,
        highlights: best.score.highlights.map((poi) => ({
          name: poi.name,
          lat: poi.lat,
          lng: poi.lng,
          category: poi.category,
          score: poi.score,
          tags: poi.tags
        })),
        why: {
          poiCounts: best.score.poiCounts,
          uniqueCategories: best.score.uniqueCategories
        }
      },
      candidates: candidateSummaries,
      poiStatus: corridor.status
    };

    return NextResponse.json(response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Route calculation failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
