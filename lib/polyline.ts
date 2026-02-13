import type { Coord } from '@/lib/types';

function decodeWithPrecision(polyline: string, precision: number): Coord[] {
  const factor = 10 ** precision;
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coords: Coord[] = [];

  while (index < polyline.length) {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = polyline.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < polyline.length + 1);

    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;

    do {
      byte = polyline.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < polyline.length + 1);

    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    coords.push({ lat: lat / factor, lng: lng / factor });
  }

  return coords;
}

function isReasonable(coords: Coord[]): boolean {
  return (
    coords.length >= 2 &&
    coords.every(
      (coord) =>
        Number.isFinite(coord.lat) &&
        Number.isFinite(coord.lng) &&
        coord.lat >= -90 &&
        coord.lat <= 90 &&
        coord.lng >= -180 &&
        coord.lng <= 180
    )
  );
}

export function decodePolyline(polyline: string, preferredPrecision = 6): Coord[] {
  const tries = preferredPrecision === 6 ? [6, 5] : [5, 6];

  for (const precision of tries) {
    try {
      const decoded = decodeWithPrecision(polyline, precision);
      if (isReasonable(decoded)) {
        return decoded;
      }
    } catch {
      // Keep trying fallback precision.
    }
  }

  throw new Error('Unable to decode polyline');
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let encoded = '';

  while (v >= 0x20) {
    encoded += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }

  encoded += String.fromCharCode(v + 63);
  return encoded;
}

export function encodePolyline(coords: Coord[], precision = 6): string {
  const factor = 10 ** precision;
  let previousLat = 0;
  let previousLng = 0;
  let encoded = '';

  for (const coord of coords) {
    const lat = Math.round(coord.lat * factor);
    const lng = Math.round(coord.lng * factor);

    encoded += encodeValue(lat - previousLat);
    encoded += encodeValue(lng - previousLng);

    previousLat = lat;
    previousLng = lng;
  }

  return encoded;
}
