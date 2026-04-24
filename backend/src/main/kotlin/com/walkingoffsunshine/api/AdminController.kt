package com.walkingoffsunshine.api

import com.walkingoffsunshine.buildings.OpenTreeBaseImporter
import com.walkingoffsunshine.buildings.PrewarmService
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/admin")
class AdminController(
    private val prewarmService: PrewarmService,
    private val openTreeBaseImporter: OpenTreeBaseImporter,
) {

    /**
     * Triggers a background GCS tile cache prewarm for a bounding box.
     * Returns immediately; the fetch runs in the background.
     *
     * Example: POST /api/admin/prewarm?south=31.95&west=34.72&north=32.20&east=34.90
     */
    @PostMapping("/prewarm")
    fun prewarm(
        @RequestParam south: Double,
        @RequestParam west: Double,
        @RequestParam north: Double,
        @RequestParam east: Double,
    ): Map<String, Any> {
        val queued = prewarmService.start(south, west, north, east)
        return mapOf("status" to "started", "tilesQueued" to queued)
    }

    /**
     * Imports the OpenTreeBase national tree dataset into the GCS tile cache.
     * Downloads ~1.6 GB GeoJSON, splits into tiles, and writes to GCS.
     * Blocks until complete — Cloud Run kills background threads after response.
     *
     * Example: POST /api/admin/import-opentreebase
     */
    @PostMapping("/import-opentreebase")
    fun importOpenTreeBase(): Map<String, Any> {
        val result = openTreeBaseImporter.import()
        return mapOf(
            "status" to "complete",
            "treesProcessed" to result.treesProcessed,
            "treesSkipped" to result.treesSkipped,
            "tilesWritten" to result.tilesWritten,
            "durationMs" to result.durationMs,
        )
    }
}
