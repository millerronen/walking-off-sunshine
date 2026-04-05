package com.walkingoffsunshine.api

import java.time.ZonedDateTime

// ---------- Shared ----------

data class LatLon(val lat: Double, val lon: Double)

// ---------- POST /api/shade ----------

data class ShadeRequest(
    /** Raw path as list of [lat, lon] points */
    val polyline: List<LatLon>,
    /** If null, defaults to current time */
    val datetime: ZonedDateTime? = null,
)

data class ShadeResponse(
    val segments: List<ScoredSegment>,
    /** Weighted average shade across the full path (0.0 = full sun, 1.0 = full shade) */
    val overallShadeScore: Double,
    val totalDistanceMeters: Double,
)

data class ScoredSegment(
    val from: LatLon,
    val to: LatLon,
    val distanceMeters: Double,
    val shadeScore: Double,   // 0.0–1.0
)

// ---------- POST /api/routes ----------

data class RouteRequest(
    val origin: LatLon,
    val destination: LatLon,
    /** If null, defaults to current time */
    val datetime: ZonedDateTime? = null,
)

data class RouteResponse(
    /** Up to 4 tiers: best route achieving ≥25, ≥50, ≥75, 100% shade (within +30% distance) */
    val routes: List<ShadeTierRoute>,
    val shortestDistanceMeters: Double,
)

data class ShadeTierRoute(
    /** Target shade tier: 25, 50, 75, or 100 */
    val tierPercent: Int,
    val shadeScore: Double,
    val distanceMeters: Double,
    val durationSeconds: Int,
    val polyline: List<LatLon>,
)
