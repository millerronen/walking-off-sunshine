package com.walkingoffsunshine.buildings

import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.util.concurrent.Executors

@Service
class PrewarmService(
    private val buildingFetcher: BuildingFetcher,
    private val treeFetcher: TreeFetcher,
    private val gcsTileStore: GcsTileStore,
) {
    private val log = LoggerFactory.getLogger(PrewarmService::class.java)
    private val executor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "prewarm-worker").also { it.isDaemon = true }
    }

    /**
     * Starts a background job that fetches all missing building + tree tiles
     * for the given bounding box into GCS. Returns the number of tiles queued.
     */
    fun start(south: Double, west: Double, north: Double, east: Double): Int {
        val tiles = tilesFor(south, west, north, east)
        val missing = tiles.filter {
            !gcsTileStore.exists("buildings", it) || !gcsTileStore.exists("trees", it)
        }
        log.info("Prewarm: ${tiles.size} total tiles, ${missing.size} missing — starting background fetch")

        executor.submit {
            var done = 0
            for (tile in missing) {
                try {
                    val s = tile.southTile
                    val w = tile.westTile
                    val n = s + TILE_SIZE_DEG
                    val e = w + TILE_SIZE_DEG
                    if (!gcsTileStore.exists("buildings", tile)) buildingFetcher.fetchBuildings(s, w, n, e)
                    if (!gcsTileStore.exists("trees", tile))     treeFetcher.fetchTrees(s, w, n, e)
                    done++
                    if (done % 20 == 0) log.info("Prewarm progress: $done / ${missing.size}")
                    Thread.sleep(400) // ~2.5 tiles/sec — conservative Overpass rate limit
                } catch (ex: Exception) {
                    log.warn("Prewarm tile $tile failed: ${ex.message}")
                }
            }
            log.info("Prewarm complete: $done tiles written to GCS")
        }

        return missing.size
    }
}
