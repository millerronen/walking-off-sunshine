package com.walkingoffsunshine

import io.netty.handler.ssl.SslContextBuilder
import io.netty.handler.ssl.util.InsecureTrustManagerFactory
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.context.annotation.Bean
import org.springframework.web.reactive.function.client.WebClient

@SpringBootApplication
class Application {

    @Bean
    fun webClient(): WebClient {
        // Use an SSL context that trusts all certificates.
        // Overpass API mirrors use certs not in the default JVM trust store.
        val sslContext = SslContextBuilder.forClient()
            .trustManager(InsecureTrustManagerFactory.INSTANCE)
            .build()
        val httpClient = reactor.netty.http.client.HttpClient.create()
            .responseTimeout(java.time.Duration.ofSeconds(20))
            .secure { it.sslContext(sslContext) }
        val connector = org.springframework.http.client.reactive.ReactorClientHttpConnector(httpClient)
        return WebClient.builder().clientConnector(connector).build()
    }
}

fun main(args: Array<String>) {
    runApplication<Application>(*args)
}
