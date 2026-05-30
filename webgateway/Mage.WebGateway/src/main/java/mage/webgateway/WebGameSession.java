package mage.webgateway;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import mage.cards.ExpansionSet;
import mage.cards.Sets;
import mage.cards.decks.DeckCardInfo;
import mage.cards.decks.DeckCardLists;
import mage.cards.decks.importer.CardLookup;
import mage.cards.repository.CardInfo;
import mage.cards.repository.CardRepository;
import mage.constants.ManaType;
import mage.constants.MatchBufferTime;
import mage.constants.MatchTimeLimit;
import mage.constants.PlayerAction;
import mage.constants.SkillLevel;
import mage.constants.TableState;
import mage.game.match.MatchOptions;
import mage.interfaces.callback.ClientCallback;
import mage.players.PlayerType;
import mage.players.net.UserData;
import mage.remote.Connection;
import mage.remote.SessionImpl;
import mage.view.AbilityPickerView;
import mage.view.ChatMessage;
import mage.view.GameClientMessage;
import mage.view.GameTypeView;
import mage.view.GameView;
import mage.view.RoomUsersView;
import mage.view.TableClientMessage;
import mage.view.TableView;
import mage.view.UsersView;

import java.io.Serializable;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

final class WebGameSession {

    private static final int BACKLOG_SIZE = GatewayExecutors.readIntSetting(
            "mage.gateway.eventBacklog",
            "MAGE_GATEWAY_EVENT_BACKLOG",
            32,
            1
    );
    private static final long MAX_SESSION_AGE_MS = minutesToMillis(GatewayExecutors.readLongSetting(
            "mage.gateway.sessionTtlMinutes",
            "MAGE_GATEWAY_SESSION_TTL_MINUTES",
            360L,
            1L
    ));
    private static final long TERMINAL_TTL_MS = minutesToMillis(GatewayExecutors.readLongSetting(
            "mage.gateway.completedTtlMinutes",
            "MAGE_GATEWAY_COMPLETED_TTL_MINUTES",
            10L,
            1L
    ));
    private static final long WAITING_TTL_MS = minutesToMillis(GatewayExecutors.readLongSetting(
            "mage.gateway.waitingTtlMinutes",
            "MAGE_GATEWAY_WAITING_TTL_MINUTES",
            15L,
            1L
    ));
    private static final long ABANDONED_TTL_MS = minutesToMillis(GatewayExecutors.readLongSetting(
            "mage.gateway.idleTtlMinutes",
            "MAGE_GATEWAY_IDLE_TTL_MINUTES",
            30L,
            1L
    ));

    private final String id;
    private final String mageHost;
    private final int magePort;
    private final Gson gson = new GsonBuilder().disableHtmlEscaping().create();
    private final CopyOnWriteArrayList<WebSocketClient> sockets = new CopyOnWriteArrayList<>();
    private final Deque<Map<String, Object>> backlog = new ArrayDeque<>();
    private final AtomicLong eventSequence = new AtomicLong();
    private final AtomicBoolean controllerAttached = new AtomicBoolean(false);
    private final long createdAtMillis = System.currentTimeMillis();
    private volatile Map<String, Object> latestStateEvent;

    private SessionImpl session;
    private String connectedUserName;
    private UUID roomId;
    private UUID tableId;
    private UUID gameId;
    private UUID playerId;
    private UUID currentChatId;
    private GatewaySessionManager waitingManager;
    private String waitingQueueKey;
    private BridgeModels.StartSoloGameRequest waitingRequest;
    private volatile String lastUserMessage;
    private volatile boolean waitingForMatch;
    private volatile boolean reservedForMatch;
    private volatile boolean terminal;
    private volatile long terminalAtMillis;
    private volatile long lastActivityMillis = createdAtMillis;

    WebGameSession(String id, String mageHost, int magePort) {
        this.id = id;
        this.mageHost = mageHost;
        this.magePort = magePort;
    }

    private boolean connect(BridgeModels.StartSoloGameRequest request) {
        publishLifecycle("starting", "Connecting to MAGE server " + mageHost + ":" + magePort);
        HeadlessMageClient client = new HeadlessMageClient(this);
        session = new SessionImpl(client);
        Connection connection = new Connection();
        connectedUserName = connectionUserName(request.playerName);
        connection.setHost(mageHost);
        connection.setPort(magePort);
        connection.setUsername(connectedUserName);
        connection.setPassword("");
        connection.setProxyType(Connection.ProxyType.NONE);
        connection.setUserIdStr("mtgdeckbuilder:web-gateway:" + id);
        connection.setUserData(userDataForRating(request.playerRating));

        if (!session.connectStart(connection)) {
            publishError("Could not connect to MAGE server. " + nullToEmpty(session.getLastError()));
            return false;
        }

        roomId = session.getMainRoomId();
        if (roomId == null) {
            publishError("Connected to MAGE server but could not find the main room.");
            return false;
        }
        return true;
    }

    private UserData userDataForRating(Integer ratingValue) {
        UserData userData = UserData.getDefaultUserDataView();
        int rating = requestedPlayerRating(ratingValue);
        userData.setGeneralRating(rating);
        userData.setConstructedRating(rating);
        userData.setLimitedRating(rating);
        return userData;
    }

    void startAiGame(BridgeModels.StartSoloGameRequest request) {
        try {
            if (!connect(request)) {
                markTerminal();
                return;
            }
            publishRatingProfile(request);

            DeckCardLists deck = toDeck(request.deckName, request.main, request.sideboard, "your deck", request.format, false);
            DeckCardLists opponentDeck = hasOpponentDeck(request)
                    ? toDeck(request.opponentDeckName, request.opponentMain, request.opponentSideboard, "the AI deck", request.format, true)
                    : deck.copy();
            opponentDeck.setName(valueOrDefault(
                    request.opponentDeckName,
                    valueOrDefault(request.deckName, "Opponent deck")
            ));

            List<PlayerType> aiTypes = resolveAiTypes(request.ai);
            if (aiTypes.isEmpty()) {
                finishWithError(noPlayableAiMessage());
                return;
            }

            AiStartAttempt lastAttempt = null;
            for (int i = 0; i < aiTypes.size(); i++) {
                PlayerType aiType = aiTypes.get(i);
                AiStartAttempt attempt = tryStartAiGameWithType(request, deck, opponentDeck, aiType);
                if (attempt.started) {
                    return;
                }
                lastAttempt = attempt;
                if (!attempt.retryable || i == aiTypes.size() - 1) {
                    break;
                }
                publishLifecycle(
                        "aiFallback",
                        "MAGE could not create " + aiType + "; trying another AI"
                );
            }
            finishWithError(lastAttempt == null ? noPlayableAiMessage() : lastAttempt.message);
        } catch (Throwable t) {
            finishWithError(t.getMessage() == null ? t.toString() : t.getMessage());
        }
    }

    private AiStartAttempt tryStartAiGameWithType(
            BridgeModels.StartSoloGameRequest request,
            DeckCardLists deck,
            DeckCardLists opponentDeck,
            PlayerType aiType
    ) {
        try {
            MatchOptions options = buildMatchOptions(request, aiType);
            TableView table = session.createTable(roomId, options);
            if (table == null) {
                return AiStartAttempt.failed(false, "MAGE refused to create the playtest table.");
            }
            tableId = table.getTableId();
            publish("tableCreated", event("tableCreated", table));

            lastUserMessage = null;
            if (!session.joinTable(roomId, tableId, valueOrDefault(request.playerName, "Player"), PlayerType.HUMAN, 1, deck.copy(), "")) {
                waitForLastUserMessage();
                String message = withLastUserMessage("MAGE refused to seat the human player.");
                removeCurrentTable();
                return AiStartAttempt.failed(false, message);
            }
            lastUserMessage = null;
            if (!session.joinTable(roomId, tableId, valueOrDefault(request.opponentName, "Computer"), aiType, 2, opponentDeck.copy(), "")) {
                waitForLastUserMessage();
                String userMessage = lastUserMessage;
                String message = "MAGE refused to seat the AI opponent using " + aiType + ".";
                boolean retryable = isAiCreationFailure(userMessage);
                if (retryable) {
                    message += " The server advertised that AI player type but could not instantiate it; its AI plugin is likely missing or failed to load.";
                }
                message = withUserMessage(message, userMessage);
                removeCurrentTable();
                return AiStartAttempt.failed(retryable, message);
            }
            lastUserMessage = null;
            if (!session.startMatch(roomId, tableId)) {
                String message = "MAGE refused to start the match.";
                removeCurrentTable();
                return AiStartAttempt.failed(false, message);
            }
            publishLifecycle("matchStarting", "Match started");
            return AiStartAttempt.started();
        } catch (Throwable t) {
            removeCurrentTable();
            return AiStartAttempt.failed(false, t.getMessage() == null ? t.toString() : t.getMessage());
        }
    }

    void startWaitingHumanGame(
            BridgeModels.StartSoloGameRequest request,
            String queueKey,
            GatewaySessionManager manager
    ) {
        try {
            if (!connect(request)) {
                markTerminal();
                return;
            }

            DeckCardLists deck = toDeck(request.deckName, request.main, request.sideboard, "your deck", request.format, false);
            if (tryJoinPublicWaitingTable(request, deck)) {
                return;
            }

            MatchOptions options = buildMatchOptions(request, PlayerType.HUMAN);
            TableView table = session.createTable(roomId, options);
            if (table == null) {
                finishWithError("MAGE refused to create the playtest table.");
                return;
            }
            tableId = table.getTableId();
            publish("tableCreated", event("tableCreated", table));

            lastUserMessage = null;
            if (!session.joinTable(roomId, tableId, valueOrDefault(request.playerName, "Player"), PlayerType.HUMAN, 1, deck, "")) {
                waitForLastUserMessage();
                finishWithError(withLastUserMessage("MAGE refused to seat the human player."));
                return;
            }
            lastUserMessage = null;

            waitingManager = manager;
            waitingQueueKey = queueKey;
            waitingRequest = request;
            synchronized (this) {
                waitingForMatch = true;
                reservedForMatch = false;
            }
            touch();
            if (manager.addWaitingSession(queueKey, this)) {
                publishLifecycle("waitingForPlayer", "Waiting for another player");
            }
        } catch (Throwable t) {
            finishWithError(t.getMessage() == null ? t.toString() : t.getMessage());
        }
    }

    private boolean tryJoinPublicWaitingTable(BridgeModels.StartSoloGameRequest request, DeckCardLists deck) {
        String format = valueOrDefault(request.format, "commander").toLowerCase(Locale.ENGLISH);
        Collection<TableView> tables;
        try {
            tables = session.getTables(roomId);
        } catch (Throwable t) {
            publishLifecycle(
                    "publicQueueUnavailable",
                    "Could not inspect public waiting tables; creating one instead"
            );
            return false;
        }
        if (tables == null || tables.isEmpty()) {
            return false;
        }

        Integer joinRating = effectiveJoinRating(request, format);
        boolean foundCompatibleTable = false;
        int skippedForRating = 0;
        int lowestSkippedRequirement = Integer.MAX_VALUE;
        String lastJoinRefusal = null;
        for (TableView table : tables) {
            if (!PublicWaitingTables.isJoinable(table, format)) {
                continue;
            }
            foundCompatibleTable = true;
            int minimumRating = PublicWaitingTables.minimumRating(table);
            if (joinRating != null && minimumRating > joinRating) {
                skippedForRating++;
                lowestSkippedRequirement = Math.min(lowestSkippedRequirement, minimumRating);
                continue;
            }
            UUID publicTableId = table.getTableId();
            if (publicTableId == null) {
                continue;
            }

            lastUserMessage = null;
            if (session.joinTable(roomId, publicTableId, valueOrDefault(request.playerName, "Player"), PlayerType.HUMAN, 1, deck, "")) {
                lastUserMessage = null;
                tableId = publicTableId;
                publish("publicTableJoined", event("publicTableJoined", table));
                publishLifecycle("waitingForTableStart", "Joined public waiting table; waiting for the table owner to start");
                return true;
            }
            waitForLastUserMessage();
            if (lastUserMessage != null && !lastUserMessage.trim().isEmpty()) {
                lastJoinRefusal = lastUserMessage;
            }
        }

        if (foundCompatibleTable) {
            String ratingMessage = skippedForRating <= 0
                    ? null
                    : "Skipped " + skippedForRating + " compatible public waiting "
                    + (skippedForRating == 1 ? "table" : "tables")
                    + " because your server rating " + (joinRating == null ? "is unavailable" : joinRating)
                    + " is below the table requirement "
                    + (lowestSkippedRequirement == Integer.MAX_VALUE ? "on those tables" : lowestSkippedRequirement)
                    + "; creating one instead";
            publishLifecycle(
                    "publicTableJoinSkipped",
                    lastJoinRefusal == null
                            ? valueOrDefault(
                                    ratingMessage,
                                    "Compatible public waiting tables were full before the gateway could join; creating one instead"
                            )
                            : "Could not join a compatible public waiting table: " + lastJoinRefusal
            );
        }
        return false;
    }

    private void publishRatingProfile(BridgeModels.StartSoloGameRequest request) {
        Integer configuredRating = request.playerRating == null ? null : requestedPlayerRating(request.playerRating);
        UsersView user = currentUserView();
        Map<String, Object> event = newEvent("playerRating");
        event.put("configuredRating", configuredRating);
        if (user != null) {
            event.put("userName", user.getUserName());
            event.put("generalRating", user.getGeneralRating());
            event.put("constructedRating", user.getConstructedRating());
            event.put("limitedRating", user.getLimitedRating());
            event.put(
                    "message",
                    "MAGE server rating: Constructed " + user.getConstructedRating()
                            + ", Limited " + user.getLimitedRating()
            );
        } else if (configuredRating != null) {
            event.put("message", "Configured gateway rating: " + configuredRating);
        } else {
            event.put("message", "MAGE server rating unavailable");
        }
        publish("playerRating", event);
    }

    private Integer effectiveJoinRating(BridgeModels.StartSoloGameRequest request, String format) {
        Integer configuredRating = request.playerRating == null ? null : requestedPlayerRating(request.playerRating);
        Integer serverRating = currentServerRating(format);
        if (serverRating == null) {
            return configuredRating;
        }
        return configuredRating == null ? serverRating : Math.min(serverRating, configuredRating);
    }

    private Integer currentServerRating(String format) {
        UsersView user = currentUserView();
        if (user == null) {
            return null;
        }
        return isLimitedFormat(format) ? user.getLimitedRating() : user.getConstructedRating();
    }

    private UsersView currentUserView() {
        if (session == null || roomId == null || connectedUserName == null) {
            return null;
        }
        Collection<RoomUsersView> rooms;
        try {
            rooms = session.getRoomUsers(roomId);
        } catch (Throwable ignored) {
            return null;
        }
        if (rooms == null) {
            return null;
        }
        for (RoomUsersView room : rooms) {
            if (room == null || room.getUsersView() == null) {
                continue;
            }
            for (UsersView user : room.getUsersView()) {
                if (user != null && connectedUserName.equalsIgnoreCase(user.getUserName())) {
                    return user;
                }
            }
        }
        return null;
    }

    void joinWaitingHumanGame(BridgeModels.StartSoloGameRequest request, WebGameSession opponent) {
        try {
            boolean alreadyWaiting = session != null && roomId != null && tableId != null;
            if (!alreadyWaiting && !connect(request)) {
                markTerminal();
                opponent.requeueWaitingSession();
                return;
            }
            if (!alreadyWaiting) {
                publishRatingProfile(request);
            }
            UUID opponentRoomId = opponent.getRoomId();
            UUID opponentTableId = opponent.getTableId();
            if (opponentRoomId == null || opponentTableId == null) {
                if (alreadyWaiting) {
                    requeueWaitingSession();
                } else {
                    finishWithError("The waiting MAGE table is no longer available.");
                }
                return;
            }

            if (alreadyWaiting) {
                UUID ownRoomId = roomId;
                UUID ownTableId = tableId;
                clearWaitingRegistration();
                removeWaitingTable(ownRoomId, ownTableId);
                if (ownTableId.equals(tableId)) {
                    tableId = null;
                }
            }

            DeckCardLists deck = toDeck(request.deckName, request.main, request.sideboard, "your deck", request.format, false);
            lastUserMessage = null;
            if (!session.joinTable(opponentRoomId, opponentTableId, valueOrDefault(request.playerName, "Player"), PlayerType.HUMAN, 1, deck, "")) {
                waitForLastUserMessage();
                finishWithError(withLastUserMessage("MAGE refused to seat the human player."));
                opponent.requeueWaitingSession();
                return;
            }
            lastUserMessage = null;
            roomId = opponentRoomId;
            tableId = opponentTableId;
            publishLifecycle("playerMatched", "Joined waiting player");
            opponent.publishLifecycle("playerMatched", "Opponent joined");
            if (!opponent.startWaitingMatch()) {
                finishWithError("MAGE refused to start the match.");
            } else {
                publishLifecycle("matchStarting", "Match started");
            }
        } catch (Throwable t) {
            finishWithError(t.getMessage() == null ? t.toString() : t.getMessage());
            opponent.requeueWaitingSession();
        }
    }

    void matchWaitingOpponent(WebGameSession opponent) {
        if (waitingRequest == null) {
            finishWithError("Waiting session is missing its MAGE start request.");
            opponent.requeueWaitingSession();
            return;
        }
        synchronized (this) {
            waitingForMatch = false;
            reservedForMatch = true;
        }
        joinWaitingHumanGame(waitingRequest, opponent);
    }

    UUID getRoomId() {
        return roomId;
    }

    UUID getTableId() {
        return tableId;
    }

    boolean reserveForMatch() {
        if (terminal || roomId == null || tableId == null) {
            return false;
        }
        synchronized (this) {
            if (!waitingForMatch || reservedForMatch || terminal || roomId == null || tableId == null) {
                return false;
            }
            waitingForMatch = false;
            reservedForMatch = true;
            touch();
            return true;
        }
    }

    boolean isWaitingForMatch() {
        return waitingForMatch && !terminal;
    }

    String waitingQueueKey() {
        synchronized (this) {
            return waitingForMatch && !terminal ? waitingQueueKey : null;
        }
    }

    boolean isTerminal() {
        return terminal;
    }

    void startReadyWaitingTable() {
        if (!isWaitingForMatch() || session == null || roomId == null || tableId == null) {
            return;
        }
        try {
            Optional<TableView> table = session.getTable(roomId, tableId);
            if (!table.isPresent() || !TableState.READY_TO_START.equals(table.get().getTableState())) {
                return;
            }
            if (!session.isTableOwner(roomId, tableId)) {
                return;
            }
            synchronized (this) {
                if (!waitingForMatch || reservedForMatch || terminal) {
                    return;
                }
                waitingForMatch = false;
                reservedForMatch = true;
            }
            startWaitingMatch();
        } catch (Throwable ignored) {
        }
    }

    int connectedWebSocketCount() {
        return sockets.size();
    }

    Map<String, Object> eventsPayload(boolean readOnly) {
        touch();
        Map<String, Object> payload = new HashMap<>();
        payload.put("id", id);
        payload.put("terminal", terminal);
        List<Map<String, Object>> events = new ArrayList<>();
        synchronized (backlog) {
            if (latestStateEvent != null && !backlog.contains(latestStateEvent)) {
                events.add(readOnly ? redactSpectatorEvent(latestStateEvent) : new HashMap<>(latestStateEvent));
            }
            for (Map<String, Object> event : backlog) {
                events.add(readOnly ? redactSpectatorEvent(event) : new HashMap<>(event));
            }
        }
        payload.put("events", events);
        return payload;
    }

    boolean shouldExpire(long nowMillis) {
        if (terminal) {
            return terminalAtMillis > 0 && nowMillis - terminalAtMillis > TERMINAL_TTL_MS;
        }
        if (nowMillis - createdAtMillis > MAX_SESSION_AGE_MS) {
            return true;
        }
        if (waitingForMatch && nowMillis - lastActivityMillis > WAITING_TTL_MS) {
            return true;
        }
        return sockets.isEmpty() && nowMillis - lastActivityMillis > ABANDONED_TTL_MS;
    }

    void closeForCleanup(String reason) {
        clearWaitingRegistration();
        markTerminal();
        for (WebSocketClient socket : sockets) {
            socket.connection.close(reason);
        }
        sockets.clear();
        if (session != null) {
            try {
                if (gameId == null && roomId != null && tableId != null) {
                    session.leaveTable(roomId, tableId);
                }
            } catch (Throwable ignored) {
            }
            try {
                session.connectStop(false, false);
            } catch (Throwable ignored) {
            }
        }
    }

    private boolean startWaitingMatch() {
        clearWaitingRegistration();
        if (session == null || roomId == null || tableId == null) {
            finishWithError("MAGE session is not ready to start the match.");
            return false;
        }
        if (!session.startMatch(roomId, tableId)) {
            finishWithError("MAGE refused to start the match.");
            return false;
        }
        publishLifecycle("matchStarting", "Match started");
        return true;
    }

    private void requeueWaitingSession() {
        if (!terminal && waitingManager != null && waitingQueueKey != null && roomId != null && tableId != null) {
            synchronized (this) {
                waitingForMatch = true;
                reservedForMatch = false;
            }
            touch();
            if (waitingManager.addWaitingSession(waitingQueueKey, this)) {
                publishLifecycle("waitingForPlayer", "Waiting for another player");
            }
        }
    }

    private void clearWaitingRegistration() {
        synchronized (this) {
            waitingForMatch = false;
            reservedForMatch = false;
        }
        if (waitingManager != null && waitingQueueKey != null) {
            waitingManager.removeWaitingSession(waitingQueueKey, this);
        }
        waitingManager = null;
        waitingQueueKey = null;
        waitingRequest = null;
    }

    boolean addWebSocket(final WebSocketConnection connection, ExecutorService executor, final boolean readOnly) {
        touch();
        if (!readOnly && !controllerAttached.compareAndSet(false, true)) {
            connection.close("A controlling client is already connected; reconnect as a spectator.");
            return false;
        }
        final WebSocketClient client = new WebSocketClient(connection, readOnly);
        sockets.add(client);
        synchronized (backlog) {
            if (latestStateEvent != null && !backlog.contains(latestStateEvent)) {
                connection.sendText(serializeEvent(latestStateEvent, readOnly));
            }
            for (Map<String, Object> event : backlog) {
                connection.sendText(serializeEvent(event, readOnly));
            }
        }
        if (terminal) {
            sockets.remove(client);
            if (!readOnly) {
                controllerAttached.set(false);
            }
            connection.close("Session already ended");
            return true;
        }
        try {
            executor.execute(new Runnable() {
                @Override
                public void run() {
                    connection.readLoop(
                            new WebSocketConnection.MessageHandler() {
                                @Override
                                public void onMessage(String message) {
                                    touch();
                                    if (!readOnly) {
                                        handleCommand(message);
                                    }
                                }
                            },
                            new Runnable() {
                                @Override
                                public void run() {
                                    sockets.remove(client);
                                    if (!readOnly) {
                                        controllerAttached.set(false);
                                    }
                                    touch();
                                }
                            }
                    );
                }
            });
            return true;
        } catch (RejectedExecutionException e) {
            sockets.remove(client);
            if (!readOnly) {
                controllerAttached.set(false);
            }
            connection.close("The MAGE gateway has too many open websocket connections.");
            return false;
        }
    }

    void handleCallback(ClientCallback callback) {
        try {
            callback.decompressData();
            Object data = callback.getData();
            Map<String, Object> event = newEvent(callback.getMethod().name());
            event.put("callbackMethod", callback.getMethod().name());
            event.put("messageId", callback.getMessageId());
            event.put("callbackType", callback.getMethod().getType().name());
            if (callback.getObjectId() != null) {
                event.put("objectId", callback.getObjectId().toString());
            }

            switch (callback.getMethod()) {
                case CHATMESSAGE:
                    handleChatMessage(callback, data, event);
                    break;
                case SHOW_USERMESSAGE:
                    handleUserMessage(data, event);
                    break;
                case JOINED_TABLE:
                    handleJoinedTable(data, event);
                    break;
                case START_GAME:
                    handleStartGame(data, event);
                    break;
                case GAME_INIT:
                case GAME_UPDATE:
                    gameId = callback.getObjectId();
                    event.put("gameId", uuidToString(gameId));
                    event.put("gameView", gson.toJsonTree((GameView) data));
                    publish("state", event);
                    break;
                case GAME_UPDATE_AND_INFORM:
                case GAME_ASK:
                case GAME_SELECT:
                case GAME_TARGET:
                case GAME_CHOOSE_CHOICE:
                case GAME_CHOOSE_PILE:
                case GAME_PLAY_MANA:
                case GAME_PLAY_XMANA:
                case GAME_GET_AMOUNT:
                case GAME_GET_MULTI_AMOUNT:
                case GAME_OVER:
                    gameId = callback.getObjectId();
                    addGameClientMessage(event, (GameClientMessage) data);
                    publish(callback.getMethod() == mage.interfaces.callback.ClientCallbackMethod.GAME_OVER ? "gameOver" : "prompt", event);
                    if (callback.getMethod() == mage.interfaces.callback.ClientCallbackMethod.GAME_OVER) {
                        markTerminal();
                    }
                    break;
                case GAME_CHOOSE_ABILITY:
                    gameId = callback.getObjectId();
                    addAbilityPicker(event, (AbilityPickerView) data);
                    publish("prompt", event);
                    break;
                case GAME_ERROR:
                    event.put("message", data == null ? "Game error" : data.toString());
                    publish("error", event);
                    break;
                default:
                    event.put("payload", data == null ? null : gson.toJsonTree(data));
                    publish("callback", event);
                    break;
            }
        } catch (Throwable t) {
            publishError("Failed to handle MAGE callback: " + (t.getMessage() == null ? t.toString() : t.getMessage()));
        }
    }

    private void handleChatMessage(ClientCallback callback, Object data, Map<String, Object> event) {
        UUID chatId = callback.getObjectId();
        if (chatId != null) {
            currentChatId = chatId;
            event.put("chatId", chatId.toString());
            event.put("objectId", chatId.toString());
        }
        if (data instanceof ChatMessage) {
            ChatMessage message = (ChatMessage) data;
            event.put("username", message.getUsername());
            event.put("message", message.getMessage());
            event.put("chatTime", message.getTime() == null ? null : message.getTime().getTime());
            event.put("turnInfo", message.getTurnInfo());
            event.put("color", message.getColor() == null ? null : message.getColor().name());
            event.put("messageType", message.getMessageType() == null ? null : message.getMessageType().name());
            event.put("soundToPlay", message.getSoundToPlay() == null ? null : message.getSoundToPlay().name());
        }
        event.put("payload", data == null ? null : gson.toJsonTree(data));
        publish("chatMessage", event);
    }

    private void handleUserMessage(Object data, Map<String, Object> event) {
        String title = "";
        String message = data == null ? "" : data.toString();
        if (data instanceof List) {
            List<?> parts = (List<?>) data;
            if (!parts.isEmpty()) {
                title = stringFromObject(parts.get(0));
            }
            if (parts.size() > 1) {
                message = stringFromObject(parts.get(1));
            }
        }
        lastUserMessage = title.isEmpty() ? message : title + ": " + message;
        event.put("title", title);
        event.put("message", lastUserMessage);
        event.put("payload", data == null ? null : gson.toJsonTree(data));
        publish("userMessage", event);
    }

    private void handleJoinedTable(Object data, Map<String, Object> event) {
        TableClientMessage message = (TableClientMessage) data;
        roomId = message.getRoomId();
        tableId = message.getCurrentTableId();
        event.put("roomId", uuidToString(roomId));
        event.put("tableId", uuidToString(tableId));
        event.put("parentTableId", uuidToString(message.getParentTableId()));
        event.put("payload", gson.toJsonTree(message));
        UUID chatId = joinTableChat(tableId);
        if (chatId != null) {
            event.put("chatId", chatId.toString());
        }
        publish("joinedTable", event);
    }

    void publishLifecycle(String type, String message) {
        Map<String, Object> event = newEvent(type);
        event.put("message", message);
        publish(type, event);
    }

    void handleDisconnected(boolean askToReconnect, boolean keepMySessionActive) {
        publishLifecycle(
                "disconnected",
                "askToReconnect=" + askToReconnect + ", keepMySessionActive=" + keepMySessionActive
        );
        if (!keepMySessionActive) {
            clearWaitingRegistration();
            markTerminal();
        }
    }

    void publishError(String message) {
        Map<String, Object> event = newEvent("error");
        event.put("message", message);
        publish("error", event);
    }

    private void handleStartGame(Object data, Map<String, Object> event) {
        TableClientMessage message = (TableClientMessage) data;
        tableId = message.getCurrentTableId();
        gameId = message.getGameId();
        playerId = message.getPlayerId();
        UUID chatId = joinGameChat(gameId);
        event.put("roomId", uuidToString(message.getRoomId()));
        event.put("tableId", uuidToString(tableId));
        event.put("parentTableId", uuidToString(message.getParentTableId()));
        event.put("gameId", uuidToString(gameId));
        event.put("playerId", uuidToString(playerId));
        event.put("chatId", uuidToString(chatId));
        event.put("payload", gson.toJsonTree(message));
        publish("gameStarted", event);
        if (gameId != null && !session.joinGame(gameId)) {
            publishError("MAGE started a game but refused the gateway join request.");
        }
    }

    private UUID joinTableChat(UUID targetTableId) {
        if (session == null || targetTableId == null) {
            return null;
        }
        try {
            Optional<UUID> chatId = session.getTableChatId(targetTableId);
            return joinChat(chatId, "table");
        } catch (Throwable ignored) {
            return null;
        }
    }

    private UUID joinGameChat(UUID targetGameId) {
        if (session == null || targetGameId == null) {
            return null;
        }
        try {
            Optional<UUID> chatId = session.getGameChatId(targetGameId);
            return joinChat(chatId, "game");
        } catch (Throwable ignored) {
            return null;
        }
    }

    private UUID joinChat(Optional<UUID> chatId, String scope) {
        if (chatId == null || !chatId.isPresent()) {
            return null;
        }
        UUID id = chatId.get();
        if (!session.joinChat(id)) {
            return null;
        }
        currentChatId = id;
        Map<String, Object> event = newEvent("chatReady");
        event.put("chatId", id.toString());
        event.put("scope", scope);
        publish("chatReady", event);
        return id;
    }

    private void addGameClientMessage(Map<String, Object> event, GameClientMessage message) {
        event.put("gameId", uuidToString(gameId));
        event.put("message", message.getMessage());
        event.put("flag", message.isFlag());
        event.put("min", message.getMin());
        event.put("max", message.getMax());
        event.put("gameView", message.getGameView() == null ? null : gson.toJsonTree(message.getGameView()));
        event.put("options", message.getOptions() == null ? null : gson.toJsonTree(message.getOptions()));
        event.put("cardsView1", message.getCardsView1() == null ? null : gson.toJsonTree(message.getCardsView1()));
        event.put("cardsView2", message.getCardsView2() == null ? null : gson.toJsonTree(message.getCardsView2()));
        event.put("targets", message.getTargets() == null ? null : gson.toJsonTree(message.getTargets()));
        event.put("choice", message.getChoice() == null ? null : gson.toJsonTree(message.getChoice()));
        event.put("messages", message.getMessages() == null ? null : gson.toJsonTree(message.getMessages()));
    }

    private void addAbilityPicker(Map<String, Object> event, AbilityPickerView picker) {
        event.put("gameId", uuidToString(gameId));
        event.put("message", picker.getMessage());
        event.put("gameView", picker.getGameView() == null ? null : gson.toJsonTree(picker.getGameView()));
        event.put("choices", gson.toJsonTree(picker.getChoices()));
    }

    private void handleCommand(String message) {
        try {
            JsonObject command = new JsonParser().parse(message).getAsJsonObject();
            String type = stringValue(command, "type", "");
            UUID targetGameId = uuidValue(command, "gameId", gameId);
            if (session == null) {
                publishError("MAGE session is not connected yet.");
                return;
            }
            if ("chooseUuid".equals(type)) {
                session.sendPlayerUUID(targetGameId, UUID.fromString(stringValue(command, "id", "")));
            } else if ("chooseBoolean".equals(type)) {
                session.sendPlayerBoolean(targetGameId, booleanValue(command, "value", false));
            } else if ("chooseInteger".equals(type)) {
                session.sendPlayerInteger(targetGameId, intValue(command, "value", 0));
            } else if ("chooseString".equals(type)) {
                session.sendPlayerString(targetGameId, stringValue(command, "value", ""));
            } else if ("chooseManaType".equals(type)) {
                UUID targetPlayerId = uuidValue(command, "playerId", playerId);
                session.sendPlayerManaType(targetGameId, targetPlayerId, ManaType.valueOf(stringValue(command, "value", "COLORLESS").toUpperCase(Locale.ENGLISH)));
            } else if ("playerAction".equals(type)) {
                PlayerAction action = PlayerAction.valueOf(stringValue(command, "action", "").toUpperCase(Locale.ENGLISH));
                session.sendPlayerAction(action, targetGameId, serializableValue(command.get("data")));
            } else if ("passPriority".equals(type)) {
                session.sendPlayerAction(PlayerAction.PASS_PRIORITY_UNTIL_STACK_RESOLVED, targetGameId, null);
            } else if ("concede".equals(type)) {
                session.sendPlayerAction(PlayerAction.CONCEDE, targetGameId, null);
            } else if ("sendChatMessage".equals(type)) {
                UUID targetChatId = uuidValue(command, "chatId", currentChatId);
                String text = stringValue(command, "message", "").trim();
                if (targetChatId == null) {
                    publishError("MAGE chat is not connected yet.");
                    return;
                }
                if (text.isEmpty()) {
                    return;
                }
                if (!session.sendChatMessage(targetChatId, text)) {
                    publishError("MAGE refused to send the chat message.");
                }
            } else if ("disconnect".equals(type)) {
                clearWaitingRegistration();
                session.connectStop(false, false);
                markTerminal();
            } else {
                publishError("Unsupported gateway command: " + type);
            }
        } catch (Throwable t) {
            publishError("Failed to process gateway command: " + (t.getMessage() == null ? t.toString() : t.getMessage()));
        }
    }

    private Serializable serializableValue(JsonElement element) {
        if (element == null || element.isJsonNull()) {
            return null;
        }
        if (element.isJsonPrimitive()) {
            if (element.getAsJsonPrimitive().isBoolean()) {
                return element.getAsBoolean();
            }
            if (element.getAsJsonPrimitive().isNumber()) {
                return element.getAsInt();
            }
            return element.getAsString();
        }
        return gson.toJson(element);
    }

    private MatchOptions buildMatchOptions(BridgeModels.StartSoloGameRequest request, PlayerType opponentPlayerType) {
        String format = valueOrDefault(request.format, "commander").toLowerCase(Locale.ENGLISH);
        String desiredGameType = "commander".equals(format) ? "Commander Two Player Duel" : "Two Player Duel";
        String desiredDeckType = deckTypeForFormat(format);
        String gameType = pickGameType(desiredGameType, "Two Player Duel");
        String deckType = pickDeckType(desiredDeckType, "Constructed - Freeform");

        MatchOptions options = new MatchOptions(valueOrDefault(request.deckName, "Web playtest"), gameType, false);
        options.getPlayerTypes().add(PlayerType.HUMAN);
        options.getPlayerTypes().add(opponentPlayerType);
        options.setDeckType(deckType);
        options.setMatchTimeLimit(MatchTimeLimit.NONE);
        options.setMatchBufferTime(MatchBufferTime.NONE);
        options.setSkillLevel(SkillLevel.CASUAL);
        options.setWinsNeeded(1);
        options.setRollbackTurnsAllowed(false);
        options.setSpectatorsAllowed(false);
        options.setRated(false);
        options.setLimited(deckType.startsWith("Limited"));
        return options;
    }

    private String pickGameType(String desired, String fallback) {
        List<GameTypeView> gameTypes = session.getGameTypes();
        for (GameTypeView gameType : gameTypes) {
            if (desired.equals(gameType.getName())) {
                return desired;
            }
        }
        for (GameTypeView gameType : gameTypes) {
            if (fallback.equals(gameType.getName())) {
                return fallback;
            }
        }
        return desired;
    }

    private String pickDeckType(String desired, String fallback) {
        Set<String> deckTypes = new HashSet<>(Arrays.asList(session.getDeckTypes()));
        if (deckTypes.contains(desired)) {
            return desired;
        }
        if (deckTypes.contains(fallback)) {
            return fallback;
        }
        return desired;
    }

    private String deckTypeForFormat(String format) {
        if ("commander".equals(format)) {
            return "Variant Magic - Commander";
        }
        if ("standard".equals(format)) {
            return "Constructed - Standard";
        }
        if ("pioneer".equals(format)) {
            return "Constructed - Pioneer";
        }
        if ("modern".equals(format)) {
            return "Constructed - Modern";
        }
        if ("legacy".equals(format)) {
            return "Constructed - Legacy";
        }
        if ("vintage".equals(format)) {
            return "Constructed - Vintage";
        }
        if ("pauper".equals(format)) {
            return "Constructed - Pauper";
        }
        return "Constructed - Freeform";
    }

    private boolean isLimitedFormat(String format) {
        return deckTypeForFormat(valueOrDefault(format, "")).startsWith("Limited");
    }

    private int requestedPlayerRating(Integer rating) {
        if (rating == null) {
            return 800;
        }
        return Math.max(0, Math.min(3000, rating));
    }

    private DeckCardLists toDeck(
            String deckName,
            List<BridgeModels.DeckEntry> main,
            List<BridgeModels.DeckEntry> sideboard,
            String sourceLabel,
            String format,
            boolean replaceUnplayableCards
    ) {
        DeckCardLists deck = new DeckCardLists();
        deck.setName(valueOrDefault(deckName, "Web playtest deck"));
        deck.setCards(toDeckCards(main, sourceLabel, format, replaceUnplayableCards));
        deck.setSideboard(toDeckCards(sideboard, sourceLabel, format, replaceUnplayableCards));
        return deck;
    }

    private boolean hasOpponentDeck(BridgeModels.StartSoloGameRequest request) {
        return request.opponentMain != null && !request.opponentMain.isEmpty();
    }

    private List<DeckCardInfo> toDeckCards(
            List<BridgeModels.DeckEntry> entries,
            String sourceLabel,
            String format,
            boolean replaceUnplayableCards
    ) {
        List<DeckCardInfo> cards = new ArrayList<>();
        if (entries == null) {
            return cards;
        }
        for (BridgeModels.DeckEntry entry : entries) {
            if (entry == null || entry.name == null || entry.name.trim().isEmpty()) {
                continue;
            }
            int quantity = entry.quantity <= 0 ? 1 : entry.quantity;
            DeckCardInfo basicLand = basicLandDeckCardInfo(entry.name.trim(), quantity);
            if (basicLand != null) {
                cards.add(basicLand);
                continue;
            }
            String setCode = valueOrDefault(entry.set, "").toUpperCase(Locale.ENGLISH);
            String cardNumber = valueOrDefault(entry.collectorNumber, "");
            CardInfo cardInfo = resolvePlayableCardInfo(entry.name.trim(), setCode, cardNumber);
            if (cardInfo == null) {
                cardInfo = resolveBasicLand(entry.name.trim());
            }
            if (cardInfo == null) {
                if (replaceUnplayableCards) {
                    DeckCardInfo replacement = unplayableAiReplacementDeckCardInfo(format, quantity);
                    cards.add(replacement);
                    publishLifecycle(
                            "deckAdjusted",
                            unplayableAiReplacementMessage(entry.name.trim(), setCode, cardNumber, replacement.getCardName())
                    );
                    continue;
                }
                throw new IllegalArgumentException(unplayableCardMessage(entry.name.trim(), setCode, cardNumber, sourceLabel));
            } else {
                cards.add(new DeckCardInfo(cardInfo.getName(), cardInfo.getCardNumber(), cardInfo.getSetCode(), quantity));
            }
        }
        return cards;
    }

    private CardInfo resolvePlayableCardInfo(String cardName, String setCode, String cardNumber) {
        CardInfo requested = null;
        if (!setCode.isEmpty() || !cardNumber.isEmpty()) {
            requested = CardLookup.instance.lookupCardInfo(cardName, setCode, cardNumber);
            requested = playableCardInfo(requested);
            if (requested != null) {
                return requested;
            }
        }

        CardInfo preferred = CardLookup.instance.lookupCardInfo(cardName);
        preferred = playableCardInfo(preferred);
        if (preferred != null) {
            return preferred;
        }

        for (CardInfo candidate : CardRepository.instance.findCards(cardName)) {
            CardInfo playable = playableCardInfo(candidate);
            if (playable != null) {
                return playable;
            }
        }

        return null;
    }

    private CardInfo playableCardInfo(CardInfo cardInfo) {
        if (cardInfo == null) {
            return null;
        }
        CardInfo repositoryCardInfo = CardRepository.instance.findCard(
                cardInfo.getSetCode(),
                cardInfo.getCardNumber()
        );
        if (repositoryCardInfo == null || !isActiveSetCard(repositoryCardInfo)) {
            return null;
        }
        try {
            return repositoryCardInfo.createCard() == null ? null : repositoryCardInfo;
        } catch (RuntimeException e) {
            return null;
        }
    }

    private CardInfo resolveBasicLand(String cardName) {
        if ("Plains".equalsIgnoreCase(cardName)
                || "Island".equalsIgnoreCase(cardName)
                || "Swamp".equalsIgnoreCase(cardName)
                || "Mountain".equalsIgnoreCase(cardName)
                || "Forest".equalsIgnoreCase(cardName)
                || "Wastes".equalsIgnoreCase(cardName)) {
            return playableCardInfo(CardRepository.instance.findCard(cardName, true));
        }
        return null;
    }

    private boolean isActiveSetCard(CardInfo cardInfo) {
        ExpansionSet set = Sets.findSet(cardInfo.getSetCode());
        if (set == null) {
            return false;
        }
        for (ExpansionSet.SetCardInfo setCardInfo : set.getSetCardInfo()) {
            if (setCardInfo.getCardNumber().equals(cardInfo.getCardNumber())) {
                return true;
            }
        }
        return false;
    }

    private String unplayableCardMessage(String cardName, String setCode, String cardNumber, String sourceLabel) {
        String requestedPrinting = "";
        if (!setCode.isEmpty() || !cardNumber.isEmpty()) {
            requestedPrinting = " (" + valueOrDefault(setCode, "?") + " " + valueOrDefault(cardNumber, "?") + ")";
        }
        return "MAGE cannot play " + cardName + requestedPrinting + " from " + sourceLabel
                + ". This card or printing is not implemented in the active MAGE card set. "
                + "Choose a different card or update MAGE after support lands.";
    }

    private String unplayableAiReplacementMessage(String cardName, String setCode, String cardNumber, String replacementName) {
        String requestedPrinting = "";
        if (!setCode.isEmpty() || !cardNumber.isEmpty()) {
            requestedPrinting = " (" + valueOrDefault(setCode, "?") + " " + valueOrDefault(cardNumber, "?") + ")";
        }
        return "MAGE cannot play " + cardName + requestedPrinting
                + " from the AI deck, so the gateway replaced it with " + replacementName
                + " for this sparring game.";
    }

    private DeckCardInfo unplayableAiReplacementDeckCardInfo(String format, int quantity) {
        String normalized = valueOrDefault(format, "").toLowerCase(Locale.ENGLISH);
        String replacementName = "commander".equals(normalized) ? "Wastes" : "Island";
        DeckCardInfo replacement = basicLandDeckCardInfo(replacementName, quantity);
        return replacement == null ? new DeckCardInfo("Island", "264", "XLN", quantity) : replacement;
    }

    private DeckCardInfo basicLandDeckCardInfo(String cardName, int quantity) {
        if ("Plains".equalsIgnoreCase(cardName)) {
            return new DeckCardInfo("Plains", "260", "XLN", quantity);
        }
        if ("Island".equalsIgnoreCase(cardName)) {
            return new DeckCardInfo("Island", "264", "XLN", quantity);
        }
        if ("Swamp".equalsIgnoreCase(cardName)) {
            return new DeckCardInfo("Swamp", "268", "XLN", quantity);
        }
        if ("Mountain".equalsIgnoreCase(cardName)) {
            return new DeckCardInfo("Mountain", "272", "XLN", quantity);
        }
        if ("Forest".equalsIgnoreCase(cardName)) {
            return new DeckCardInfo("Forest", "276", "XLN", quantity);
        }
        if ("Wastes".equalsIgnoreCase(cardName)) {
            return new DeckCardInfo("Wastes", "408", "M3C", quantity);
        }
        return null;
    }

    private PlayerType parseAiType(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return PlayerType.COMPUTER_MAD;
        }
        String normalized = raw.trim();
        try {
            return PlayerType.valueOf(normalized.toUpperCase(Locale.ENGLISH));
        } catch (IllegalArgumentException ignored) {
        }
        try {
            return PlayerType.getByDescription(normalized);
        } catch (IllegalArgumentException ignored) {
            return PlayerType.COMPUTER_MAD;
        }
    }

    private List<PlayerType> resolveAiTypes(String raw) {
        PlayerType requested = parseAiType(raw);
        List<PlayerType> available = availablePlayerTypes();
        List<PlayerType> candidates = new ArrayList<>();
        addAiCandidate(candidates, requested, available);

        PlayerType[] preferred = new PlayerType[]{
                PlayerType.COMPUTER_MAD,
                PlayerType.COMPUTER_MONTE_CARLO
        };
        for (PlayerType candidate : preferred) {
            addAiCandidate(candidates, candidate, available);
        }
        for (PlayerType candidate : available) {
            if (candidate.isAI() && candidate.isWorkablePlayer()) {
                addAiCandidate(candidates, candidate, available);
            }
        }
        return candidates;
    }

    private void addAiCandidate(List<PlayerType> candidates, PlayerType candidate, Collection<PlayerType> available) {
        if (isSupportedWorkableAi(candidate, available) && !candidates.contains(candidate)) {
            candidates.add(candidate);
        }
    }

    private boolean isSupportedWorkableAi(PlayerType type, Collection<PlayerType> available) {
        return type != null && type.isAI() && type.isWorkablePlayer() && available.contains(type);
    }

    private boolean isAiCreationFailure(String message) {
        return message != null && message.contains("Could not create player");
    }

    private List<PlayerType> availablePlayerTypes() {
        try {
            PlayerType[] types = session == null ? null : session.getPlayerTypes();
            if (types == null) {
                return new ArrayList<>();
            }
            return Arrays.asList(types);
        } catch (Throwable ignored) {
            return new ArrayList<>();
        }
    }

    private String noPlayableAiMessage() {
        return "The connected MAGE server does not expose a playable AI player type. Available player types: "
                + describePlayerTypes(availablePlayerTypes())
                + ". Choose Real Player or use a MAGE server with AI plugins enabled.";
    }

    private String describePlayerTypes(Collection<PlayerType> playerTypes) {
        if (playerTypes == null || playerTypes.isEmpty()) {
            return "none";
        }
        List<String> names = new ArrayList<>();
        for (PlayerType playerType : playerTypes) {
            names.add(playerType.toString());
        }
        return String.join(", ", names);
    }

    private String connectionUserName(String requestedName) {
        String sessionSuffix = id == null ? "" : id.toLowerCase(Locale.ENGLISH).replaceAll("[^a-z0-9]", "");
        String raw = ("web" + sessionSuffix).replaceAll("[^a-z0-9_]", "_");
        if (raw.length() < 6) {
            raw = valueOrDefault(requestedName, "webplayer").toLowerCase(Locale.ENGLISH).replaceAll("[^a-z0-9_]", "_");
        }
        if (raw.length() < 3) {
            raw = "web" + raw;
        }
        if (raw.length() > 14) {
            raw = raw.substring(0, 14);
        }
        return raw;
    }

    private void waitForLastUserMessage() {
        for (int i = 0; i < 20; i++) {
            if (lastUserMessage != null && !lastUserMessage.trim().isEmpty()) {
                return;
            }
            try {
                Thread.sleep(50);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    private void finishWithError(String message) {
        publishError(message);
        markTerminal();
        disconnectFromServer();
    }

    private void markTerminal() {
        clearWaitingRegistration();
        if (!terminal) {
            terminal = true;
            terminalAtMillis = System.currentTimeMillis();
        }
        touch();
    }

    private void touch() {
        lastActivityMillis = System.currentTimeMillis();
    }

    private static long minutesToMillis(long minutes) {
        return minutes * 60L * 1000L;
    }

    private void disconnectFromServer() {
        if (session == null) {
            return;
        }
        try {
            session.connectStop(false, false);
        } catch (Throwable ignored) {
        }
    }

    private void removeWaitingTable(UUID roomId, UUID tableId) {
        if (session == null || roomId == null || tableId == null) {
            return;
        }
        try {
            session.removeTable(roomId, tableId);
        } catch (Throwable ignored) {
        }
    }

    private void removeCurrentTable() {
        UUID currentRoomId = roomId;
        UUID currentTableId = tableId;
        removeWaitingTable(currentRoomId, currentTableId);
        if (currentTableId != null && currentTableId.equals(tableId)) {
            tableId = null;
        }
    }

    private Map<String, Object> event(String type, Object payload) {
        Map<String, Object> event = newEvent(type);
        event.put("payload", payload == null ? null : gson.toJsonTree(payload));
        return event;
    }

    private Map<String, Object> newEvent(String type) {
        Map<String, Object> event = new HashMap<>();
        event.put("sessionId", id);
        event.put("type", type);
        event.put("sequence", eventSequence.incrementAndGet());
        event.put("time", System.currentTimeMillis());
        if (gameId != null) {
            event.put("gameId", gameId.toString());
        }
        if (playerId != null) {
            event.put("playerId", playerId.toString());
        }
        return event;
    }

    private void publish(String type, Map<String, Object> event) {
        touch();
        event.put("type", type);
        Map<String, Object> backlogEvent = new HashMap<>(event);
        synchronized (backlog) {
            if ("state".equals(type) && event.get("gameView") != null) {
                latestStateEvent = backlogEvent;
            }
            backlog.addLast(backlogEvent);
            while (backlog.size() > BACKLOG_SIZE) {
                backlog.removeFirst();
            }
        }
        String playerText = null;
        String spectatorText = null;
        for (WebSocketClient socket : sockets) {
            if (socket.readOnly) {
                if (spectatorText == null) {
                    spectatorText = serializeEvent(event, true);
                }
                socket.connection.sendText(spectatorText);
            } else {
                if (playerText == null) {
                    playerText = serializeEvent(event, false);
                }
                socket.connection.sendText(playerText);
            }
        }
    }

    private String serializeEvent(Map<String, Object> event, boolean spectator) {
        return gson.toJson(spectator ? redactSpectatorEvent(event) : event);
    }

    private Map<String, Object> redactSpectatorEvent(Map<String, Object> event) {
        Map<String, Object> redacted = new HashMap<>(event);
        redacted.put("spectator", true);
        redacted.put("gameView", redactedGameView(redacted.get("gameView")));
        redacted.remove("cardsView1");
        redacted.remove("cardsView2");
        return redacted;
    }

    private JsonElement redactedGameView(Object value) {
        if (!(value instanceof JsonElement)) {
            return value == null ? JsonNull.INSTANCE : gson.toJsonTree(value);
        }
        JsonElement element = (JsonElement) value;
        if (!element.isJsonObject()) {
            return element;
        }
        JsonObject gameView = element.getAsJsonObject().deepCopy();
        gameView.remove("myHand");
        gameView.remove("canPlayObjects");
        gameView.add("myPlayerId", JsonNull.INSTANCE);
        return gameView;
    }

    private String stringValue(JsonObject object, String name, String fallback) {
        JsonElement element = object.get(name);
        return element == null || element.isJsonNull() ? fallback : element.getAsString();
    }

    private boolean booleanValue(JsonObject object, String name, boolean fallback) {
        JsonElement element = object.get(name);
        return element == null || element.isJsonNull() ? fallback : element.getAsBoolean();
    }

    private int intValue(JsonObject object, String name, int fallback) {
        JsonElement element = object.get(name);
        return element == null || element.isJsonNull() ? fallback : element.getAsInt();
    }

    private UUID uuidValue(JsonObject object, String name, UUID fallback) {
        String value = stringValue(object, name, null);
        return value == null || value.trim().isEmpty() ? fallback : UUID.fromString(value);
    }

    private String uuidToString(UUID id) {
        return id == null ? null : id.toString();
    }

    private String valueOrDefault(String value, String defaultValue) {
        return value == null || value.trim().isEmpty() ? defaultValue : value.trim();
    }

    private String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    private String stringFromObject(Object value) {
        return value == null ? "" : value.toString();
    }

    private String withLastUserMessage(String message) {
        return withUserMessage(message, lastUserMessage);
    }

    private String withUserMessage(String message, String userMessage) {
        if (userMessage == null || userMessage.trim().isEmpty()) {
            return message;
        }
        return message + " " + userMessage;
    }

    private static final class AiStartAttempt {
        final boolean started;
        final boolean retryable;
        final String message;

        private AiStartAttempt(boolean started, boolean retryable, String message) {
            this.started = started;
            this.retryable = retryable;
            this.message = message;
        }

        static AiStartAttempt started() {
            return new AiStartAttempt(true, false, "");
        }

        static AiStartAttempt failed(boolean retryable, String message) {
            return new AiStartAttempt(false, retryable, message);
        }
    }

    private static final class WebSocketClient {
        final WebSocketConnection connection;
        final boolean readOnly;

        WebSocketClient(WebSocketConnection connection, boolean readOnly) {
            this.connection = connection;
            this.readOnly = readOnly;
        }
    }
}
