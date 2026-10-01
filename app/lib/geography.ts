export type GeoPoint = { latitude: number; longitude: number };
export type GeographySource = {
  version: string;
  url: string;
  license: string;
  attribution: string;
  sha256: string;
  publishedAt: string;
};
export type Locality = {
  id: string;
  postcode: string;
  state: string;
  suburb: string;
  hasCoordinates: boolean;
};
export type LocalityLookup = {
  source: GeographySource | null;
  localities: Locality[];
};

function validPoint(point: GeoPoint | null | undefined): point is GeoPoint {
  return Boolean(point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180);
}

/** Spherical straight-line approximation in km. Missing/invalid is never zero. */
export function straightLineKm(a: GeoPoint | null | undefined, b: GeoPoint | null | undefined): number | null {
  if (!validPoint(a) || !validPoint(b)) return null;
  const rad = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2
    + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad)
    * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}

export function nearestPracticeLocation(origin: GeoPoint | null, locations: readonly {
  id: string; point: GeoPoint | null; precision: string;
}[]): { locationId: string; distanceKm: number; precision: string } | null {
  let nearest: { locationId: string; distanceKm: number; precision: string } | null = null;
  for (const location of locations) {
    const distanceKm = straightLineKm(origin, location.point);
    if (distanceKm !== null && (!nearest || distanceKm < nearest.distanceKm
      || (distanceKm === nearest.distanceKm && location.id < nearest.locationId))) {
      nearest = { locationId: location.id, distanceKm, precision: location.precision };
    }
  }
  return nearest;
}
