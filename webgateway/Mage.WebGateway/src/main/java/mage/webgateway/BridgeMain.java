package mage.webgateway;

import mage.cards.repository.CardScanner;
import mage.cards.repository.RepositoryUtil;

import java.net.URI;
import java.net.URISyntaxException;

public final class BridgeMain {

    private static final String DEFAULT_MAGE_SERVER_HOST = "beta.xmage.today";
    private static final int DEFAULT_MAGE_SERVER_PORT = 17171;

    private BridgeMain() {
    }

    public static void main(String[] args) throws Exception {
        String host = readSetting("mage.web.host", "MAGE_WEB_HOST", "127.0.0.1");
        int port = readIntSetting("mage.web.port", "MAGE_WEB_PORT", 17888);
        ServerTarget serverTarget = readServerTarget();

        System.out.println("Initializing MAGE card repository for web gateway deck resolution");
        RepositoryUtil.bootstrapLocalDb();
        CardScanner.scan();

        GatewaySessionManager manager = new GatewaySessionManager(serverTarget.host, serverTarget.port);
        BridgeServer server = new BridgeServer(host, port, manager);
        System.out.println("MAGE web gateway listening on http://" + host + ":" + port);
        System.out.println("MAGE server target is " + serverTarget.host + ":" + serverTarget.port);
        server.start();
    }

    private static ServerTarget readServerTarget() {
        String serverUrl = readOptionalSetting("mage.server.url", "MAGE_SERVER_URL");
        if (serverUrl != null) {
            return parseServerUrl(serverUrl);
        }
        return new ServerTarget(
                readSetting("mage.server.host", "MAGE_SERVER_HOST", DEFAULT_MAGE_SERVER_HOST),
                readIntSetting("mage.server.port", "MAGE_SERVER_PORT", DEFAULT_MAGE_SERVER_PORT)
        );
    }

    private static ServerTarget parseServerUrl(String serverUrl) {
        String value = serverUrl.trim();
        if (value.contains("://")) {
            try {
                URI uri = new URI(value);
                if (uri.getHost() != null && !uri.getHost().trim().isEmpty()) {
                    int port = uri.getPort() > 0 ? uri.getPort() : DEFAULT_MAGE_SERVER_PORT;
                    return new ServerTarget(uri.getHost(), port);
                }
            } catch (URISyntaxException ignored) {
            }
            value = value.substring(value.indexOf("://") + 3);
        }

        int slash = value.indexOf('/');
        if (slash >= 0) {
            value = value.substring(0, slash);
        }
        int at = value.lastIndexOf('@');
        if (at >= 0) {
            value = value.substring(at + 1);
        }
        if (value.startsWith("[") && value.contains("]")) {
            int close = value.indexOf(']');
            String host = value.substring(1, close);
            int port = DEFAULT_MAGE_SERVER_PORT;
            if (close + 2 <= value.length() && value.charAt(close + 1) == ':') {
                port = parsePort(value.substring(close + 2), DEFAULT_MAGE_SERVER_PORT);
            }
            return new ServerTarget(host, port);
        }

        int colon = value.lastIndexOf(':');
        if (colon > 0 && value.indexOf(':') == colon) {
            return new ServerTarget(
                    value.substring(0, colon),
                    parsePort(value.substring(colon + 1), DEFAULT_MAGE_SERVER_PORT)
            );
        }
        return new ServerTarget(value.isEmpty() ? DEFAULT_MAGE_SERVER_HOST : value, DEFAULT_MAGE_SERVER_PORT);
    }

    private static int parsePort(String raw, int defaultValue) {
        try {
            return Integer.parseInt(raw);
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    private static String readOptionalSetting(String propertyName, String envName) {
        String fromProperty = System.getProperty(propertyName);
        if (fromProperty != null && !fromProperty.trim().isEmpty()) {
            return fromProperty.trim();
        }
        String fromEnv = System.getenv(envName);
        if (fromEnv != null && !fromEnv.trim().isEmpty()) {
            return fromEnv.trim();
        }
        return null;
    }

    private static String readSetting(String propertyName, String envName, String defaultValue) {
        String fromProperty = System.getProperty(propertyName);
        if (fromProperty != null && !fromProperty.trim().isEmpty()) {
            return fromProperty.trim();
        }
        String fromEnv = System.getenv(envName);
        if (fromEnv != null && !fromEnv.trim().isEmpty()) {
            return fromEnv.trim();
        }
        return defaultValue;
    }

    private static int readIntSetting(String propertyName, String envName, int defaultValue) {
        String value = readSetting(propertyName, envName, Integer.toString(defaultValue));
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    private static final class ServerTarget {
        final String host;
        final int port;

        ServerTarget(String host, int port) {
            this.host = host;
            this.port = port;
        }
    }
}
