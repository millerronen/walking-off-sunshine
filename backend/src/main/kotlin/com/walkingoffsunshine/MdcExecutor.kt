package com.walkingoffsunshine

import org.slf4j.MDC
import java.util.concurrent.Executor
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Wraps an [ExecutorService] so that [MDC] context is copied from the submitting thread
 * to each task thread. This preserves requestId and other MDC values across async calls.
 */
class MdcExecutor(private val delegate: ExecutorService) : Executor {
    override fun execute(command: Runnable) {
        val context = MDC.getCopyOfContextMap() ?: emptyMap()
        delegate.execute {
            val previous = MDC.getCopyOfContextMap()
            MDC.setContextMap(context)
            try {
                command.run()
            } finally {
                if (previous != null) MDC.setContextMap(previous) else MDC.clear()
            }
        }
    }

    companion object {
        fun cachedThreadPool(): Executor = MdcExecutor(Executors.newCachedThreadPool())
    }
}
