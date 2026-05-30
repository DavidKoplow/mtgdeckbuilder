package mage.webgateway;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

final class GatewaySessionManager {

    private static final long CLEANUP_INTERVAL_MS = 60_000L;
    private static final long WAITING_TABLE_POLL_INTERVAL_MS = 2_000L;

    private final String defaultMageHost;
    private final int defaultMagePort;
    private final Map<String, WebGameSession> sessions = new ConcurrentHashMap<>();
    private final Map<String, ConcurrentLinkedQueue<WebGameSession>> waitingSessions = new ConcurrentHashMap<>();
    private final int maxSessions = GatewayExecutors.readIntSetting(
            "mage.gateway.maxSessions",
            "MAGE_GATEWAY_MAX_SESSIONS",
            1000,
            1
    );
    private final ThreadPoolExecutor sessionExecutor = GatewayExecutors.newBoundedExecutor(
            "mage-game-session",
            GatewayExecutors.readIntSetting("mage.gateway.sessionThreads", "MAGE_GATEWAY_SESSION_THREADS", 64, 2),
            GatewayExecutors.readIntSetting("mage.gateway.sessionQueue", "MAGE_GATEWAY_SESSION_QUEUE", 256, 0)
    );
    private final ThreadPoolExecutor webSocketExecutor = GatewayExecutors.newBoundedExecutor(
            "mage-websocket",
            GatewayExecutors.readIntSetting("mage.gateway.websocketThreads", "MAGE_GATEWAY_WEBSOCKET_THREADS", 256, 4),
            GatewayExecutors.readIntSetting("mage.gateway.websocketQueue", "MAGE_GATEWAY_WEBSOCKET_QUEUE", 0, 0)
    );
    private final ScheduledExecutorService cleanupExecutor =
            Executors.newSingleThreadScheduledExecutor(GatewayExecutors.threadFactory("mage-session-cleanup"));
    private final BackendStatsService backendStatsService;
    private final Map<String, BackendStatsService> backendStatsServices = new ConcurrentHashMap<>();

    GatewaySessionManager(String defaultMageHost, int defaultMagePort) {
        this.defaultMageHost = defaultMageHost;
        this.defaultMagePort = defaultMagePort;
        this.backendStatsService = new BackendStatsService(defaultMageHost, defaultMagePort);
        this.backendStatsServices.put(targetKey(defaultMageHost, defaultMagePort), backendStatsService);
        cleanupExecutor.scheduleAtFixedRate(new Runnable() {
            @Override
            public void run() {
                cleanupExpiredSessions();
            }
        }, CLEANUP_INTERVAL_MS, CLEANUP_INTERVAL_MS, TimeUnit.MILLISECONDS);
        cleanupExecutor.scheduleAtFixedRate(new Runnable() {
            @Override
            public void run() {
                startReadyWaitingTables();
            }
        }, WAITING_TABLE_POLL_INTERVAL_MS, WAITING_TABLE_POLL_INTERVAL_MS, TimeUnit.MILLISECONDS);
    }

    String createSession(BridgeModels.StartSoloGameRequest request) {
        if (sessions.size() >= maxSessions) {
            throw new RejectedExecutionException("The MAGE gateway has reached its session limit.");
        }
        if ("human".equalsIgnoreCase(valueOrDefault(request.opponentType, "ai"))) {
            return createHumanSession(request);
        }
        return createAiSession(request);
    }

    private String createAiSession(BridgeModels.StartSoloGameRequest request) {
        String id = UUID.randomUUID().toString();
        WebGameSession session = newSession(id, request);
        sessions.put(id, session);
        executeStart(id, new Runnable() {
            @Override
            public void run() {
                session.startAiGame(request);
            }
        });
        return id;
    }

    private String createHumanSession(BridgeModels.StartSoloGameRequest request) {
        String key = queueKey(request);
        WebGameSession opponent = pollWaitingSession(key);
        String id = UUID.randomUUID().toString();
        WebGameSession session = newSession(id, request);
        sessions.put(id, session);
        executeStart(id, new Runnable() {
            @Override
            public void run() {
                if (opponent == null) {
                    session.startWaitingHumanGame(request, key, GatewaySessionManager.this);
                } else {
                    session.joinWaitingHumanGame(request, opponent);
                }
            }
        });
        return id;
    }

    boolean addWaitingSession(String key, WebGameSession session) {
        WebGameSession opponent = pollWaitingSession(key);
        if (opponent != null) {
            session.matchWaitingOpponent(opponent);
            return false;
        }
        waitingSessions
                .computeIfAbsent(key, ignored -> new ConcurrentLinkedQueue<WebGameSession>())
                .offer(session);
        return true;
    }

    void removeWaitingSession(String key, WebGameSession session) {
        ConcurrentLinkedQueue<WebGameSession> queue = waitingSessions.get(key);
        if (queue == null) {
            return;
        }
        queue.remove(session);
        if (queue.isEmpty()) {
            waitingSessions.remove(key, queue);
        }
    }

    boolean attachWebSocket(String id, final WebSocketConnection connection, boolean readOnly) {
        WebGameSession session = sessions.get(id);
        if (session == null) {
            return false;
        }
        if (!session.addWebSocket(connection, webSocketExecutor, readOnly)) {
            return true;
        }
        return true;
    }

    Map<String, Object> sessionEventsPayload(String id, boolean readOnly) {
        WebGameSession session = sessions.get(id);
        if (session == null) {
            return null;
        }
        return session.eventsPayload(readOnly);
    }

    Map<String, Object> healthPayload() {
        return healthPayload(defaultMageHost, defaultMagePort);
    }

    Map<String, Object> healthPayload(String mageHost, int magePort) {
        String targetHost = valueOrDefault(mageHost, defaultMageHost);
        int targetPort = magePort > 0 ? magePort : defaultMagePort;
        Map<String, Object> payload = new HashMap<>();
        Map<String, Object> backend = backendStatsService(targetHost, targetPort).snapshot().toPayload();
        backend.put("mageHost", targetHost);
        backend.put("magePort", targetPort);
        payload.put("sessions", sessionStatsPayload());
        payload.put("backend", backend);
        return payload;
    }

    private BackendStatsService backendStatsService(String mageHost, int magePort) {
        String key = targetKey(mageHost, magePort);
        BackendStatsService existing = backendStatsServices.get(key);
        if (existing != null) {
            return existing;
        }
        BackendStatsService created = new BackendStatsService(mageHost, magePort);
        BackendStatsService previous = backendStatsServices.putIfAbsent(key, created);
        return previous == null ? created : previous;
    }

    private Map<String, Object> sessionStatsPayload() {
        int waiting = 0;
        int active = 0;
        int terminal = 0;
        int connectedWebSockets = 0;
        Map<String, Integer> waitingByFormat = new TreeMap<>();
        for (WebGameSession session : sessions.values()) {
            if (session.isTerminal()) {
                terminal++;
            } else if (session.isWaitingForMatch()) {
                waiting++;
                String format = formatFromQueueKey(session.waitingQueueKey());
                if (format != null) {
                    Integer current = waitingByFormat.get(format);
                    waitingByFormat.put(format, current == null ? 1 : current + 1);
                }
            } else {
                active++;
            }
            connectedWebSockets += session.connectedWebSocketCount();
        }

        Map<String, Object> payload = new HashMap<>();
        payload.put("active", active);
        payload.put("waiting", waiting);
        payload.put("waitingByFormat", waitingByFormat);
        payload.put("terminal", terminal);
        payload.put("total", sessions.size());
        payload.put("capacity", maxSessions);
        payload.put("webSockets", connectedWebSockets);
        payload.put("sessionThreads", sessionExecutor.getPoolSize());
        payload.put("webSocketThreads", webSocketExecutor.getPoolSize());
        payload.put("queuedStarts", sessionExecutor.getQueue().size());
        payload.put("queuedWebSockets", webSocketExecutor.getQueue().size());
        return payload;
    }

    private String formatFromQueueKey(String key) {
        if (key == null || key.trim().isEmpty()) {
            return null;
        }
        int separator = key.lastIndexOf(':');
        if (separator < 0 || separator >= key.length() - 1) {
            return null;
        }
        return key.substring(separator + 1).toLowerCase(Locale.ENGLISH);
    }

    private void executeStart(String id, Runnable task) {
        try {
            sessionExecutor.execute(task);
        } catch (RejectedExecutionException e) {
            sessions.remove(id);
            throw e;
        }
    }

    private WebGameSession pollWaitingSession(String key) {
        ConcurrentLinkedQueue<WebGameSession> queue = waitingSessions.get(key);
        if (queue == null) {
            return null;
        }
        WebGameSession session;
        while ((session = queue.poll()) != null) {
            if (session.reserveForMatch()) {
                return session;
            }
        }
        waitingSessions.remove(key, queue);
        return null;
    }

    private void cleanupExpiredSessions() {
        long now = System.currentTimeMillis();
        List<WebGameSession> expired = new ArrayList<>();
        for (Iterator<Map.Entry<String, WebGameSession>> iterator = sessions.entrySet().iterator(); iterator.hasNext();) {
            Map.Entry<String, WebGameSession> entry = iterator.next();
            WebGameSession session = entry.getValue();
            if (session.shouldExpire(now)) {
                if (sessions.remove(entry.getKey(), session)) {
                    expired.add(session);
                }
            }
        }
        for (WebGameSession session : expired) {
            session.closeForCleanup("Session expired");
        }
    }

    private void startReadyWaitingTables() {
        for (WebGameSession session : sessions.values()) {
            session.startReadyWaitingTable();
        }
    }

    private static String valueOrDefault(String value, String defaultValue) {
        return value == null || value.trim().isEmpty() ? defaultValue : value.trim();
    }

    private static String targetKey(String host, int port) {
        return valueOrDefault(host, "").toLowerCase(Locale.ENGLISH) + ":" + port;
    }

    private WebGameSession newSession(String id, BridgeModels.StartSoloGameRequest request) {
        return new WebGameSession(
                id,
                valueOrDefault(request.mageHost, defaultMageHost),
                request.magePort == null ? defaultMagePort : request.magePort
        );
    }

    private String queueKey(BridgeModels.StartSoloGameRequest request) {
        String host = valueOrDefault(request.mageHost, defaultMageHost).toLowerCase(Locale.ENGLISH);
        int port = request.magePort == null ? defaultMagePort : request.magePort;
        String format = valueOrDefault(request.format, "commander").toLowerCase(Locale.ENGLISH);
        return host + ":" + port + ":" + format;
    }
}
