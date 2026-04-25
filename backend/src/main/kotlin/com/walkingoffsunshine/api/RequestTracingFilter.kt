package com.walkingoffsunshine.api

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.MDC
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import java.util.UUID

const val MDC_REQUEST_ID = "requestId"

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class RequestTracingFilter : OncePerRequestFilter() {
    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        val requestId = UUID.randomUUID().toString().substring(0, 8)
        MDC.put(MDC_REQUEST_ID, requestId)
        try {
            chain.doFilter(request, response)
        } finally {
            MDC.clear()
        }
    }
}
