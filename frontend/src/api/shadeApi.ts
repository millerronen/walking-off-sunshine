import type { RoutesRequest, RoutesResponse } from "../types";

/**
 * POST /api/routes
 * Fetches shade-tiered walking routes from the backend.
 */
export async function fetchShadeRoutes(
  request: RoutesRequest
): Promise<RoutesResponse> {
  const base = import.meta.env.VITE_API_BASE_URL ?? "";
  const response = await fetch(`${base}/api/routes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(
      `API error ${response.status}: ${text}`
    );
  }

  return response.json() as Promise<RoutesResponse>;
}
