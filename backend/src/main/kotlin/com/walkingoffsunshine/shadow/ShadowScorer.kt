package com.walkingoffsunshine.shadow

import com.walkingoffsunshine.api.LatLon
import com.walkingoffsunshine.api.ScoredSegment
import com.walkingoffsunshine.buildings.Building
import com.walkingoffsunshine.buildings.BuildingFetcher
import com.walkingoffsunshine.sun.SunPosition
import com.walkingoffsunshine.sun.SunPositionService
import org.locationtech.jts.geom.Coordinate
import org.locationtech.jts.geom.GeometryFactory
import org.locationtech.jts.geom.Polygon
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.time.ZonedDateTime
import kotlin.math.*

@Service
class ShadowScorer(
    private val sunPositionService: SunPositionService,
    private val buildingFetcher: BuildingFetcher,
    @Value("\${shadow.building-fetch-buffer-meters}") private val bufferMeters: Double,
    @Value("\${shadow.samples-per-segment}") private val samplesPerSegment: Int,
) {
    private val log = LoggerFactory.getLogger(ShadowScorer::class.java)
    private val geometryFactory = GeometryFactory()

    /**
     * Scores each segment of a polyline by shade fraction (0.0 = full sun, 1.0 = full shade).
     */
    fun scorePolyline(polyline: List<LatLon>, dt: ZonedDateTime): List<ScoredSegment> {
        if (polyline.size < 2) return emptyList()

        val sunPos = sunPositionService.getPosition(
            lat = polyline.first().lat,
            lon = polyline.first().lon,
            dt = dt,
        )

        // Night — everything is shaded (or rather, no sun to shade from)
        if (!sunPos.isDaytime) {
            return buildNightSegments(polyline)
        }

        val bbox = polyline.boundingBox(bufferMeters)
        val buildings = buildingFetcher.fetchBuildings(bbox.south, bbox.west, bbox.north, bbox.east)
        val shadowPolygons = buildings.mapNotNull { it.shadowPolygon(sunPos) }
        log.info("sun elev=${"%.1f".format(sunPos.elevation)}° az=${"%.1f".format(sunPos.azimuth)}° | buildings=${buildings.size} shadowPolygons=${shadowPolygons.size}")

        return polyline.zipWithNext().map { (from, to) ->
            val dist = haversineMeters(from, to)
            val shade = sampleSegmentShade(from, to, shadowPolygons)
            ScoredSegment(from = from, to = to, distanceMeters = dist, shadeScore = shade)
        }
    }

    /**
     * Samples N points along a segment and checks each against shadow polygons.
     */
    private fun sampleSegmentShade(from: LatLon, to: LatLon, shadowPolygons: List<Polygon>): Double {
        if (shadowPolygons.isEmpty()) return 0.0
        var shadedCount = 0

        repeat(samplesPerSegment) { i ->
            val t = (i + 0.5) / samplesPerSegment
            val lat = from.lat + t * (to.lat - from.lat)
            val lon = from.lon + t * (to.lon - from.lon)
            val point = geometryFactory.createPoint(Coordinate(lon, lat))
            if (shadowPolygons.any { it.contains(point) }) shadedCount++
        }

        return shadedCount.toDouble() / samplesPerSegment
    }

    private fun buildNightSegments(polyline: List<LatLon>): List<ScoredSegment> =
        polyline.zipWithNext().map { (from, to) ->
            ScoredSegment(
                from = from, to = to,
                distanceMeters = haversineMeters(from, to),
                shadeScore = 1.0, // no sun = effectively all shade
            )
        }
}

// ---------- Shadow polygon computation ----------

/**
 * Computes the shadow footprint of a building given sun position.
 *
 * Algorithm:
 *  1. Compute shadow vector: direction = (azimuth + 180°), length = height / tan(elevation)
 *  2. Convert shadow length (meters) to degree offsets at the building's latitude
 *  3. Shift each building vertex by the shadow vector
 *  4. Return convex hull of original + shifted vertices (the full shadow polygon)
 */
private fun Building.shadowPolygon(sun: SunPosition): Polygon? {
    if (sun.elevation <= 1.0) return null  // Too low, shadow infinitely long — skip

    val shadowLengthMeters = heightMeters / tan(Math.toRadians(sun.elevation))
    val shadowDirRad = Math.toRadians((sun.azimuth + 180.0) % 360.0)

    // Shadow vector in meters
    val dxMeters = shadowLengthMeters * sin(shadowDirRad)   // eastward
    val dyMeters = shadowLengthMeters * cos(shadowDirRad)   // northward

    val centroidLat = footprint.centroid.y
    val dxDeg = dxMeters / (111320.0 * cos(Math.toRadians(centroidLat)))
    val dyDeg = dyMeters / 110540.0

    val original = footprint.coordinates
    val shifted = original.map { Coordinate(it.x + dxDeg, it.y + dyDeg) }

    val allCoords = (original.toList() + shifted).toTypedArray()
    return footprint.factory.createMultiPointFromCoords(allCoords).convexHull() as? Polygon
}

// ---------- Geometry helpers ----------

data class BoundingBox(val south: Double, val west: Double, val north: Double, val east: Double)

/**
 * Expands a polyline's bounding box by [bufferMeters] on each side.
 */
private fun List<LatLon>.boundingBox(bufferMeters: Double): BoundingBox {
    val bufLat = bufferMeters / 110540.0
    val midLat = map { it.lat }.average()
    val bufLon = bufferMeters / (111320.0 * cos(Math.toRadians(midLat)))
    return BoundingBox(
        south = minOf { it.lat } - bufLat,
        west = minOf { it.lon } - bufLon,
        north = maxOf { it.lat } + bufLat,
        east = maxOf { it.lon } + bufLon,
    )
}

/** Haversine distance between two WGS84 points in meters. */
fun haversineMeters(a: LatLon, b: LatLon): Double {
    val r = 6371000.0
    val dLat = Math.toRadians(b.lat - a.lat)
    val dLon = Math.toRadians(b.lon - a.lon)
    val sinDLat = sin(dLat / 2)
    val sinDLon = sin(dLon / 2)
    val h = sinDLat * sinDLat + cos(Math.toRadians(a.lat)) * cos(Math.toRadians(b.lat)) * sinDLon * sinDLon
    return 2 * r * asin(sqrt(h))
}
