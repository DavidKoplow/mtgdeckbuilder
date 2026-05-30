package mage.webgateway;

import mage.interfaces.MageClient;
import mage.interfaces.callback.ClientCallback;
import mage.players.net.UserData;
import mage.remote.Connection;
import mage.remote.SessionImpl;
import mage.utils.MageVersion;
import mage.view.RoomUsersView;
import mage.view.TableView;
import mage.view.UsersView;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Collection;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

final class BackendStatsService {

    private static final String STATS_USER_PREFIX = "webstat";

    private final String mageHost;
    private final int magePort;
    private final long cacheTtlMillis = GatewayExecutors.readLongSetting(
            "mage.gateway.backendStatsIntervalSeconds",
            "MAGE_GATEWAY_BACKEND_STATS_INTERVAL_SECONDS",
            15L,
            5L
    ) * 1000L;
    private final long connectTimeoutMillis = GatewayExecutors.readLongSetting(
            "mage.gateway.backendStatsTimeoutSeconds",
            "MAGE_GATEWAY_BACKEND_STATS_TIMEOUT_SECONDS",
            8L,
            1L
    ) * 1000L;
    private final ThreadPoolExecutor executor =
            GatewayExecutors.newBoundedExecutor("mage-backend-stats", 1, 1);
    private final AtomicBoolean refreshInFlight = new AtomicBoolean(false);
    private volatile BackendStats cached = BackendStats.unknown();

    BackendStatsService(String mageHost, int magePort) {
        this.mageHost = mageHost;
        this.magePort = magePort;
    }

    BackendStats snapshot() {
        BackendStats current = cached;
        long now = System.currentTimeMillis();
        if (now - current.checkedAtMillis > cacheTtlMillis && refreshInFlight.compareAndSet(false, true)) {
            try {
                executor.execute(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            cached = refresh();
                        } finally {
                            refreshInFlight.set(false);
                        }
                    }
                });
            } catch (RejectedExecutionException ignored) {
                refreshInFlight.set(false);
            }
        }
        return current;
    }

    void shutdown() {
        GatewayExecutors.shutdownNow(executor);
    }

    private BackendStats refresh() {
        final String statsUserName = statsUserName();
        final SessionImpl session = new SessionImpl(new StatsMageClient());
        final AtomicReference<BackendStats> result = new AtomicReference<>();
        final AtomicReference<Throwable> thrown = new AtomicReference<>();
        Thread worker = GatewayExecutors.threadFactory("mage-backend-stats-connect").newThread(new Runnable() {
            @Override
            public void run() {
                try {
                    result.set(refreshSession(statsUserName, session));
                } catch (Throwable t) {
                    thrown.set(t);
                }
            }
        });
        worker.start();
        try {
            worker.join(connectTimeoutMillis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            session.connectAbort();
            session.connectStop(false, false);
            return BackendStats.error("Interrupted while checking MAGE server " + mageHost + ":" + magePort + ".");
        }
        if (worker.isAlive()) {
            session.connectAbort();
            session.connectStop(false, false);
            worker.interrupt();
            return BackendStats.error("Timed out checking MAGE server " + mageHost + ":" + magePort + ".");
        }
        Throwable error = thrown.get();
        if (error != null) {
            return BackendStats.error(error.getMessage() == null ? error.toString() : error.getMessage());
        }
        BackendStats stats = result.get();
        return stats == null
                ? BackendStats.error("Could not check MAGE server " + mageHost + ":" + magePort + ".")
                : stats;
    }

    private BackendStats refreshSession(String statsUserName, SessionImpl session) {
        try {
            try {
                InetAddress.getByName(mageHost);
            } catch (UnknownHostException e) {
                return BackendStats.error("DNS lookup failed for " + mageHost + ".");
            }

            Connection connection = new Connection();
            connection.setHost(mageHost);
            connection.setPort(magePort);
            connection.setUsername(statsUserName);
            connection.setPassword("");
            connection.setProxyType(Connection.ProxyType.NONE);
            connection.setUserIdStr("mtgdeckbuilder:web-gateway:stats");
            connection.setUserData(UserData.getDefaultUserDataView());

            if (!session.connectStart(connection)) {
                String lastError = nullToEmpty(session.getLastError()).trim();
                return BackendStats.error(
                        lastError.isEmpty()
                                ? "Could not connect to MAGE server " + mageHost + ":" + magePort + "."
                                : "Could not connect to MAGE server. " + lastError
                );
            }

            UUID roomId = session.getMainRoomId();
            if (roomId == null) {
                return BackendStats.error("Connected to MAGE server but could not find the main room.");
            }

            Collection<RoomUsersView> roomUsers = session.getRoomUsers(roomId);
            int onlineUsers = 0;
            int activeGames = 0;
            int gameThreads = 0;
            int maxGames = 0;
            if (roomUsers != null) {
                for (RoomUsersView room : roomUsers) {
                    if (room == null) {
                        continue;
                    }
                    activeGames = Math.max(activeGames, room.getNumberActiveGames());
                    gameThreads = Math.max(gameThreads, room.getNumberGameThreads());
                    maxGames = Math.max(maxGames, room.getNumberMaxGames());
                    if (room.getUsersView() == null) {
                        continue;
                    }
                    for (UsersView user : room.getUsersView()) {
                        if (user == null || user.getUserName() == null) {
                            continue;
                        }
                        String userName = user.getUserName().toLowerCase(Locale.ENGLISH);
                        if (!userName.startsWith(STATS_USER_PREFIX)) {
                            onlineUsers++;
                        }
                    }
                }
            }
            WaitingTableStats waitingTableStats = waitingTableStats(session.getTables(roomId));
            return BackendStats.ok(
                    onlineUsers,
                    activeGames,
                    gameThreads,
                    maxGames,
                    waitingTableStats.waitingPlayers,
                    waitingTableStats.waitingTables,
                    waitingTableStats.waitingByFormat
            );
        } catch (Throwable t) {
            return BackendStats.error(t.getMessage() == null ? t.toString() : t.getMessage());
        } finally {
            session.connectStop(false, false);
        }
    }

    private WaitingTableStats waitingTableStats(Collection<TableView> tables) {
        int waitingPlayers = 0;
        int waitingTables = 0;
        Map<String, Integer> waitingByFormat = new TreeMap<>();
        if (tables == null) {
            return new WaitingTableStats(waitingPlayers, waitingTables, waitingByFormat);
        }

        for (TableView table : tables) {
            String format = PublicWaitingTables.supportedFormat(table);
            if (format == null) {
                continue;
            }
            int players = PublicWaitingTables.waitingHumanPlayers(table);
            if (players <= 0) {
                continue;
            }
            waitingPlayers += players;
            waitingTables++;
            Integer current = waitingByFormat.get(format);
            waitingByFormat.put(format, current == null ? players : current + players);
        }
        return new WaitingTableStats(waitingPlayers, waitingTables, waitingByFormat);
    }

    private String statsUserName() {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 6);
        return STATS_USER_PREFIX + suffix;
    }

    private String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    static final class BackendStats {
        final boolean ok;
        final Integer onlineUsers;
        final Integer activeGames;
        final Integer gameThreads;
        final Integer maxGames;
        final Integer waiting;
        final Integer waitingTables;
        final Map<String, Integer> waitingByFormat;
        final long checkedAtMillis;
        final String error;

        private BackendStats(
                boolean ok,
                Integer onlineUsers,
                Integer activeGames,
                Integer gameThreads,
                Integer maxGames,
                Integer waiting,
                Integer waitingTables,
                Map<String, Integer> waitingByFormat,
                long checkedAtMillis,
                String error
        ) {
            this.ok = ok;
            this.onlineUsers = onlineUsers;
            this.activeGames = activeGames;
            this.gameThreads = gameThreads;
            this.maxGames = maxGames;
            this.waiting = waiting;
            this.waitingTables = waitingTables;
            this.waitingByFormat = waitingByFormat == null ? null : new TreeMap<>(waitingByFormat);
            this.checkedAtMillis = checkedAtMillis;
            this.error = error;
        }

        static BackendStats unknown() {
            return new BackendStats(false, null, null, null, null, null, null, null, 0L, "Not checked yet");
        }

        static BackendStats ok(
                int onlineUsers,
                int activeGames,
                int gameThreads,
                int maxGames,
                int waiting,
                int waitingTables,
                Map<String, Integer> waitingByFormat
        ) {
            return new BackendStats(
                    true,
                    onlineUsers,
                    activeGames,
                    gameThreads,
                    maxGames,
                    waiting,
                    waitingTables,
                    waitingByFormat,
                    System.currentTimeMillis(),
                    null
            );
        }

        static BackendStats error(String error) {
            return new BackendStats(false, null, null, null, null, null, null, null, System.currentTimeMillis(), error);
        }

        Map<String, Object> toPayload() {
            Map<String, Object> payload = new HashMap<>();
            payload.put("ok", ok);
            payload.put("onlineUsers", onlineUsers);
            payload.put("activeGames", activeGames);
            payload.put("gameThreads", gameThreads);
            payload.put("maxGames", maxGames);
            payload.put("waiting", waiting);
            payload.put("waitingTables", waitingTables);
            payload.put("waitingByFormat", waitingByFormat);
            payload.put("checkedAt", checkedAtMillis);
            payload.put("error", error);
            return payload;
        }
    }

    private static final class WaitingTableStats {
        final int waitingPlayers;
        final int waitingTables;
        final Map<String, Integer> waitingByFormat;

        WaitingTableStats(int waitingPlayers, int waitingTables, Map<String, Integer> waitingByFormat) {
            this.waitingPlayers = waitingPlayers;
            this.waitingTables = waitingTables;
            this.waitingByFormat = waitingByFormat;
        }
    }

    private static final class StatsMageClient implements MageClient {
        @Override
        public MageVersion getVersion() {
            return new MageVersion(BackendStatsService.class);
        }

        @Override
        public void connected(String message) {
        }

        @Override
        public void disconnected(boolean askToReconnect, boolean keepMySessionActive) {
        }

        @Override
        public void showMessage(String message) {
        }

        @Override
        public void showError(String message) {
        }

        @Override
        public void onNewConnection() {
        }

        @Override
        public void onCallback(ClientCallback callback) {
        }
    }
}
