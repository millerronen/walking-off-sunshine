package com.walkingoffsunshine.api

import com.walkingoffsunshine.routes.GoogleRoutesClient
import com.walkingoffsunshine.shadow.ShadowScorer
import com.walkingoffsunshine.shadow.haversineMeters
import com.walkingoffsunshine.weather.WeatherCondition
import com.walkingoffsunshine.weather.WeatherService
import org.springframework.web.bind.annotation.CrossOrigin
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sqrt
import org.slf4j.LoggerFactory

@CrossOrigin(origins = ["*"])
@RestController
@RequestMapping("/api")
class ShadeController(
    private val shadowScorer: ShadowScorer,
    private val googleRoutesClient: GoogleRoutesClient,
    private val weatherService: WeatherService,
) {
    private val log = LoggerFactory.getLogger(ShadeController::class.java)

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
        val dt = request.datetime ?: ZonedDateTime.now()

        // Check live weather only when the requested time is within 2 hours of now
        val hoursFromNow = abs(ChronoUnit.HOURS.between(ZonedDateTime.now(), dt))
        val weatherCondition = if (hoursFromNow < 2) weatherService.getCondition(request.origin) else WeatherCondition.CLEAR
        val weatherNote: String? = when (weatherCondition) {
            WeatherCondition.RAIN -> "It's raining — shade scores overridden to 100%"
            WeatherCondition.OVERCAST -> "Heavy cloud cover — routes are effectively fully shaded"
            WeatherCondition.CLEAR -> null
        }

        val directCandidates = googleRoutesClient.fetchWalkingRoutes(request.origin, request.destination)
        if (directCandidates.isEmpty()) {
            return RouteResponse(routes = emptyList(), shortestDistanceMeters = 0.0, weatherNote = weatherNote)
        }

        val shortestDistance = directCandidates.minOf { it.distanceMeters }.toDouble()
        val maxAllowedDistance = shortestDistance * 1.50

        // Generate perpendicular waypoints to force route diversity
        val waypoints = perpendicularWaypoints(request.origin, request.destination, shortestDistance)
        val waypointCandidates = waypoints.mapNotNull { wp ->
            val r = googleRoutesClient.fetchWalkingRouteViaWaypoint(request.origin, wp, request.destination)
            log.info("Waypoint $wp → ${if (r == null) "null" else "${r.distanceMeters}m, ${r.polyline.size} pts"}")
            r
        }

        log.info("directCandidates=${directCandidates.size} waypointCandidates=${waypointCandidates.size}")

        val candidates = (directCandidates + waypointCandidates)
            .distinctBy { routeKey(it) }

        log.info("candidates after dedup=${candidates.size} maxAllowed=${maxAllowedDistance}m")

        // Score all candidates within the distance budget
        val overrideShade = weatherCondition != WeatherCondition.CLEAR
        val scored = candidates
            .filter { it.distanceMeters <= maxAllowedDistance }
            .map { candidate ->
                val segments = shadowScorer.scorePolyline(candidate.polyline, dt)
                val totalDist = segments.sumOf { it.distanceMeters }
                val shade = if (overrideShade) 1.0
                    else if (totalDist == 0.0) 0.0
                    else segments.sumOf { it.shadeScore * it.distanceMeters } / totalDist
                Triple(candidate, shade, totalDist)
            }

        // Always return exactly 2 routes: shadiest and shortest.
        // Skip the shortest if it's the same route as the shadiest.
        val shadiest = scored.maxByOrNull { (_, shade, _) -> shade }
        val shortest = scored.minByOrNull { (candidate, _, _) -> candidate.distanceMeters }

        val tierRoutes = buildList {
            if (shadiest != null) {
                add(ShadeTierRoute(
                    tierPercent = 100,
                    shadeScore = shadiest.second,
                    distanceMeters = shadiest.third,
                    durationSeconds = shadiest.first.durationSeconds,
                    polyline = shadiest.first.polyline,
                ))
            }
            if (shortest != null && shadiest != null && routeKey(shortest.first) != routeKey(shadiest.first)) {
                add(ShadeTierRoute(
                    tierPercent = 25,
                    shadeScore = shortest.second,
                    distanceMeters = shortest.third,
                    durationSeconds = shortest.first.durationSeconds,
                    polyline = shortest.first.polyline,
                ))
            }
        }

        return RouteResponse(routes = tierRoutes, shortestDistanceMeters = shortestDistance, weatherNote = weatherNote)
    }
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
