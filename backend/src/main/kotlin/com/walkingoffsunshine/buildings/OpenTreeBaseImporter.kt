package com.walkingoffsunshine.buildings

import com.fasterxml.jackson.core.JsonParser
import com.fasterxml.jackson.core.JsonToken
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.net.URI
import kotlin.math.sqrt

/**
 * One-time importer that downloads the OpenTreeBase national tree dataset (GeoJSON),
 * converts it into the same [TreeOverpassResponse] tile format used by [TreeFetcher],
 * and writes each tile to GCS. After import, [TreeFetcher] serves Israeli trees
 * from GCS cache without hitting Overpass.
 *
 * Data source: https://opentreebase.datacity.org.il/dataset/trees_processed
 * License: ODbL
 */
@Service
class OpenTreeBaseImporter(
    private val gcsTileStore: GcsTileStore,
    private val objectMapper: ObjectMapper,
    @Value("\${shadow.default-tree-height}") private val defaultTreeHeight: Double,
) {
    private val log = LoggerFactory.getLogger(OpenTreeBaseImporter::class.java)

    companion object {
        const val GEOJSON_URL =
            "https://s3.eu-west-2.wasabisys.com/opentreebase-public/processed/trees/trees.geojson"
        private const val GCS_PREFIX = "trees"
    }

    data class ImportResult(
        val treesProcessed: Int,
        val treesSkipped: Int,
        val tilesWritten: Int,
        val durationMs: Long,
    )

    /**
     * Streams the OpenTreeBase GeoJSON, groups trees into tiles, and writes each tile to GCS.
     * Overwrites existing tree tiles for the covered area (OpenTreeBase is richer than OSM for Israel).
     */
    fun import(): ImportResult {
        val start = System.currentTimeMillis()
        log.info("Starting OpenTreeBase import from {}", GEOJSON_URL)

        val tileMap = HashMap<TileKey, MutableList<TreeOverpassElement>>()
        var processed = 0
        var skipped = 0

        URI(GEOJSON_URL).toURL().openStream().buffered().use { input ->
            val parser: JsonParser = objectMapper.factory.createParser(input)
            advanceToFeaturesArray(parser)

            while (parser.nextToken() != JsonToken.END_ARRAY) {
                if (parser.currentToken() != JsonToken.START_OBJECT) continue

                val feature: JsonNode = objectMapper.readTree(parser)
                val element = parseFeature(feature)
                if (element == null) {
                    skipped++
                    continue
                }

                val tile = TileKey(snapToTile(element.lat!!), snapToTile(element.lon!!))
                tileMap.getOrPut(tile) { mutableListOf() }.add(element)
                processed++

                if (processed % 500_000 == 0) {
                    log.info("OpenTreeBase import progress: {} trees, {} tiles so far", processed, tileMap.size)
                }
            }
        }

        log.info("Parsed {} trees into {} tiles, writing to GCS...", processed, tileMap.size)

        var tilesWritten = 0
        for ((tile, elements) in tileMap) {
            gcsTileStore.write(GCS_PREFIX, tile, TreeOverpassResponse(elements = elements))
            tilesWritten++
            if (tilesWritten % 1000 == 0) {
                log.info("GCS write progress: {}/{} tiles", tilesWritten, tileMap.size)
            }
        }

        val duration = System.currentTimeMillis() - start
        log.info("OpenTreeBase import complete: {} trees -> {} tiles in {}s", processed, tilesWritten, duration / 1000)
        return ImportResult(processed, skipped, tilesWritten, duration)
    }

    private fun parseFeature(feature: JsonNode): TreeOverpassElement? {
        val geometry = feature.get("geometry") ?: return null
        if (geometry.get("type")?.asText() != "Point") return null
        val coords = geometry.get("coordinates") ?: return null
        val lon = coords.get(0)?.asDouble() ?: return null
        val lat = coords.get(1)?.asDouble() ?: return null

        val props = feature.get("properties")
        val tags = mutableMapOf<String, String>()

        // Height
        val heightNode = props?.get("attributes-height")
        if (heightNode != null && !heightNode.isNull) {
            tags["height"] = heightNode.asText()
        }

        // Canopy diameter: prefer explicit, else derive from area (diameter = 2*sqrt(area/pi))
        val diamNode = props?.get("attributes-canopy-diameter")
        val areaNode = props?.get("attributes-canopy-area")
        val canopyDiameter = when {
            diamNode != null && !diamNode.isNull && diamNode.asDouble() > 0 -> diamNode.asDouble()
            areaNode != null && !areaNode.isNull && areaNode.asDouble() > 0 -> 2.0 * sqrt(areaNode.asDouble() / Math.PI)
            else -> null
        }
        canopyDiameter?.let { tags["canopy_diameter"] = "%.1f".format(it) }

        return TreeOverpassElement(type = "node", lat = lat, lon = lon, tags = tags)
    }

    private fun advanceToFeaturesArray(parser: JsonParser) {
        while (parser.nextToken() != null) {
            if (parser.currentToken() == JsonToken.FIELD_NAME && parser.currentName() == "features") {
                val next = parser.nextToken()
                if (next == JsonToken.START_ARRAY) return
            }
        }
        throw IllegalStateException("Could not find 'features' array in GeoJSON")
    }
}
