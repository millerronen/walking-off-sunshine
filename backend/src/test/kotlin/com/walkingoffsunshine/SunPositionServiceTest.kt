package com.walkingoffsunshine

import com.walkingoffsunshine.sun.SunPositionService
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class SunPositionServiceTest {

    private val service = SunPositionService()

    // Tel Aviv coords
    private val tlvLat = 32.0853
    private val tlvLon = 34.7818
    private val tlvZone = ZoneId.of("Asia/Jerusalem")

    @Test
    fun `summer noon - sun should be high in the sky and roughly southward`() {
        // True solar noon in Tel Aviv (UTC+3 DST, 34.78°E) is ~12:40 local
        val dt = ZonedDateTime.of(2025, 7, 15, 12, 40, 0, 0, tlvZone)
        val pos = service.getPosition(tlvLat, tlvLon, dt)

        println("Summer solar noon → elevation=${pos.elevation}°, azimuth=${pos.azimuth}°")

        assertTrue(pos.isDaytime, "Should be daytime at noon")
        // At 32°N in July, sun is very high — expect ~75–82°
        assertTrue(pos.elevation > 70, "Elevation should be >70° at summer noon, got ${pos.elevation}")
        // At true solar noon sun is near south (160–200°)
        assertTrue(pos.azimuth in 155.0..205.0, "Azimuth should be ~180° at solar noon, got ${pos.azimuth}")
    }

    @Test
    fun `summer clock noon (12h00) - sun should be SE, heading toward south`() {
        // At 12:00 local (UTC+3), true solar noon hasn't happened yet — sun is still SE
        val dt = ZonedDateTime.of(2025, 7, 15, 12, 0, 0, 0, tlvZone)
        val pos = service.getPosition(tlvLat, tlvLon, dt)

        println("Summer 12:00 local → elevation=${pos.elevation}°, azimuth=${pos.azimuth}°")

        assertTrue(pos.isDaytime)
        assertTrue(pos.elevation > 60, "Still high elevation at 12:00, got ${pos.elevation}")
        assertTrue(pos.azimuth in 100.0..180.0, "Sun should be SE at 12:00 local, got ${pos.azimuth}")
    }

    @Test
    fun `summer morning - sun should be in the east, lower elevation`() {
        val dt = ZonedDateTime.of(2025, 7, 15, 8, 0, 0, 0, tlvZone)
        val pos = service.getPosition(tlvLat, tlvLon, dt)

        println("Summer 8am → elevation=${pos.elevation}°, azimuth=${pos.azimuth}°")

        assertTrue(pos.isDaytime)
        assertTrue(pos.elevation in 15.0..45.0, "Elevation should be moderate at 8am, got ${pos.elevation}")
        // Sun is in the east (60–120°)
        assertTrue(pos.azimuth in 60.0..120.0, "Azimuth should be eastward at 8am, got ${pos.azimuth}")
    }

    @Test
    fun `winter noon - sun should be lower than summer`() {
        val summerDt = ZonedDateTime.of(2025, 7, 15, 12, 0, 0, 0, tlvZone)
        val winterDt = ZonedDateTime.of(2025, 1, 15, 12, 0, 0, 0, tlvZone)

        val summerPos = service.getPosition(tlvLat, tlvLon, summerDt)
        val winterPos = service.getPosition(tlvLat, tlvLon, winterDt)

        println("Summer noon elevation=${summerPos.elevation}°, Winter noon elevation=${winterPos.elevation}°")

        assertTrue(winterPos.elevation < summerPos.elevation,
            "Winter sun should be lower than summer. Winter=${winterPos.elevation}, Summer=${summerPos.elevation}")
        // Winter sun at TLV noon is around 35–40°
        assertTrue(winterPos.elevation in 30.0..50.0, "Winter noon elevation should be ~35-40°, got ${winterPos.elevation}")
    }

    @Test
    fun `midnight - should not be daytime`() {
        val dt = ZonedDateTime.of(2025, 7, 15, 0, 0, 0, 0, tlvZone)
        val pos = service.getPosition(tlvLat, tlvLon, dt)

        println("Midnight → elevation=${pos.elevation}°")
        assertFalse(pos.isDaytime, "Should not be daytime at midnight")
        assertTrue(pos.elevation < 0, "Elevation should be negative at midnight, got ${pos.elevation}")
    }
}
