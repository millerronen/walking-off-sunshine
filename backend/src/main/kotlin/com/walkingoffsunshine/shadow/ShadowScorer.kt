package com.walkingoffsunshine.shadow

import com.walkingoffsunshine.api.LatLon
import com.walkingoffsunshine.api.ScoredSegment
import com.walkingoffsunshine.buildings.Building
import com.walkingoffsunshine.buildings.BuildingFetcher
import com.walkingoffsunshine.buildings.TreeFetcher
import com.walkingoffsunshine.sun.SunPosition
import com.walkingoffsunshine.sun.SunPositionService
import org.locationtech.jts.geom.Coordinate
import org.locationtech.jts.geom.GeometryFactory
import org.locationtech.jts.geom.Polygon
import org.locationtech.jts.index.strtree.STRtree
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.time.ZonedDateTime
import java.util.concurrent.CompletableFuture
import kotlin.math.*

private val mdcExecutor = com.walkingoffsunshine.MdcExecutor.cachedThreadPool()

@Service
class ShadowScorer(
    private val sunPositionService: SunPositionService,
    private val buildingFetcher: BuildingFetcher,
    private val treeFetcher: TreeFetcher,
    @Value("\${shadow.building-fetch-buffer-meters}") private val bufferMeters: Double,
    @Value("\${shadow.tree-fetch-buffer-meters}") private val treeBufferMeters: Double,
    @Value("\${shadow.max-trees-per-scoring}") private val maxTreesPerScoring: Int,
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

        val t0 = System.currentTimeMillis()
        val buildingBbox = polyline.boundingBox(bufferMeters)
        val treeBbox = polyline.boundingBox(treeBufferMeters)
        val buildingsFuture = CompletableFuture.supplyAsync({
            buildingFetcher.fetchBuildings(buildingBbox.south, buildingBbox.west, buildingBbox.north, buildingBbox.east)
        }, mdcExecutor)
        val treesFuture = CompletableFuture.supplyAsync({
            treeFetcher.fetchTrees(treeBbox.south, treeBbox.west, treeBbox.north, treeBbox.east)
        }, mdcExecutor)
        val buildings = buildingsFuture.get()
        val t1 = System.currentTimeMillis()
        val allTrees = treesFuture.get()
        // Keep only trees close to the route, capped to avoid OOM
        val trees = filterNearRoute(allTrees, polyline, treeBufferMeters).let {
            if (it.size > maxTreesPerScoring) it.take(maxTreesPerScoring) else it
        }
        val t2 = System.currentTimeMillis()
        val shadowPolygons = (buildings + trees).mapNotNull { it.shadowPolygon(sunPos) }
        val t3 = System.currentTimeMillis()

        // Build spatial index for fast point-in-polygon queries (critical with 10K+ shadows)
        val shadowIndex = STRtree()
        shadowPolygons.forEach { shadowIndex.insert(it.envelopeInternal, it) }
        shadowIndex.build()

        log.info("SCORE buildings=${t1-t0}ms trees=${t2-t1}ms index=${System.currentTimeMillis()-t3}ms | b=${buildings.size} t=${trees.size}/${allTrees.size} shadows=${shadowPolygons.size}")

        return polyline.zipWithNext().map { (from, to) ->
            val dist = haversineMeters(from, to)
            val shade = sampleSegmentShade(from, to, shadowIndex)
            ScoredSegment(from = from, to = to, distanceMeters = dist, shadeScore = shade)
        }
    }

    /**
     * Samples N points along a segment and checks each against shadow polygons
     * using a spatial index for O(log n) lookup instead of O(n).
     */
    private fun sampleSegmentShade(from: LatLon, to: LatLon, shadowIndex: STRtree): Double {
        if (shadowIndex.size() == 0) return 0.0
        var shadedCount = 0

        repeat(samplesPerSegment) { i ->
            val t = (i + 0.5) / samplesPerSegment
            val lat = from.lat + t * (to.lat - from.lat)
            val lon = from.lon + t * (to.lon - from.lon)
            val point = geometryFactory.createPoint(Coordinate(lon, lat))
            val envelope = point.envelopeInternal
            @Suppress("UNCHECKED_CAST")
            val candidates = shadowIndex.query(envelope) as List<Polygon>
            if (candidates.any { it.contains(point) }) shadedCount++
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

/**
 * Filters buildings (trees) to only those within [maxDistMeters] of any segment in the polyline.
 * Sorted by distance so callers can .take(N) to cap count.
 */
private fun filterNearRoute(candidates: List<Building>, polyline: List<LatLon>, maxDistMeters: Double): List<Building> {
    if (candidates.isEmpty() || polyline.size < 2) return candidates
    return candidates
        .map { tree ->
            val centroid = tree.footprint.centroid
            val treePt = LatLon(centroid.y, centroid.x)
            val minDist = polyline.zipWithNext().minOf { (a, b) -> pointToSegmentDistance(treePt, a, b) }
            tree to minDist
        }
        .filter { it.second <= maxDistMeters }
        .sortedBy { it.second }
        .map { it.first }
}

/** Approximate distance in meters from point P to segment A–B. */
private fun pointToSegmentDistance(p: LatLon, a: LatLon, b: LatLon): Double {
    val dx = b.lon - a.lon
    val dy = b.lat - a.lat
    if (dx == 0.0 && dy == 0.0) return haversineMeters(p, a)
    val t = ((p.lon - a.lon) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy)
    val clamped = t.coerceIn(0.0, 1.0)
    val closest = LatLon(a.lat + clamped * dy, a.lon + clamped * dx)
    return haversineMeters(p, closest)
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
