/**
 * Geo calculation utilities for delivery tracking & geofencing
 */

/** Check if coordinates are valid numbers within latitude/longitude boundaries */
export function isValidCoordinate(latitude: unknown, longitude: unknown): boolean {
  if (typeof latitude !== "number" || typeof longitude !== "number") return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  return true;
}

/**
 * Calculate distance in meters between two lat/lng pairs using the Haversine formula
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * Approximate default coordinates for key districts/divisions in Bangladesh
 * Used to provide sensible anchor pins when full geocoding is unconfigured.
 */
export const BD_DIVISION_COORDINATES: Record<string, { latitude: number; longitude: number }> = {
  // Divisions & Major Cities
  dhaka: { latitude: 23.8103, longitude: 90.4125 },
  chattogram: { latitude: 22.3569, longitude: 91.7832 },
  chittagong: { latitude: 22.3569, longitude: 91.7832 },
  sylhet: { latitude: 24.8949, longitude: 91.8687 },
  rajshahi: { latitude: 24.3745, longitude: 88.6042 },
  khulna: { latitude: 22.8456, longitude: 89.5403 },
  barishal: { latitude: 22.701, longitude: 90.3535 },
  barisal: { latitude: 22.701, longitude: 90.3535 },
  rangpur: { latitude: 25.7439, longitude: 89.2752 },
  mymensingh: { latitude: 24.7471, longitude: 90.4203 },
  cumilla: { latitude: 23.4607, longitude: 91.1809 },
  comilla: { latitude: 23.4607, longitude: 91.1809 },
  gazipur: { latitude: 23.9999, longitude: 90.4203 },
  narayanganj: { latitude: 23.6238, longitude: 90.5000 },
  bogura: { latitude: 24.8465, longitude: 89.3777 },
  bogra: { latitude: 24.8465, longitude: 89.3777 },
  jashore: { latitude: 23.1664, longitude: 89.2081 },
  jessore: { latitude: 23.1664, longitude: 89.2081 },
  coxsbazar: { latitude: 21.4272, longitude: 92.0058 },
  "cox's bazar": { latitude: 21.4272, longitude: 92.0058 },
  savar: { latitude: 23.8475, longitude: 90.2577 },
  tangail: { latitude: 24.2513, longitude: 89.9167 },
  pabna: { latitude: 24.0064, longitude: 89.2372 },
  kushtia: { latitude: 23.9013, longitude: 89.1205 },
  faridpur: { latitude: 23.6071, longitude: 89.8429 },
  dinajpur: { latitude: 25.6217, longitude: 88.6355 },

  // Dhaka Thanas & Major Hubs
  dhanmondi: { latitude: 23.7465, longitude: 90.376 },
  gulshan: { latitude: 23.7925, longitude: 90.4078 },
  banani: { latitude: 23.7937, longitude: 90.4066 },
  uttara: { latitude: 23.8759, longitude: 90.3795 },
  mirpur: { latitude: 23.8223, longitude: 90.3654 },
  motijheel: { latitude: 23.733, longitude: 90.4175 },
  mohammadpur: { latitude: 23.7658, longitude: 90.3584 },
  bashundhara: { latitude: 23.8164, longitude: 90.4373 },
  badda: { latitude: 23.7805, longitude: 90.4267 },
  farmgate: { latitude: 23.7561, longitude: 90.3872 },
  tejgaon: { latitude: 23.7598, longitude: 90.3923 },
  rampura: { latitude: 23.7612, longitude: 90.4208 },
  keraniganj: { latitude: 23.6828, longitude: 90.3428 },
};

/** Get approximate coordinates from address text if available */
export function getApproxCoordinatesFromAddress(addressText?: string): { latitude: number; longitude: number } | null {
  if (!addressText || typeof addressText !== "string") return null;
  const lower = addressText.toLowerCase();

  // Match longer, more specific subdistricts/thanas first before broader division names
  const sortedKeys = Object.keys(BD_DIVISION_COORDINATES).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (lower.includes(key)) {
      return BD_DIVISION_COORDINATES[key];
    }
  }
  return null;
}

/** Check if a target coordinate is within a specified radius (in meters) from a center coordinate */
export function isWithinRadius(
  centerLat: number,
  centerLng: number,
  targetLat: number,
  targetLng: number,
  radiusMeters: number
): boolean {
  if (!isValidCoordinate(centerLat, centerLng) || !isValidCoordinate(targetLat, targetLng)) {
    return false;
  }
  const dist = calculateDistanceMeters(centerLat, centerLng, targetLat, targetLng);
  return dist <= radiusMeters;
}

/** Format distance in meters into human-readable kilometers or meters */
export function formatDistance(distanceMeters: number): string {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return "0 m";
  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

/**
 * Calculate initial compass bearing from point A to point B in degrees (0 - 360)
 */
export function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);
  const bearing = ((theta * 180) / Math.PI + 360) % 360;

  return Math.round(bearing);
}

