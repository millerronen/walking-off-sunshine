package com.walkingoffsunshine.buildings

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import org.locationtech.jts.geom.Coordinate
import org.locationtech.jts.geom.GeometryFactory
import org.locationtech.jts.geom.Polygon
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import org.springframework.web.reactive.function.client.WebClient

/**
 * A building footprint with height, represented as a JTS Polygon in WGS84 (lon, lat) coordinates.
 */
data class Building(
    val footprint: Polygon,
    val heightMeters: Double,
)

/**
 * Tile size in degrees. ~500m x ~500m at TLV latitude — small enough for fast Overpass
 * queries, large enough that a typical walking route hits only a handful of tiles.
 */
private const val TILE_SIZE_DEG = 0.005

/** Snaps a coordinate down to the nearest tile origin. */
private fun snapToTile(coord: Double): Double = Math.floor(coord / TILE_SIZE_DEG) * TILE_SIZE_DEG

data class TileKey(val southTile: Double, val westTile: Double)

@Service
class BuildingFetcher(
    private val webClient: WebClient,
    @Value("\${overpass.urls}") private val overpassUrlsCsv: String,
    @Value("\${shadow.default-building-height}") private val defaultHeight: Double,
) {
    private val log = LoggerFactory.getLogger(BuildingFetcher::class.java)
    private val geometryFactory = GeometryFactory()
    private val overpassUrls by lazy { overpassUrlsCsv.split(",").map { it.trim() } }

    /**
     * In-memory tile cache. Each entry covers a ~500x500m square and lives for the
     * lifetime of the process. On Cloud Run, a fresh instance fetches cold; subsequent
     * requests within the same instance are instant.
     */
    private val tileCache = java.util.concurrent.ConcurrentHashMap<TileKey, List<Building>>()

    /**
     * Returns all buildings covering a bounding box, fetching any uncached tiles from Overpass.
     */
    fun fetchBuildings(south: Double, west: Double, north: Double, east: Double): List<Building> {
        val tiles = tilesFor(south, west, north, east)
        return tiles.flatMap { tile ->
            tileCache.getOrPut(tile) { fetchTile(tile) }
        }.distinctBy { it.footprint.toText() }   // deduplicate buildings that span tile borders
    }

    private fun fetchTile(tile: TileKey): List<Building> {
        val s = tile.southTile
        val w = tile.westTile
        val n = s + TILE_SIZE_DEG
        val e = w + TILE_SIZE_DEG

        val query = "[out:json][timeout:20];way[\"building\"]($s,$w,$n,$e);out body geom;"
        val encoded = "data=${java.net.URLEncoder.encode(query, "UTF-8")}"

        // Try each mirror in order, return first success
        for (url in overpassUrls) {
            val result = runCatching {
                webClient.post()
                    .uri(url)
                    .bodyValue(encoded)
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .retrieve()
                    .bodyToMono(OverpassResponse::class.java)
                    .block()
            }

            result.onFailure { log.error("Overpass request to $url failed: ${it.message}") }

            val response = result.getOrNull()
            if (response != null) {
                val buildings = response.elements.mapNotNull { it.toBuilding(geometryFactory, defaultHeight) }
                log.info("Tile ($s,$w): fetched ${response.elements.size} elements → ${buildings.size} buildings from $url")
                return buildings
            }
        }

        log.warn("All Overpass mirrors failed for tile ($s,$w)")
        return emptyList()
    }

    /** Returns all tile keys that overlap the given bounding box. */
    private fun tilesFor(south: Double, west: Double, north: Double, east: Double): List<TileKey> {
        val tiles = mutableListOf<TileKey>()
        var lat = snapToTile(south)
        while (lat <= north) {
            var lon = snapToTile(west)
            while (lon <= east) {
                tiles.add(TileKey(lat, lon))
                lon += TILE_SIZE_DEG
            }
            lat += TILE_SIZE_DEG
        }
        return tiles
    }
}

// ---------- Overpass JSON parsing ----------

@JsonIgnoreProperties(ignoreUnknown = true)
data class OverpassResponse(val elements: List<OverpassElement> = emptyList())

@JsonIgnoreProperties(ignoreUnknown = true)
data class OverpassElement(
    val type: String = "",
    val geometry: List<OverpassNode> = emptyList(),
    val tags: Map<String, String> = emptyMap(),
) {
    fun toBuilding(geometryFactory: GeometryFactory, defaultHeight: Double): Building? {
        if (type != "way" || geometry.size < 3) return null

        val height = resolveHeight(tags, defaultHeight)

        // JTS uses (x=lon, y=lat) convention
        val coords = geometry.map { Coordinate(it.lon, it.lat) }.toMutableList()
        // Polygons must be closed
        if (coords.first() != coords.last()) coords.add(coords.first())
        if (coords.size < 4) return null

        val ring = geometryFactory.createLinearRing(coords.toTypedArray())
        val polygon = geometryFactory.createPolygon(ring)
        return Building(footprint = polygon, heightMeters = height)
    }
}

@JsonIgnoreProperties(ignoreUnknown = true)
data class OverpassNode(val lat: Double = 0.0, val lon: Double = 0.0)

/**
 * Resolves building height from OSM tags.
 * Priority: `height` → `building:height` → `building:levels` * 3.5m → default
 */
private fun resolveHeight(tags: Map<String, String>, default: Double): Double {
    tags["height"]?.toDoubleOrNull()?.let { return it }
    tags["building:height"]?.toDoubleOrNull()?.let { return it }
    tags["building:levels"]?.toDoubleOrNull()?.let { return it * 3.5 }
    return default
}
