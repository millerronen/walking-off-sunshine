import { Capacitor } from "@capacitor/core";
import type { RoutesRequest, RoutesResponse } from "../types";

const NATIVE_BACKEND = "https://walking-off-sunshine-backend-133268494307.europe-west1.run.app";

/**
 * POST /api/routes
 * Fetches shade-tiered walking routes from the backend.
 */
export async function fetchShadeRoutes(
  request: RoutesRequest
): Promise<RoutesResponse> {
  const base = Capacitor.isNativePlatform()
    ? NATIVE_BACKEND
    : (import.meta.env.VITE_API_BASE_URL ?? "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
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
      const e = new Error("Calculating shaded routes took longer than expected. Please try again.");
      e.name = "TimeoutError";
      throw e;
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
