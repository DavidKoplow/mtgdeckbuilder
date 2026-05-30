package mage.webgateway;

import mage.interfaces.MageClient;
import mage.interfaces.callback.ClientCallback;
import mage.utils.MageVersion;

final class HeadlessMageClient implements MageClient {

    private final WebGameSession session;

    HeadlessMageClient(WebGameSession session) {
        this.session = session;
    }

    @Override
    public MageVersion getVersion() {
        return new MageVersion(HeadlessMageClient.class);
    }

    @Override
    public void connected(String message) {
        session.publishLifecycle("connected", message);
    }

    @Override
    public void disconnected(boolean askToReconnect, boolean keepMySessionActive) {
        session.handleDisconnected(askToReconnect, keepMySessionActive);
    }

    @Override
    public void showMessage(String message) {
        session.publishLifecycle("message", message);
    }

    @Override
    public void showError(String message) {
        session.publishError(message);
    }

    @Override
    public void onNewConnection() {
        session.publishLifecycle("newConnection", "Callback connection established");
    }

    @Override
    public void onCallback(ClientCallback callback) {
        session.handleCallback(callback);
    }
}
