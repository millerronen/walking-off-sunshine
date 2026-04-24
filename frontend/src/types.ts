// ---------------------------------------------------------------------------
// Shared TypeScript types matching the backend API models
// ---------------------------------------------------------------------------

export type TierPercent = 25 | 50 | 75 | 100;

export interface LatLon {
  lat: number;
  lon: number;
}

/** A single route returned by the backend */
export interface ShadeRoute {
  tierPercent: TierPercent;
  /** 0.0 – 1.0 */
  shadeScore: number;
  distanceMeters: number;
  durationSeconds: number;
  /** Ordered list of points that form the route polyline */
  polyline: LatLon[];
  /** Per-segment shade score (0.0–1.0), one entry per consecutive polyline pair */
  segmentShadeScores?: number[];
}

/** Full response from POST /api/routes */
export interface RoutesResponse {
  routes: ShadeRoute[];
  shortestDistanceMeters: number;
  /** Non-null when current weather overrides shade scores (rain or heavy overcast) */
  weatherNote?: string;
}

/** Request body for POST /api/routes */
export interface RoutesRequest {
  origin: LatLon;
  destination: LatLon;
  /** ISO 8601 string */
  datetime: string;
}

// ---------------------------------------------------------------------------
// UI state types
// ---------------------------------------------------------------------------

export type AppStatus = "idle" | "loading" | "success" | "error";

/** Colours used to draw each tier's polyline on the map */
export const TIER_COLORS: Record<TierPercent, string> = {
  25: "#1565C0",   // blue — shortest route
  50: "#FF7043",   // deep orange (unused in 2-route mode)
  75: "#66BB6A",   // medium green (unused in 2-route mode)
  100: "#1B5E20",  // dark green — shadiest route
};

export const TIER_LABELS: Record<TierPercent, string> = {
  25: "Shortest Route",
  50: "Fair",
  75: "Good",
  100: "Most Shaded",
};
