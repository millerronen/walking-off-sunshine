package com.walkingoffsunshine.weather

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty
import com.walkingoffsunshine.api.LatLon
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.web.reactive.function.client.WebClient

enum class WeatherCondition { CLEAR, OVERCAST, RAIN }

@JsonIgnoreProperties(ignoreUnknown = true)
data class OpenMeteoResponse(val current: CurrentWeather)

@JsonIgnoreProperties(ignoreUnknown = true)
data class CurrentWeather(
    val precipitation: Double = 0.0,
    @JsonProperty("cloud_cover") val cloudCover: Int = 0,
)

@Service
class WeatherService(private val webClient: WebClient) {

    private val log = LoggerFactory.getLogger(WeatherService::class.java)

    fun getCondition(location: LatLon): WeatherCondition {
        return try {
            val url = "https://api.open-meteo.com/v1/forecast" +
                "?latitude=${location.lat}&longitude=${location.lon}" +
                "&current=precipitation,cloud_cover&timezone=auto"
            val resp = webClient.get()
                .uri(url)
                .retrieve()
                .bodyToMono(OpenMeteoResponse::class.java)
                .block() ?: return WeatherCondition.CLEAR
            val condition = when {
                resp.current.precipitation > 0.0 -> WeatherCondition.RAIN
                resp.current.cloudCover >= 80 -> WeatherCondition.OVERCAST
                else -> WeatherCondition.CLEAR
            }
            log.info("Weather at (${location.lat},${location.lon}): precipitation=${resp.current.precipitation}mm cloud=${resp.current.cloudCover}% → $condition")
            condition
        } catch (e: Exception) {
            log.warn("Weather fetch failed, defaulting to CLEAR: ${e.message}")
            WeatherCondition.CLEAR
        }
    }
}
