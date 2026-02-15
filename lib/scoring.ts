import type {
  ClassifiedPOI,
  PoiCountSummary,
  RoutingProfile,
  ScoredPOI
} from '@/lib/types';

export const FOOD_AMENITIES = [
  'cafe',
  'restaurant',
  'bar',
  'pub',
  'fast_food',
  'food_court',
  'ice_cream',
  'biergarten'
] as const;

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

  const amenity = tags.amenity ?? '';
  const isFoodPlace = FOOD_AMENITIES.includes(amenity as (typeof FOOD_AMENITIES)[number]);
  const isChain = hasNonEmpty(tags.brand) || hasNonEmpty(tags['brand:wikidata']);

  // Chain penalty: brand tags indicate corporate/franchise places
  if (isChain) {
    bonus -= 1.5;
  }

  // Wikidata/Wikipedia: only reward for non-food or non-chain food places
  // (chains get wikidata for the brand, not for being a good place)
  if (hasNonEmpty(tags.wikidata) && !(isFoodPlace && isChain)) {
    bonus += 2;
  }
  if (hasNonEmpty(tags.wikipedia) && !(isFoodPlace && isChain)) {
    bonus += 1;
  }

  // Basic data quality signals
  if (hasNonEmpty(tags.website)) {
    bonus += 0.5;
  }
  if (hasNonEmpty(tags.opening_hours)) {
    bonus += 0.3;
  }

  // Independent/quality food signals
  if (isFoodPlace) {
    // Sit-down restaurants and cafes over fast food
    if (amenity === 'restaurant' || amenity === 'cafe') {
      bonus += 0.5;
    }
    if (amenity === 'fast_food') {
      bonus -= 0.5;
    }

    // Outdoor seating suggests a nicer spot
    if (tags.outdoor_seating === 'yes') {
      bonus += 0.8;
    }

    // Specific cuisine indicates character (not just generic fast food)
    if (hasNonEmpty(tags.cuisine) && !tags.cuisine.includes(';')) {
      bonus += 0.3;
    }

    // Dietary options suggest a more curated menu
    if (hasNonEmpty(tags['diet:vegan']) || hasNonEmpty(tags['diet:vegetarian'])) {
      bonus += 0.3;
    }

    // Description means someone took time to document this place
    if (hasNonEmpty(tags.description)) {
      bonus += 0.5;
    }
  }

  return bonus;
}

export function classifyPoiCategory(
  tags: Record<string, string>
): 'culture' | 'food' | 'shops' | 'parks' | null {
  const amenity = tags.amenity ?? '';
  const leisure = tags.leisure ?? '';
  const hasCuisine = hasNonEmpty(tags.cuisine);

  if (hasNonEmpty(tags.tourism) || hasNonEmpty(tags.historic)) {
    return 'culture';
  }

  if (FOOD_AMENITIES.includes(amenity as (typeof FOOD_AMENITIES)[number]) || hasCuisine) {
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
