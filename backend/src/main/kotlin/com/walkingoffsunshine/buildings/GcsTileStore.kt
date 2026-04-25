package com.walkingoffsunshine.buildings

import com.fasterxml.jackson.databind.ObjectMapper
import com.google.cloud.storage.BlobId
import com.google.cloud.storage.BlobInfo
import com.google.cloud.storage.Storage
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service

@Service
class GcsTileStore(
    private val storage: Storage,
    private val objectMapper: ObjectMapper,
    @Value("\${gcs.tile-bucket}") private val bucketName: String,
) {
    private val log = LoggerFactory.getLogger(GcsTileStore::class.java)

    fun <T> read(prefix: String, tile: TileKey, type: Class<T>): T? = try {
        val blob = storage.get(BlobId.of(bucketName, tileKey(prefix, tile)))
        blob?.getContent()?.let { objectMapper.readValue(it, type) }
    } catch (e: Exception) {
        log.info("GCS read miss for {}/{}: {}", prefix, tileKey(prefix, tile), e.message)
        null
    }

    fun write(prefix: String, tile: TileKey, data: Any) = try {
        val key = tileKey(prefix, tile)
        val bytes = objectMapper.writeValueAsBytes(data)
        storage.create(
            BlobInfo.newBuilder(bucketName, key).setContentType("application/json").build(),
            bytes
        )
        log.info("GCS write: {} ({}KB)", key, bytes.size / 1024)
    } catch (e: Exception) {
        log.warn("GCS write failed for {}/{}", prefix, tileKey(prefix, tile), e)
    }

    /** True if the tile already exists in GCS (used by warmup to skip existing tiles). */
    fun exists(prefix: String, tile: TileKey): Boolean = try {
        storage.get(BlobId.of(bucketName, tileKey(prefix, tile))) != null
    } catch (e: Exception) {
        false
    }

    private fun tileKey(prefix: String, tile: TileKey) =
        "tiles/$prefix/%.5f_%.5f.json".format(tile.southTile, tile.westTile)
}
