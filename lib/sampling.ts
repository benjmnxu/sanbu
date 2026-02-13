import { haversineMeters } from '@/lib/geo';
import type { Coord } from '@/lib/types';

export function sampleAlongLine(coords: Coord[], samples: number): Coord[] {
  if (coords.length === 0) {
    return [];
  }

  if (coords.length === 1 || samples <= 1) {
    return [coords[0]];
  }

  const cumulative: number[] = [0];
  let total = 0;

  for (let i = 1; i < coords.length; i += 1) {
    total += haversineMeters(coords[i - 1], coords[i]);
    cumulative.push(total);
  }

  if (total === 0) {
    return [coords[0]];
  }

  const result: Coord[] = [];
  for (let i = 0; i < samples; i += 1) {
    const target = (i / (samples - 1)) * total;
    result.push(interpolateAt(coords, cumulative, target));
  }

  return result;
}

function interpolateAt(coords: Coord[], cumulative: number[], target: number): Coord {
  let low = 0;
  let high = cumulative.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (cumulative[mid] < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const index = Math.max(1, low);
  const prevDistance = cumulative[index - 1];
  const nextDistance = cumulative[index];
  const span = nextDistance - prevDistance;

  if (span <= 0) {
    return coords[index];
  }

  const ratio = (target - prevDistance) / span;
  const a = coords[index - 1];
  const b = coords[index];

  return {
    lat: a.lat + (b.lat - a.lat) * ratio,
    lng: a.lng + (b.lng - a.lng) * ratio
  };
}

export function hashSimplifiedCoords(coords: Coord[]): string {
  if (coords.length === 0) {
    return '';
  }

  const step = Math.max(1, Math.floor(coords.length / 25));
  const parts: string[] = [];

  for (let i = 0; i < coords.length; i += step) {
    const coord = coords[i];
    parts.push(`${coord.lat.toFixed(4)},${coord.lng.toFixed(4)}`);
  }

  const last = coords[coords.length - 1];
  parts.push(`${last.lat.toFixed(4)},${last.lng.toFixed(4)}`);

  return parts.join('|');
}
