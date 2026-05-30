package mage.webgateway;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

final class GatewayExecutors {

    private GatewayExecutors() {
    }

    static ThreadPoolExecutor newBoundedExecutor(String name, int maxThreads, int queueSize) {
        BlockingQueue<Runnable> queue = queueSize <= 0
                ? new SynchronousQueue<Runnable>()
                : new ArrayBlockingQueue<Runnable>(queueSize);
        ThreadPoolExecutor executor = new ThreadPoolExecutor(
                Math.min(4, maxThreads),
                maxThreads,
                60L,
                TimeUnit.SECONDS,
                queue,
                threadFactory(name),
                new ThreadPoolExecutor.AbortPolicy()
        );
        executor.allowCoreThreadTimeOut(true);
        return executor;
    }

    static ThreadFactory threadFactory(final String name) {
        final AtomicInteger counter = new AtomicInteger();
        return new ThreadFactory() {
            @Override
            public Thread newThread(Runnable runnable) {
                Thread thread = new Thread(runnable, name + "-" + counter.incrementAndGet());
                thread.setDaemon(true);
                return thread;
            }
        };
    }

    static int readIntSetting(String propertyName, String envName, int defaultValue, int minimum) {
        String value = System.getProperty(propertyName);
        if (value == null || value.trim().isEmpty()) {
            value = System.getenv(envName);
        }
        if (value == null || value.trim().isEmpty()) {
            return defaultValue;
        }
        try {
            return Math.max(minimum, Integer.parseInt(value.trim()));
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    static long readLongSetting(String propertyName, String envName, long defaultValue, long minimum) {
        String value = System.getProperty(propertyName);
        if (value == null || value.trim().isEmpty()) {
            value = System.getenv(envName);
        }
        if (value == null || value.trim().isEmpty()) {
            return defaultValue;
        }
        try {
            return Math.max(minimum, Long.parseLong(value.trim()));
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    static void shutdownNow(ExecutorService executor) {
        if (executor != null) {
            executor.shutdownNow();
        }
    }
}
