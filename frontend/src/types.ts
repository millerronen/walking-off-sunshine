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
}

/** Full response from POST /api/routes */
export interface RoutesResponse {
  routes: ShadeRoute[];
  shortestDistanceMeters: number;
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
  25: "#FFC107",   // amber / yellow
  50: "#FF7043",   // deep orange
  75: "#66BB6A",   // medium green
  100: "#1B5E20",  // dark green
};

export const TIER_LABELS: Record<TierPercent, string> = {
  25: "Least Shaded",
  50: "Fair",
  75: "Good",
  100: "Best",
};
