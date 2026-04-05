package com.walkingoffsunshine

import com.walkingoffsunshine.api.LatLon
import com.walkingoffsunshine.buildings.Building
import com.walkingoffsunshine.shadow.haversineMeters
import com.walkingoffsunshine.sun.SunPosition
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.locationtech.jts.geom.Coordinate
import org.locationtech.jts.geom.GeometryFactory
import kotlin.math.tan
import kotlin.math.sin
import kotlin.math.cos

class ShadowScorerTest {

    private val geometryFactory = GeometryFactory()

    @Test
    fun `haversine distance - known TLV points`() {
        // Rothschild Blvd start and end — roughly 1km
        val a = LatLon(32.0637, 34.7734)
        val b = LatLon(32.0637, 34.7834)
        val dist = haversineMeters(a, b)

        println("Distance = ${dist}m")
        assertTrue(dist in 700.0..1100.0, "Expected ~900m, got $dist")
    }

    @Test
    fun `shadow length grows as sun gets lower`() {
        val buildingHeightM = 20.0

        // High elevation (summer noon ~75°) → short shadow
        val highSun = SunPosition(azimuth = 180.0, elevation = 75.0)
        val longShadow = SunPosition(azimuth = 180.0, elevation = 15.0)

        val shortLen = buildingHeightM / tan(Math.toRadians(highSun.elevation))
        val longLen = buildingHeightM / tan(Math.toRadians(longShadow.elevation))

        println("Shadow at 75° elevation: ${shortLen}m")
        println("Shadow at 15° elevation: ${longLen}m")

        assertTrue(longLen > shortLen, "Lower sun should cast longer shadow")
        assertTrue(shortLen < 10.0, "High summer sun shadow should be short (<10m for 20m building)")
        assertTrue(longLen > 60.0, "Low sun shadow should be long (>60m for 20m building)")
    }

    @Test
    fun `shadow direction is opposite to sun azimuth`() {
        // Sun coming from east (azimuth ~90°) → shadow goes west (270°)
        val sunAzimuth = 90.0
        val expectedShadowDir = (sunAzimuth + 180) % 360

        assertEquals(270.0, expectedShadowDir, "Shadow should be cast westward when sun is in the east")
    }
}
