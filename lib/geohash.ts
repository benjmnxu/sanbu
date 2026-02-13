const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohashEncode(lat: number, lng: number, precision = 7): string {
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;

  let hash = '';
  let bits = 0;
  let value = 0;
  let useLng = true;

  while (hash.length < precision) {
    if (useLng) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) {
        value = (value << 1) + 1;
        minLng = mid;
      } else {
        value = value << 1;
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        value = (value << 1) + 1;
        minLat = mid;
      } else {
        value = value << 1;
        maxLat = mid;
      }
    }

    useLng = !useLng;
    bits += 1;

    if (bits === 5) {
      hash += BASE32[value];
      bits = 0;
      value = 0;
    }
  }

  return hash;
}
