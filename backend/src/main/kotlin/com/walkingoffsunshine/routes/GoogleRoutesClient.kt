package com.walkingoffsunshine.routes

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.walkingoffsunshine.api.LatLon
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import org.springframework.web.reactive.function.client.WebClient

private const val ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"

data class CandidateRoute(
    val polyline: List<LatLon>,
    val distanceMeters: Int,
    val durationSeconds: Int,
)

@Service
class GoogleRoutesClient(
    private val webClient: WebClient,
    @Value("\${google.maps.api-key}") private val apiKey: String,
) {
    private val log = LoggerFactory.getLogger(GoogleRoutesClient::class.java)

    /**
     * Fetches up to 3 candidate walking routes from Google Routes API.
     */
    fun fetchWalkingRoutes(origin: LatLon, destination: LatLon): List<CandidateRoute> {
        val t0 = System.currentTimeMillis()
        val requestBody = mapOf(
            "origin" to locationBody(origin),
            "destination" to locationBody(destination),
            "travelMode" to "WALK",
            "computeAlternativeRoutes" to true,
            "routeModifiers" to emptyMap<String, Any>(),
        )

        val response = try {
            webClient.post()
                .uri(ROUTES_API_URL)
                .header("X-Goog-Api-Key", apiKey)
                .header("X-Goog-FieldMask", "routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration")
                .bodyValue(requestBody)
                .retrieve()
                .bodyToMono(RoutesApiResponse::class.java)
                .block()
        } catch (e: Exception) {
            log.error("Routes API direct request failed: (${origin.lat},${origin.lon})->(${destination.lat},${destination.lon})", e)
            return emptyList()
        } ?: return emptyList()

        val routes = response.routes.map { route ->
            CandidateRoute(
                polyline = decodePolyline(route.polyline.encodedPolyline),
                distanceMeters = route.distanceMeters,
                durationSeconds = route.duration.trimEnd('s').toIntOrNull() ?: 0,
            )
        }
        log.info("Routes API direct: ${routes.size} routes, distances=${routes.map { it.distanceMeters }}, ${System.currentTimeMillis() - t0}ms")
        return routes
    }

    /**
     * Fetches a single walking route from Google Routes API via an intermediate waypoint.
     * Used to generate route diversity beyond what computeAlternativeRoutes provides.
     */
    fun fetchWalkingRouteViaWaypoint(origin: LatLon, waypoint: LatLon, destination: LatLon): CandidateRoute? {
        val t0 = System.currentTimeMillis()
        val requestBody = mapOf(
            "origin" to locationBody(origin),
            "destination" to locationBody(destination),
            "intermediates" to listOf(locationBody(waypoint)),
            "travelMode" to "WALK",
            "computeAlternativeRoutes" to false,
            "routeModifiers" to emptyMap<String, Any>(),
        )

        val response = try {
            webClient.post()
                .uri(ROUTES_API_URL)
                .header("X-Goog-Api-Key", apiKey)
                .header("X-Goog-FieldMask", "routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration")
                .bodyValue(requestBody)
                .retrieve()
                .bodyToMono(RoutesApiResponse::class.java)
                .block()
        } catch (e: Exception) {
            log.error("Routes API waypoint request failed: wp=(${waypoint.lat},${waypoint.lon})", e)
            return null
        } ?: return null

        val route = response.routes.firstOrNull()?.let { route ->
            CandidateRoute(
                polyline = decodePolyline(route.polyline.encodedPolyline),
                distanceMeters = route.distanceMeters,
                durationSeconds = route.duration.trimEnd('s').toIntOrNull() ?: 0,
            )
        }
        log.info("Routes API waypoint: ${if (route != null) "${route.distanceMeters}m" else "no route"}, ${System.currentTimeMillis() - t0}ms")
        return route
    }

    private fun locationBody(point: LatLon) = mapOf(
        "location" to mapOf(
            "latLng" to mapOf("latitude" to point.lat, "longitude" to point.lon)
        )
    )
}

// ---------- Google Routes API response models ----------

@JsonIgnoreProperties(ignoreUnknown = true)
data class RoutesApiResponse(val routes: List<RouteItem> = emptyList())

@JsonIgnoreProperties(ignoreUnknown = true)
data class RouteItem(
    val distanceMeters: Int = 0,
    val duration: String = "0s",
    val polyline: EncodedPolyline = EncodedPolyline(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class EncodedPolyline(val encodedPolyline: String = "")

// ---------- Google Encoded Polyline decoder ----------

/**
 * Decodes a Google Encoded Polyline string into a list of (lat, lon) points.
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
fun decodePolyline(encoded: String): List<LatLon> {
    val result = mutableListOf<LatLon>()
    var index = 0
    var lat = 0
    var lng = 0

    while (index < encoded.length) {
        lat += decodeChunk(encoded, index).also { index += it.second }.first
        lng += decodeChunk(encoded, index).also { index += it.second }.first
        result.add(LatLon(lat / 1e5, lng / 1e5))
    }
    return result
}

/** Decodes one variable-length integer chunk. Returns (value, charsConsumed). */
private fun decodeChunk(encoded: String, startIndex: Int): Pair<Int, Int> {
    var shift = 0
    var result = 0
    var index = startIndex
    var b: Int
    do {
        b = encoded[index++].code - 63
        result = result or ((b and 0x1f) shl shift)
        shift += 5
    } while (b >= 0x20)
    return Pair(if (result and 1 != 0) (result shr 1).inv() else result shr 1, index - startIndex)
}
