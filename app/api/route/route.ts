import { NextRequest, NextResponse } from 'next/server';

import { geocodeQuery } from '@/lib/geocode';
import { haversineMeters } from '@/lib/geo';
import { generateRouteCandidates, scoreRouteByPois } from '@/lib/route-analysis';
import { routeWithStadia } from '@/lib/routing';
import { emptyPoiCounts } from '@/lib/scoring';
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

    const fastestRoute = await routeWithStadia([
      { lat: origin.lat, lng: origin.lng },
      { lat: destination.lat, lng: destination.lng }
    ]);

    const budgetDurationSec = fastestRoute.durationSec * (1 + detourPct / 100);

    try {
      const generatedCandidates = await generateRouteCandidates(
        { lat: origin.lat, lng: origin.lng },
        { lat: destination.lat, lng: destination.lng },
        fastestRoute,
        profile
      );

      const budgetCandidates = generatedCandidates.filter(
        (candidate) => candidate.durationSec <= budgetDurationSec
      );
      const filteredCandidates = budgetCandidates.length > 0 ? budgetCandidates : [fastestRoute];

      const scoredCandidates = await Promise.all(
        filteredCandidates.map(async (candidate) => ({
          candidate,
          score: await scoreRouteByPois(candidate, profile)
        }))
      );

      const best = scoredCandidates.reduce((top, current) =>
        current.score.score > top.score.score ? current : top
      );

      const candidateSummaries: RouteCandidateSummary[] = scoredCandidates.map((item) => ({
        polyline: item.candidate.polyline,
        durationSec: item.candidate.durationSec,
        distanceM: item.candidate.distanceM,
        score: item.score.score
      }));

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
        candidates: candidateSummaries
      };

      return NextResponse.json(response);
    } catch {
      const fallback: RouteApiResponse = {
        fastest: {
          polyline: fastestRoute.polyline,
          durationSec: fastestRoute.durationSec,
          distanceM: fastestRoute.distanceM
        },
        best: {
          polyline: fastestRoute.polyline,
          durationSec: fastestRoute.durationSec,
          distanceM: fastestRoute.distanceM,
          score: 0,
          highlights: [],
          why: {
            poiCounts: emptyPoiCounts(),
            uniqueCategories: 0
          }
        },
        candidates: [
          {
            polyline: fastestRoute.polyline,
            durationSec: fastestRoute.durationSec,
            distanceM: fastestRoute.distanceM,
            score: 0
          }
        ]
      };

      return NextResponse.json(fallback);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Route calculation failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
