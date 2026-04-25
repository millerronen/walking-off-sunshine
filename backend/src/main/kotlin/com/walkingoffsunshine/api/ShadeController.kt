package com.walkingoffsunshine.api

import com.walkingoffsunshine.routes.GoogleRoutesClient
import com.walkingoffsunshine.shadow.ShadowScorer
import com.walkingoffsunshine.sun.SunPositionService
import com.walkingoffsunshine.weather.WeatherCondition
import com.walkingoffsunshine.weather.WeatherService
import org.slf4j.LoggerFactory
import org.springframework.web.bind.annotation.*
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sqrt

private const val CACHE_TTL_MS = 20 * 60 * 1000L  // 20 minutes

@CrossOrigin(origins = ["*"])
@RestController
@RequestMapping("/api")
class ShadeController(
    private val shadowScorer: ShadowScorer,
    private val googleRoutesClient: GoogleRoutesClient,
    private val weatherService: WeatherService,
    private val sunPositionService: SunPositionService,
) {
    private val log = LoggerFactory.getLogger(ShadeController::class.java)
    private val executor = com.walkingoffsunshine.MdcExecutor.cachedThreadPool()
    private val routeCache = ConcurrentHashMap<String, Pair<Long, RouteResponse>>()

    /**
     * Scores an existing polyline for shade.
     * Use this when you already have a route and want to know how shaded it is.
     *
     * POST /api/shade
     */
    @PostMapping("/debug-routes")
    fun debugRoutes(@RequestBody request: RouteRequest): Map<String, Any> {
        val directCandidates = googleRoutesClient.fetchWalkingRoutes(request.origin, request.destination)
        val shortestDistance = directCandidates.minOfOrNull { it.distanceMeters }?.toDouble() ?: 0.0
        val waypoints = perpendicularWaypoints(request.origin, request.destination, shortestDistance)
        val waypointResults = waypoints.map { wp ->
            val r = googleRoutesClient.fetchWalkingRouteViaWaypoint(request.origin, wp, request.destination)
            mapOf("waypoint" to wp, "result" to (if (r == null) "null" else "${r.distanceMeters}m ${r.polyline.size}pts key=${routeKey(r)}"))
        }
        val allCandidates = (directCandidates + waypointResults.mapNotNull {
            googleRoutesClient.fetchWalkingRouteViaWaypoint(request.origin, (it["waypoint"] as LatLon), request.destination)
        }).distinctBy { routeKey(it) }
        return mapOf(
            "directCount" to directCandidates.size,
            "directDistances" to directCandidates.map { it.distanceMeters },
            "waypoints" to waypointResults,
            "shortestDistance" to shortestDistance,
            "maxAllowed" to shortestDistance * 1.50,
            "candidatesAfterDedup" to allCandidates.size,
            "candidateDistances" to allCandidates.map { it.distanceMeters },
        )
    }

    @PostMapping("/shade")
    fun scoreShade(@RequestBody request: ShadeRequest): ShadeResponse {
        val dt = request.datetime ?: ZonedDateTime.now()
        val segments = shadowScorer.scorePolyline(request.polyline, dt)

        val totalDistance = segments.sumOf { it.distanceMeters }
        val overallShade = if (totalDistance == 0.0) 0.0 else
            segments.sumOf { it.shadeScore * it.distanceMeters } / totalDistance

        return ShadeResponse(
            segments = segments,
            overallShadeScore = overallShade,
            totalDistanceMeters = totalDistance,
        )
    }

    /**
     * Finds shade-optimized walking routes between two points.
     * Returns up to 4 routes targeting 25/50/75/100% shade, each within +30% of shortest distance.
     *
     * POST /api/routes
     */
    @PostMapping("/routes")
    fun findRoutes(@RequestBody request: RouteRequest): RouteResponse {
        val t0 = System.currentTimeMillis()
        fun ms() = System.currentTimeMillis() - t0

        val dt = request.datetime ?: ZonedDateTime.now()
        log.info("REQUEST /routes origin=(${request.origin.lat},${request.origin.lon}) dest=(${request.destination.lat},${request.destination.lon}) dt=$dt cacheSize=${routeCache.size}")

        // Return cached response if available (same origin/dest/hour, within 20 min)
        val cacheKey = routeCacheKey(request.origin, request.destination, dt)
        routeCache[cacheKey]?.let { (timestamp, cached) ->
            if (System.currentTimeMillis() - timestamp < CACHE_TTL_MS) {
                log.info("TIMING cache_hit total=${ms()}ms")
                return cached
            }
            routeCache.remove(cacheKey)
        }

        // Check sun position early — if nighttime, shade scoring is meaningless
        val sunPos = sunPositionService.getPosition(request.origin.lat, request.origin.lon, dt)
        val isNight = !sunPos.isDaytime

        // Fire weather check in parallel — it will be ready by the time routes are fetched
        val hoursFromNow = abs(ChronoUnit.HOURS.between(ZonedDateTime.now(), dt))
        val weatherFuture = if (isNight) CompletableFuture.completedFuture(WeatherCondition.CLEAR)
        else if (hoursFromNow < 2)
            CompletableFuture.supplyAsync({ weatherService.getCondition(request.origin) }, executor)
        else
            CompletableFuture.completedFuture(WeatherCondition.CLEAR)

        // Fetch direct routes (blocks, but weather runs alongside it)
        val directCandidates = googleRoutesClient.fetchWalkingRoutes(request.origin, request.destination)
        log.info("TIMING direct_routes=${ms()}ms count=${directCandidates.size}")
        if (directCandidates.isEmpty()) {
            return RouteResponse(routes = emptyList(), shortestDistanceMeters = 0.0, weatherNote = null)
        }

        val shortestDistance = directCandidates.minOf { it.distanceMeters }.toDouble()

        // Resolve weather now (already in-flight alongside direct route fetch, so near-instant)
        val weatherCondition = weatherFuture.get()
        log.info("TIMING weather=${ms()}ms condition=$weatherCondition night=$isNight")

        // Circuit breaker: if nighttime or non-clear weather, shade doesn't vary — return only shortest route
        val skipShadeScoring = isNight || weatherCondition != WeatherCondition.CLEAR
        if (skipShadeScoring) {
            log.info("TIMING shortcut — night=$isNight weather=$weatherCondition — returning shortest only")
            val shortest = directCandidates.minByOrNull { it.distanceMeters }!!
            val tierRoutes = listOf(ShadeTierRoute(
                tierPercent = 100,
                shadeScore = 1.0,
                distanceMeters = shortest.distanceMeters.toDouble(),
                durationSeconds = shortest.durationSeconds,
                polyline = shortest.polyline,
            ))
            val weatherNote = if (isNight) "nighttime" else "overcast"
            val response = RouteResponse(routes = tierRoutes, shortestDistanceMeters = shortestDistance, weatherNote = weatherNote)
            routeCache[cacheKey] = Pair(System.currentTimeMillis(), response)
            log.info("TIMING total=${ms()}ms routes=1 (shortcut)")
            logRouteAnalytics(request.origin, request.destination, dt, 1.0, 1.0, shortestDistance, 1, weatherCondition, ms())
            return response
        }

        val maxAllowedDistance = shortestDistance * 1.50

        // Fetch waypoint routes in parallel for route diversity
        val waypointFutures = perpendicularWaypoints(request.origin, request.destination, shortestDistance).map { wp ->
            CompletableFuture.supplyAsync({
                googleRoutesClient.fetchWalkingRouteViaWaypoint(request.origin, wp, request.destination)
            }, executor)
        }
        val waypointCandidates = waypointFutures.mapNotNull { it.get() }.also {
            log.info("TIMING waypoint_routes=${ms()}ms count=${it.size}")
        }

        val candidates = (directCandidates + waypointCandidates).distinctBy { routeKey(it) }

        val filtered = candidates.filter { it.distanceMeters <= maxAllowedDistance }
        data class ScoredCandidate(
            val candidate: com.walkingoffsunshine.routes.CandidateRoute,
            val shade: Double,
            val totalDist: Double,
            val segmentScores: List<Double>,
        )
        val scored: List<ScoredCandidate> = run {
            val scoreFutures = filtered.map { candidate ->
                CompletableFuture.supplyAsync({
                    val segments = shadowScorer.scorePolyline(candidate.polyline, dt)
                    val totalDist = segments.sumOf { it.distanceMeters }
                    val shade = if (totalDist == 0.0) 0.0
                        else segments.sumOf { it.shadeScore * it.distanceMeters } / totalDist
                    ScoredCandidate(candidate, shade, totalDist, segments.map { it.shadeScore })
                }, executor)
            }
            scoreFutures.map { it.get() }.also {
                log.info("TIMING shadow_scoring=${ms()}ms candidates=${filtered.size}")
            }
        }

        // Return up to 2 routes: shadiest and shortest (if different).
        val shadiest = scored.maxByOrNull { it.shade }
        val shortest = scored.minByOrNull { it.candidate.distanceMeters }

        val tierRoutes = buildList {
            if (shadiest != null) {
                add(ShadeTierRoute(
                    tierPercent = 100,
                    shadeScore = shadiest.shade,
                    distanceMeters = shadiest.totalDist,
                    durationSeconds = shadiest.candidate.durationSeconds,
                    polyline = shadiest.candidate.polyline,
                    segmentShadeScores = shadiest.segmentScores,
                ))
            }
            if (shortest != null && shadiest != null && routeKey(shortest.candidate) != routeKey(shadiest.candidate)) {
                add(ShadeTierRoute(
                    tierPercent = 25,
                    shadeScore = shortest.shade,
                    distanceMeters = shortest.totalDist,
                    durationSeconds = shortest.candidate.durationSeconds,
                    polyline = shortest.candidate.polyline,
                    segmentShadeScores = shortest.segmentScores,
                ))
            }
        }

        val response = RouteResponse(routes = tierRoutes, shortestDistanceMeters = shortestDistance, weatherNote = null)
        routeCache[cacheKey] = Pair(System.currentTimeMillis(), response)
        log.info("TIMING total=${ms()}ms routes=${tierRoutes.size}")
        logRouteAnalytics(request.origin, request.destination, dt, shadiest?.shade, shortest?.shade, shortestDistance, tierRoutes.size, weatherCondition, ms())
        return response
    }

    private fun logRouteAnalytics(
        origin: LatLon, destination: LatLon, dt: ZonedDateTime,
        shadiestScore: Double?, shortestScore: Double?,
        shortestDistM: Double, routeCount: Int,
        weather: WeatherCondition, totalMs: Long,
    ) {
        // City-block precision (~100m) for privacy
        val oLat = "%.3f".format(origin.lat)
        val oLon = "%.3f".format(origin.lon)
        val dLat = "%.3f".format(destination.lat)
        val dLon = "%.3f".format(destination.lon)
        log.info("ANALYTICS route_request" +
            " origin=$oLat,$oLon dest=$dLat,$dLon" +
            " date=${dt.toLocalDate()} hour=${dt.hour}" +
            " shadiest=${"%.2f".format(shadiestScore ?: -1.0)}" +
            " shortest_shade=${"%.2f".format(shortestScore ?: -1.0)}" +
            " distance_m=${shortestDistM.toInt()}" +
            " routes=$routeCount weather=$weather latency_ms=$totalMs")
    }
}

private fun routeCacheKey(origin: LatLon, destination: LatLon, dt: ZonedDateTime): String {
    val o = "%.4f,%.4f".format(origin.lat, origin.lon)
    val d = "%.4f,%.4f".format(destination.lat, destination.lon)
    val h = dt.withZoneSameInstant(ZoneOffset.UTC).truncatedTo(ChronoUnit.HOURS)
    return "$o|$d|$h"
}

/** Dedup key: midpoint + distance. Routes taking different paths diverge in the middle. */
private fun routeKey(route: com.walkingoffsunshine.routes.CandidateRoute): String {
    val mid = route.polyline[route.polyline.size / 2]
    return "%.4f,%.4f|%d".format(mid.lat, mid.lon, route.distanceMeters)
}

/**
 * Generates candidate waypoints offset perpendicularly from the direct O→D line.
 * Two offsets (left/right) at two distances give 4 candidate detour routes.
 */
private fun perpendicularWaypoints(origin: LatLon, destination: LatLon, directDistanceM: Double): List<LatLon> {
    val offsetM = (directDistanceM * 0.3).coerceIn(30.0, 500.0)

    // Direction vector in degrees
    val dLat = destination.lat - origin.lat
    val dLon = destination.lon - origin.lon
    val norm = sqrt(dLat * dLat + dLon * dLon)
    if (norm < 1e-9) return emptyList()

    // Degree-per-meter conversion at mid-latitude
    val midLat = (origin.lat + destination.lat) / 2
    val latPerM = 1.0 / 110540.0
    val lonPerM = 1.0 / (111320.0 * cos(Math.toRadians(midLat)))

    // Unit perpendicular vector (rotated 90°) scaled by offsetM
    val perpLat = (-dLon / norm) * latPerM * offsetM
    val perpLon = (dLat / norm) * lonPerM * offsetM

    val midLon = (origin.lon + destination.lon) / 2

    return listOf(
        // Midpoint offset left and right
        LatLon(midLat + perpLat, midLon + perpLon),
        LatLon(midLat - perpLat, midLon - perpLon),
        // 1/3 point offset left, 2/3 point offset right (different detour shapes)
        LatLon(origin.lat + dLat / 3 + perpLat * 0.6, origin.lon + dLon / 3 + perpLon * 0.6),
        LatLon(origin.lat + dLat * 2 / 3 - perpLat * 0.6, origin.lon + dLon * 2 / 3 - perpLon * 0.6),
    )
}
