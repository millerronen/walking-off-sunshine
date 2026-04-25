package com.walkingoffsunshine.buildings

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import org.locationtech.jts.geom.Coordinate
import org.locationtech.jts.geom.GeometryFactory
import org.locationtech.jts.geom.Polygon
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import org.springframework.web.reactive.function.client.WebClient
import kotlin.math.cos

private const val DEFAULT_CANOPY_RADIUS_M = 4.0
private const val MAX_CANOPY_RADIUS_M = 25.0
private const val CIRCLE_SEGMENTS = 8  // buffer quadrant segments → 32-gon

@Service
class TreeFetcher(
    private val webClient: WebClient,
    private val gcsTileStore: GcsTileStore,
    @Value("\${overpass.urls}") private val overpassUrlsCsv: String,
    @Value("\${shadow.default-tree-height}") private val defaultTreeHeight: Double,
) {
    private val log = LoggerFactory.getLogger(TreeFetcher::class.java)
    private val geometryFactory = GeometryFactory()
    private val overpassUrls by lazy { overpassUrlsCsv.split(",").map { it.trim() } }
    private val tileCache = java.util.concurrent.ConcurrentHashMap<TileKey, List<Building>>()
    private val tileExecutor = com.walkingoffsunshine.MdcExecutor.cachedThreadPool()
    private val tileInFlight = java.util.concurrent.ConcurrentHashMap<TileKey, java.util.concurrent.CompletableFuture<List<Building>>>()

    fun fetchTrees(south: Double, west: Double, north: Double, east: Double): List<Building> {
        val tiles = tilesFor(south, west, north, east)
        val cached = tiles.count { tileCache.containsKey(it) }
        log.debug("Tree fetch: ${tiles.size} tiles ($cached cached, ${tiles.size - cached} to fetch), tileCache=${tileCache.size}")
        val futures = tiles.map { tile ->
            tileCache[tile]?.let { java.util.concurrent.CompletableFuture.completedFuture(it) }
                ?: tileInFlight.computeIfAbsent(tile) {
                    java.util.concurrent.CompletableFuture.supplyAsync({
                        fetchTile(tile).also { tileCache[tile] = it }
                    }, tileExecutor).also { f -> f.whenComplete { _, _ -> tileInFlight.remove(tile) } }
                }
        }
        return futures.flatMap { it.get() }.distinctBy {
            val env = it.footprint.envelopeInternal
            "${env.minX},${env.minY},${env.maxX},${env.maxY}"
        }
    }

    private fun fetchTile(tile: TileKey): List<Building> {
        val s = tile.southTile
        val w = tile.westTile
        val n = s + TILE_SIZE_DEG
        val e = w + TILE_SIZE_DEG

        // 1. Try GCS persistent cache
        val gcsResponse = gcsTileStore.read("trees", tile, TreeOverpassResponse::class.java)
        if (gcsResponse != null) {
            val trees = gcsResponse.elements.mapNotNull { it.toTree(geometryFactory, defaultTreeHeight) }
            log.info("Tree tile ($s,$w): ${trees.size} trees from GCS cache")
            return trees
        }

        // 2. Try Overpass mirrors
        val query = "[out:json][timeout:25];" +
            "(node[\"natural\"=\"tree\"]($s,$w,$n,$e);" +
            "way[\"natural\"=\"tree_row\"]($s,$w,$n,$e););" +
            "out body geom;"
        val encoded = "data=${java.net.URLEncoder.encode(query, "UTF-8")}"

        for (url in overpassUrls) {
            val result = runCatching {
                webClient.post()
                    .uri(url)
                    .bodyValue(encoded)
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .retrieve()
                    .bodyToMono(TreeOverpassResponse::class.java)
                    .block()
            }
            result.onFailure { log.error("Tree Overpass request to $url failed", it) }

            val response = result.getOrNull() ?: continue
            val trees = response.elements.mapNotNull { it.toTree(geometryFactory, defaultTreeHeight) }
            log.info("Tree tile ($s,$w): ${response.elements.size} elements → ${trees.size} trees from $url")
            // 3. Write to GCS for future use
            gcsTileStore.write("trees", tile, response)
            return trees
        }

        log.warn("All Overpass mirrors failed for tree tile ($s,$w)")
        return emptyList()
    }
}

// ---------- Overpass response models ----------

@JsonIgnoreProperties(ignoreUnknown = true)
data class TreeOverpassResponse(val elements: List<TreeOverpassElement> = emptyList())

@JsonIgnoreProperties(ignoreUnknown = true)
data class TreeOverpassElement(
    val type: String = "",
    val lat: Double? = null,
    val lon: Double? = null,
    val geometry: List<OverpassNode> = emptyList(),
    val tags: Map<String, String> = emptyMap(),
) {
    fun toTree(geometryFactory: GeometryFactory, defaultHeight: Double): Building? = when (type) {
        "node" -> nodeToTree(geometryFactory, defaultHeight)
        "way"  -> rowToTree(geometryFactory, defaultHeight)
        else   -> null
    }

    private fun nodeToTree(gf: GeometryFactory, defaultHeight: Double): Building? {
        val nodeLat = lat ?: return null
        val nodeLon = lon ?: return null
        val radius = resolveCanopyRadius(tags)
        val radiusDeg = radius / (111320.0 * cos(Math.toRadians(nodeLat)))
        val circle = gf.createPoint(Coordinate(nodeLon, nodeLat))
            .buffer(radiusDeg, CIRCLE_SEGMENTS) as? Polygon ?: return null
        val height = tags["height"]?.toDoubleOrNull() ?: defaultHeight
        return Building(footprint = circle, heightMeters = height)
    }

    private fun rowToTree(gf: GeometryFactory, defaultHeight: Double): Building? {
        if (geometry.size < 2) return null
        val coords = geometry.map { Coordinate(it.lon, it.lat) }.toTypedArray()
        val line = gf.createLineString(coords)
        val midLat = geometry.map { it.lat }.average()
        val radius = resolveCanopyRadius(tags)
        val radiusDeg = radius / (111320.0 * cos(Math.toRadians(midLat)))
        val buffered = line.buffer(radiusDeg, CIRCLE_SEGMENTS) as? Polygon ?: return null
        val height = tags["height"]?.toDoubleOrNull() ?: defaultHeight
        return Building(footprint = buffered, heightMeters = height)
    }
}

private fun resolveCanopyRadius(tags: Map<String, String>): Double {
    val diameter = tags["canopy_diameter"]?.toDoubleOrNull()
        ?: tags["diameter_crown"]?.toDoubleOrNull()
    val radius = diameter?.div(2.0) ?: DEFAULT_CANOPY_RADIUS_M
    return radius.coerceIn(0.5, MAX_CANOPY_RADIUS_M)
}
