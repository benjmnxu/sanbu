import type {
  ClassifiedPOI,
  PoiCountSummary,
  RoutingProfile,
  ScoredPOI
} from '@/lib/types';

export const PROFILE_WEIGHTS: Record<
  RoutingProfile,
  Record<'culture' | 'food' | 'shops' | 'parks', number>
> = {
  balanced: {
    culture: 3,
    food: 2,
    shops: 1.5,
    parks: 2
  },
  culture: {
    culture: 4,
    parks: 2.5,
    food: 1.5,
    shops: 1
  },
  food: {
    food: 4,
    culture: 2,
    shops: 1.5,
    parks: 1.5
  }
};

function hasNonEmpty(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function qualityBonus(tags: Record<string, string>): number {
  let bonus = 0;
  if (hasNonEmpty(tags.wikidata)) {
    bonus += 2;
  }
  if (hasNonEmpty(tags.wikipedia)) {
    bonus += 1;
  }
  if (hasNonEmpty(tags.website)) {
    bonus += 0.5;
  }
  if (hasNonEmpty(tags.opening_hours)) {
    bonus += 0.3;
  }
  return bonus;
}

export function classifyPoiCategory(
  tags: Record<string, string>
): 'culture' | 'food' | 'shops' | 'parks' | null {
  const amenity = tags.amenity ?? '';
  const leisure = tags.leisure ?? '';

  if (hasNonEmpty(tags.tourism) || hasNonEmpty(tags.historic)) {
    return 'culture';
  }

  if (['cafe', 'restaurant', 'bar', 'pub'].includes(amenity)) {
    return 'food';
  }

  if (hasNonEmpty(tags.shop)) {
    return 'shops';
  }

  if (leisure === 'park' || leisure === 'garden') {
    return 'parks';
  }

  return null;
}

export function computePoiScore(
  poi: ClassifiedPOI,
  profile: RoutingProfile,
  distanceM: number
): number {
  const weight = PROFILE_WEIGHTS[profile][poi.category];
  const decay = Math.exp(-distanceM / 80);
  return (weight + poi.qualityBonus) * decay;
}

export function emptyPoiCounts(): PoiCountSummary {
  return {
    culture: 0,
    food: 0,
    shops: 0,
    parks: 0
  };
}

export function countPoiCategories(pois: ScoredPOI[]): PoiCountSummary {
  const counts = emptyPoiCounts();
  for (const poi of pois) {
    counts[poi.category] += 1;
  }
  return counts;
}

export function uniqueCategoryCount(pois: ScoredPOI[]): number {
  return new Set(pois.map((poi) => poi.category)).size;
}
