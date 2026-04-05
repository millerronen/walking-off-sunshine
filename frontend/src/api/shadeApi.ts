import type { RoutesRequest, RoutesResponse } from "../types";

/**
 * POST /api/routes
 * Fetches shade-tiered walking routes from the backend.
 */
export async function fetchShadeRoutes(
  request: RoutesRequest
): Promise<RoutesResponse> {
  const base = import.meta.env.VITE_API_BASE_URL ?? "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response: Response;
  try {
    response = await fetch(`${base}/api/routes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Request timed out. Check your connection and try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(
      `API error ${response.status}: ${text}`
    );
  }

  return response.json() as Promise<RoutesResponse>;
}
