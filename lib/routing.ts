import { haversineMeters } from '@/lib/geo';
import { decodePolyline, encodePolyline } from '@/lib/polyline';
import { buildStadiaUrl, getStadiaAuthHeaders } from '@/lib/stadia';
import type { Coord, InternalRouteResult } from '@/lib/types';

async function stadiaErrorDetail(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as Record<string, unknown>;
      const candidate = [payload.error, payload.message, payload.reason].find(
        (value) => typeof value === 'string' && value.trim().length > 0
      );
      if (typeof candidate === 'string') {
        return candidate.trim();
      }
    } else {
      const text = (await response.text()).trim();
      if (text) {
        return text.slice(0, 240);
      }
    }
  } catch {
    // ignore parse errors and use status text fallback
  }

  return response.statusText || 'Unknown error';
}

function asCoord(value: unknown): Coord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    typeof record.lat === 'number' &&
    Number.isFinite(record.lat) &&
    typeof record.lon === 'number' &&
    Number.isFinite(record.lon)
  ) {
    return { lat: record.lat, lng: record.lon };
  }

  if (
    typeof record.lat === 'number' &&
    Number.isFinite(record.lat) &&
    typeof record.lng === 'number' &&
    Number.isFinite(record.lng)
  ) {
    return { lat: record.lat, lng: record.lng };
  }

  return null;
}

function parseShape(shape: unknown): Coord[] {
  if (typeof shape === 'string' && shape.length > 0) {
    return decodePolyline(shape);
  }

  if (Array.isArray(shape)) {
    const coords: Coord[] = [];
    for (const entry of shape) {
      if (Array.isArray(entry) && entry.length >= 2) {
        const lng = Number(entry[0]);
        const lat = Number(entry[1]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          coords.push({ lat, lng });
        }
        continue;
      }

      const objectCoord = asCoord(entry);
      if (objectCoord) {
        coords.push(objectCoord);
      }
    }
    return coords;
  }

  if (shape && typeof shape === 'object') {
    const record = shape as Record<string, unknown>;
    if (record.type === 'LineString' && Array.isArray(record.coordinates)) {
      return parseShape(record.coordinates);
    }
  }

  return [];
}

function mergeLegShapes(legs: unknown[]): Coord[] {
  const merged: Coord[] = [];

  for (const leg of legs) {
    if (!leg || typeof leg !== 'object') {
      continue;
    }

    const shape = (leg as Record<string, unknown>).shape;
    const legCoords = parseShape(shape);
    if (legCoords.length === 0) {
      continue;
    }

    for (const coord of legCoords) {
      const last = merged[merged.length - 1];
      if (!last || last.lat !== coord.lat || last.lng !== coord.lng) {
        merged.push(coord);
      }
    }
  }

  return merged;
}

function routeDistanceFromCoords(coords: Coord[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    total += haversineMeters(coords[i - 1], coords[i]);
  }
  return total;
}

function pickDurationSec(trip: Record<string, unknown>): number {
  const summary = trip.summary;
  if (summary && typeof summary === 'object') {
    const time = (summary as Record<string, unknown>).time;
    if (typeof time === 'number' && Number.isFinite(time)) {
      return time;
    }
  }

  const legs = trip.legs;
  if (!Array.isArray(legs)) {
    return 0;
  }

  let total = 0;
  for (const leg of legs) {
    if (!leg || typeof leg !== 'object') {
      continue;
    }

    const summaryObj = (leg as Record<string, unknown>).summary;
    if (!summaryObj || typeof summaryObj !== 'object') {
      continue;
    }

    const time = (summaryObj as Record<string, unknown>).time;
    if (typeof time === 'number' && Number.isFinite(time)) {
      total += time;
    }
  }

  return total;
}

function pickDistanceMeters(trip: Record<string, unknown>, fallbackCoords: Coord[]): number {
  const summary = trip.summary;
  if (summary && typeof summary === 'object') {
    const lengthKm = (summary as Record<string, unknown>).length;
    if (typeof lengthKm === 'number' && Number.isFinite(lengthKm)) {
      return lengthKm * 1000;
    }
  }

  return routeDistanceFromCoords(fallbackCoords);
}

export async function routeWithStadia(points: Coord[]): Promise<InternalRouteResult> {
  if (points.length < 2) {
    throw new Error('At least 2 points are required for routing');
  }

  const body = JSON.stringify({
    locations: points.map((point) => ({ lat: point.lat, lon: point.lng })),
    costing: 'pedestrian',
    shape_format: 'polyline6',
    directions_options: {
      units: 'kilometers'
    }
  });

  const request = (pathname: string): Promise<Response> =>
    fetch(buildStadiaUrl(pathname), {
      method: 'POST',
      headers: {
        ...getStadiaAuthHeaders(),
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body,
      cache: 'no-store'
    });

  let response = await request('/route/v1');
  if (response.status === 404) {
    response = await request('/route/v1/route');
  }
  if (!response.ok) {
    const detail = await stadiaErrorDetail(response);
    throw new Error(`Stadia route error ${response.status}: ${detail}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const trip = payload.trip;
  if (!trip || typeof trip !== 'object') {
    throw new Error('Stadia response missing trip object');
  }

  const tripObj = trip as Record<string, unknown>;
  const legs = Array.isArray(tripObj.legs) ? tripObj.legs : [];

  let coords = mergeLegShapes(legs);
  if (coords.length < 2) {
    coords = parseShape(tripObj.shape);
  }

  if (coords.length < 2) {
    throw new Error('Stadia response missing route shape');
  }

  const durationSec = pickDurationSec(tripObj);
  const distanceM = pickDistanceMeters(tripObj, coords);

  return {
    polyline: encodePolyline(coords, 6),
    durationSec,
    distanceM,
    coords
  };
}
