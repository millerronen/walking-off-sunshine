package com.walkingoffsunshine.sun

import org.springframework.stereotype.Service
import java.time.ZoneOffset
import java.time.ZonedDateTime
import kotlin.math.*

data class SunPosition(
    val azimuth: Double,    // degrees from North, clockwise (0–360)
    val elevation: Double,  // degrees above horizon (negative = below horizon / night)
) {
    val isDaytime: Boolean get() = elevation > 0
}

/**
 * Computes sun position using the NOAA Solar Position Algorithm.
 * Accurate to within ~0.01° for dates between 1950–2050.
 */
@Service
class SunPositionService {

    fun getPosition(lat: Double, lon: Double, dt: ZonedDateTime): SunPosition {
        val utc = dt.withZoneSameInstant(ZoneOffset.UTC)
        val jd = julianDay(utc)
        val jc = (jd - 2451545.0) / 36525.0  // Julian century from J2000.0

        // Geometric mean longitude of sun (degrees)
        val l0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360

        // Geometric mean anomaly (degrees)
        val m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc)
        val mRad = Math.toRadians(m)

        // Equation of center
        val c = sin(mRad) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
                sin(2 * mRad) * (0.019993 - 0.000101 * jc) +
                sin(3 * mRad) * 0.000289

        // Sun's true longitude → apparent longitude (corrected for aberration)
        val omega = 125.04 - 1934.136 * jc
        val lambda = (l0 + c) - 0.00569 - 0.00478 * sin(Math.toRadians(omega))

        // Mean obliquity of ecliptic
        val epsilon0 = 23.0 + (26.0 + (21.448 - jc * (46.8150 + jc * (0.00059 - jc * 0.001813))) / 60.0) / 60.0
        val epsilon = Math.toRadians(epsilon0 + 0.00256 * cos(Math.toRadians(omega)))

        // Sun declination
        val decl = asin(sin(epsilon) * sin(Math.toRadians(lambda)))

        // Equation of time (minutes)
        val y = tan(epsilon / 2).pow(2)
        val l0Rad = Math.toRadians(l0)
        val eqTime = 4 * Math.toDegrees(
            y * sin(2 * l0Rad)
                    - 2 * Math.toRadians(0.016708634 - jc * (0.000042037 + 0.0000001267 * jc)) * sin(mRad)
                    + 4 * y * Math.toRadians(0.016708634) * sin(mRad) * cos(2 * l0Rad)
                    - 0.5 * y * y * sin(4 * l0Rad)
                    - 1.25 * Math.toRadians(0.016708634).pow(2) * sin(2 * mRad)
        )

        // True solar time (minutes)
        val minuteOfDay = utc.hour * 60.0 + utc.minute + utc.second / 60.0
        val trueSolarTime = (minuteOfDay + eqTime + 4 * lon) % 1440

        // Hour angle (degrees)
        val hourAngle = if (trueSolarTime / 4 < 180) trueSolarTime / 4 - 180 else trueSolarTime / 4 + 180 - 360

        // Solar zenith angle
        val latRad = Math.toRadians(lat)
        val haRad = Math.toRadians(hourAngle)
        val cosZenith = sin(latRad) * sin(decl) + cos(latRad) * cos(decl) * cos(haRad)
        val zenithRad = acos(cosZenith.coerceIn(-1.0, 1.0))

        val elevation = 90.0 - Math.toDegrees(zenithRad)

        // Solar azimuth (degrees from North, clockwise)
        val azimuth = computeAzimuth(latRad, decl, zenithRad, cosZenith, hourAngle)

        return SunPosition(azimuth = azimuth, elevation = elevation)
    }

    private fun computeAzimuth(
        latRad: Double,
        decl: Double,
        zenithRad: Double,
        cosZenith: Double,
        hourAngle: Double,
    ): Double {
        val denominator = cos(latRad) * sin(zenithRad)
        if (abs(denominator) < 1e-10) {
            // Sun directly overhead or at nadir — azimuth is undefined, default to North
            return if (latRad > 0) 180.0 else 0.0
        }
        val azRaw = Math.toDegrees(acos(((sin(latRad) * cosZenith) - sin(decl)) / denominator))
        return if (hourAngle > 0) (azRaw + 180) % 360 else (540 - azRaw) % 360
    }

    private fun julianDay(utc: ZonedDateTime): Double {
        var year = utc.year
        var month = utc.monthValue
        val day = utc.dayOfMonth + utc.hour / 24.0 + utc.minute / 1440.0 + utc.second / 86400.0

        if (month <= 2) {
            year--
            month += 12
        }
        val a = year / 100
        val b = 2 - a + a / 4
        return floor(365.25 * (year + 4716)) + floor(30.6001 * (month + 1)) + day + b - 1524.5
    }
}
