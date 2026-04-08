package com.walkingoffsunshine.api

import com.walkingoffsunshine.buildings.PrewarmService
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/admin")
class AdminController(private val prewarmService: PrewarmService) {

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
}
