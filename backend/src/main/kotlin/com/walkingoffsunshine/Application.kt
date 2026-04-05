package com.walkingoffsunshine

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.context.annotation.Bean
import org.springframework.web.reactive.function.client.WebClient

@SpringBootApplication
class Application {

    @Bean
    fun webClient(): WebClient {
        val httpClient = reactor.netty.http.client.HttpClient.create()
            .responseTimeout(java.time.Duration.ofSeconds(20))
        val connector = org.springframework.http.client.reactive.ReactorClientHttpConnector(httpClient)
        return WebClient.builder().clientConnector(connector).build()
    }
}

fun main(args: Array<String>) {
    runApplication<Application>(*args)
}
