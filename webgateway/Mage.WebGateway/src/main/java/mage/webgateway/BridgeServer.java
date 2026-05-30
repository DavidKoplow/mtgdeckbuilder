package mage.webgateway;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;

final class BridgeServer {

    private final String host;
    private final int port;
    private final GatewaySessionManager manager;
    private final ThreadPoolExecutor executor = GatewayExecutors.newBoundedExecutor(
            "mage-http",
            GatewayExecutors.readIntSetting("mage.web.httpThreads", "MAGE_GATEWAY_HTTP_THREADS", 64, 2),
            GatewayExecutors.readIntSetting("mage.web.httpQueue", "MAGE_GATEWAY_HTTP_QUEUE", 512, 0)
    );
    private final int maxRequestBodyBytes = GatewayExecutors.readIntSetting(
            "mage.web.maxRequestBodyBytes",
            "MAGE_GATEWAY_MAX_REQUEST_BODY_BYTES",
            1024 * 1024,
            1024
    );
    private final Gson gson = new GsonBuilder().disableHtmlEscaping().create();

    BridgeServer(String host, int port, GatewaySessionManager manager) {
        this.host = host;
        this.port = port;
        this.manager = manager;
    }

    void start() throws IOException {
        ServerSocket serverSocket = new ServerSocket();
        serverSocket.bind(new InetSocketAddress(host, port));
        while (true) {
            final Socket socket = serverSocket.accept();
            try {
                executor.execute(new Runnable() {
                    @Override
                    public void run() {
                        handle(socket);
                    }
                });
            } catch (RejectedExecutionException e) {
                writeBusyAndClose(socket);
            }
        }
    }

    private void handle(Socket socket) {
        try {
            socket.setTcpNoDelay(true);
            InputStream input = socket.getInputStream();
            OutputStream output = socket.getOutputStream();
            HttpRequest request = readRequest(input);
            if (request == null) {
                socket.close();
                return;
            }

            if ("OPTIONS".equals(request.method)) {
                writeJson(output, 204, null);
                socket.close();
                return;
            }

            if ("GET".equals(request.method) && "/health".equals(request.path)) {
                String mageHost = queryValue(request.query, "mageHost");
                int magePort = parseInt(queryValue(request.query, "magePort"), -1);
                Map<String, Object> payload = new HashMap<>();
                payload.put("ok", Boolean.TRUE);
                payload.putAll(manager.healthPayload(mageHost, magePort));
                writeJson(output, 200, payload);
                socket.close();
                return;
            }

            if ("POST".equals(request.method)
                    && ("/v1/games".equals(request.path) || "/v1/solo-games".equals(request.path))) {
                BridgeModels.StartSoloGameRequest startRequest =
                        gson.fromJson(request.body, BridgeModels.StartSoloGameRequest.class);
                String id;
                try {
                    id = manager.createSession(startRequest);
                } catch (RejectedExecutionException e) {
                    writeJson(output, 503, new BridgeModels.ErrorResponse("The MAGE gateway is at capacity."));
                    socket.close();
                    return;
                }
                String eventPath = "/v1/games/" + id + "/events";
                String eventUrl = websocketBaseUrl(request.headers) + eventPath;
                writeJson(output, 200, new BridgeModels.StartSoloGameResponse(
                        id,
                        eventUrl,
                        hasOpponentDeck(startRequest)
                ));
                socket.close();
                return;
            }

            String websocketId = websocketSessionId(request.path);
            if ("GET".equals(request.method) && websocketId != null) {
                boolean spectator = hasQueryFlag(request.query, "spectator");
                if ("websocket".equalsIgnoreCase(request.headers.get("upgrade"))) {
                    WebSocketConnection connection = WebSocketConnection.accept(socket, input, output, request.headers);
                    if (!manager.attachWebSocket(websocketId, connection, spectator)) {
                        connection.close("Unknown game session");
                        return;
                    }
                    return;
                }
                Map<String, Object> payload = manager.sessionEventsPayload(websocketId, spectator);
                if (payload == null) {
                    writeJson(output, 404, new BridgeModels.ErrorResponse("Unknown game session"));
                } else {
                    writeJson(output, 200, payload);
                }
                socket.close();
                return;
            }

            writeJson(output, 404, new BridgeModels.ErrorResponse("Not found"));
            socket.close();
        } catch (RequestTooLargeException e) {
            try {
                OutputStream output = socket.getOutputStream();
                writeJson(output, 413, new BridgeModels.ErrorResponse(e.getMessage()));
            } catch (IOException ignored) {
            }
            try {
                socket.close();
            } catch (IOException ignored) {
            }
        } catch (Exception e) {
            try {
                OutputStream output = socket.getOutputStream();
                writeJson(output, 500, new BridgeModels.ErrorResponse(e.getMessage()));
            } catch (IOException ignored) {
            }
            try {
                socket.close();
            } catch (IOException ignored) {
            }
        }
    }

    private void writeBusyAndClose(Socket socket) {
        try {
            OutputStream output = socket.getOutputStream();
            writeJson(output, 503, new BridgeModels.ErrorResponse("The MAGE gateway is at capacity."));
        } catch (IOException ignored) {
        }
        try {
            socket.close();
        } catch (IOException ignored) {
        }
    }

    private String websocketBaseUrl(Map<String, String> headers) {
        String forwardedProto = headers.get("x-forwarded-proto");
        String scheme = "https".equalsIgnoreCase(forwardedProto) ? "wss" : "ws";
        String hostHeader = headers.get("host");
        if (hostHeader == null || hostHeader.trim().isEmpty()) {
            hostHeader = host + ":" + port;
        }
        return scheme + "://" + hostHeader;
    }

    private boolean hasOpponentDeck(BridgeModels.StartSoloGameRequest request) {
        return request != null
                && request.opponentMain != null
                && !request.opponentMain.isEmpty();
    }

    private String websocketSessionId(String path) {
        String suffix = "/events";
        String[] prefixes = new String[]{"/v1/games/", "/v1/solo-games/"};
        for (String prefix : prefixes) {
            if (path.startsWith(prefix) && path.endsWith(suffix)) {
                return path.substring(prefix.length(), path.length() - suffix.length());
            }
        }
        return null;
    }

    private HttpRequest readRequest(InputStream input) throws IOException {
        String headerText = readHeaders(input);
        if (headerText == null || headerText.isEmpty()) {
            return null;
        }
        String[] lines = headerText.split("\\r?\\n");
        if (lines.length == 0) {
            return null;
        }
        String[] requestParts = lines[0].split(" ");
        if (requestParts.length < 2) {
            return null;
        }
        Map<String, String> headers = new HashMap<>();
        for (int i = 1; i < lines.length; i++) {
            int separator = lines[i].indexOf(':');
            if (separator > 0) {
                headers.put(
                        lines[i].substring(0, separator).trim().toLowerCase(Locale.ENGLISH),
                        lines[i].substring(separator + 1).trim()
                );
            }
        }
        int contentLength = parseInt(headers.get("content-length"), 0);
        if (contentLength > maxRequestBodyBytes) {
            throw new RequestTooLargeException("Request body is too large.");
        }
        byte[] body = readFixed(input, contentLength);
        String path = requestParts[1];
        String query = "";
        int queryStart = path.indexOf('?');
        if (queryStart >= 0) {
            query = path.substring(queryStart + 1);
            path = path.substring(0, queryStart);
        }
        return new HttpRequest(
                requestParts[0].toUpperCase(Locale.ENGLISH),
                path,
                query,
                headers,
                new String(body, StandardCharsets.UTF_8)
        );
    }

    private String readHeaders(InputStream input) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        int matched = 0;
        int value;
        byte[] marker = new byte[]{'\r', '\n', '\r', '\n'};
        while ((value = input.read()) != -1) {
            buffer.write(value);
            if (value == marker[matched]) {
                matched++;
                if (matched == marker.length) {
                    break;
                }
            } else {
                matched = value == marker[0] ? 1 : 0;
            }
            if (buffer.size() > 65536) {
                throw new IOException("HTTP headers are too large");
            }
        }
        return new String(buffer.toByteArray(), StandardCharsets.ISO_8859_1);
    }

    private byte[] readFixed(InputStream input, int length) throws IOException {
        byte[] body = new byte[length];
        int offset = 0;
        while (offset < length) {
            int read = input.read(body, offset, length - offset);
            if (read == -1) {
                throw new IOException("Unexpected end of request body");
            }
            offset += read;
        }
        return body;
    }

    private void writeJson(OutputStream output, int status, Object payload) throws IOException {
        String body = payload == null ? "" : gson.toJson(payload);
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String reason = status == 200
                ? "OK"
                : status == 204
                ? "No Content"
                : status == 400
                ? "Bad Request"
                : status == 404
                ? "Not Found"
                : status == 413
                ? "Payload Too Large"
                : status == 503
                ? "Service Unavailable"
                : "Error";
        String headers = "HTTP/1.1 " + status + " " + reason + "\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Access-Control-Allow-Headers: content-type\r\n"
                + "Access-Control-Allow-Methods: GET,POST,OPTIONS\r\n"
                + "Content-Type: application/json; charset=utf-8\r\n"
                + "Content-Length: " + bytes.length + "\r\n"
                + "Connection: close\r\n\r\n";
        output.write(headers.getBytes(StandardCharsets.ISO_8859_1));
        output.write(bytes);
        output.flush();
    }

    private static final class RequestTooLargeException extends IOException {
        RequestTooLargeException(String message) {
            super(message);
        }
    }

    private int parseInt(String raw, int fallback) {
        if (raw == null) {
            return fallback;
        }
        try {
            return Integer.parseInt(raw);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private boolean hasQueryFlag(String query, String key) {
        if (query == null || query.isEmpty()) {
            return false;
        }
        String prefix = key + "=";
        for (String part : query.split("&")) {
            if (part.equals(key) || part.startsWith(prefix)) {
                String value = part.equals(key) ? "1" : part.substring(prefix.length());
                return value.isEmpty()
                        || "1".equals(value)
                        || "true".equalsIgnoreCase(value)
                        || "yes".equalsIgnoreCase(value);
            }
        }
        return false;
    }

    private String queryValue(String query, String key) {
        if (query == null || query.isEmpty()) {
            return null;
        }
        String prefix = key + "=";
        for (String part : query.split("&")) {
            if (part.startsWith(prefix)) {
                return decodeQueryValue(part.substring(prefix.length()));
            }
        }
        return null;
    }

    private String decodeQueryValue(String value) {
        try {
            return URLDecoder.decode(value, "UTF-8");
        } catch (Exception e) {
            return value;
        }
    }

    private static final class HttpRequest {
        final String method;
        final String path;
        final String query;
        final Map<String, String> headers;
        final String body;

        HttpRequest(String method, String path, String query, Map<String, String> headers, String body) {
            this.method = method;
            this.path = path;
            this.query = query;
            this.headers = headers;
            this.body = body;
        }
    }
}
