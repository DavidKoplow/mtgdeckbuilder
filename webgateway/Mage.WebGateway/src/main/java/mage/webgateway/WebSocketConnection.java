package mage.webgateway;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import java.util.Map;

final class WebSocketConnection {

    interface MessageHandler {
        void onMessage(String message);
    }

    private static final String ACCEPT_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final int MAX_FRAME_PAYLOAD_BYTES = GatewayExecutors.readIntSetting(
            "mage.web.websocketMaxFrameBytes",
            "MAGE_GATEWAY_WEBSOCKET_MAX_FRAME_BYTES",
            64 * 1024,
            1024
    );

    private final Socket socket;
    private final InputStream input;
    private final OutputStream output;

    private WebSocketConnection(Socket socket, InputStream input, OutputStream output) {
        this.socket = socket;
        this.input = input;
        this.output = output;
    }

    static WebSocketConnection accept(
            Socket socket,
            InputStream input,
            OutputStream output,
            Map<String, String> headers
    ) throws Exception {
        String key = headers.get("sec-websocket-key");
        if (key == null || key.trim().isEmpty()) {
            throw new IOException("Missing Sec-WebSocket-Key");
        }
        MessageDigest digest = MessageDigest.getInstance("SHA-1");
        String accept = Base64.getEncoder().encodeToString(
                digest.digest((key.trim() + ACCEPT_GUID).getBytes(StandardCharsets.ISO_8859_1))
        );
        String response = "HTTP/1.1 101 Switching Protocols\r\n"
                + "Upgrade: websocket\r\n"
                + "Connection: Upgrade\r\n"
                + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
        output.write(response.getBytes(StandardCharsets.ISO_8859_1));
        output.flush();
        return new WebSocketConnection(socket, input, output);
    }

    void readLoop(MessageHandler handler, Runnable onClose) {
        try {
            while (!socket.isClosed()) {
                Frame frame = readFrame();
                if (frame == null) {
                    break;
                }
                if (frame.opcode == 0x8) {
                    break;
                }
                if (frame.opcode == 0x9) {
                    sendFrame(0xA, frame.payload);
                    continue;
                }
                if (frame.opcode == 0x1) {
                    handler.onMessage(new String(frame.payload, StandardCharsets.UTF_8));
                }
            }
        } catch (IOException ignored) {
        } finally {
            onClose.run();
            close(null);
        }
    }

    synchronized void sendText(String text) {
        try {
            sendFrame(0x1, text.getBytes(StandardCharsets.UTF_8));
        } catch (IOException ignored) {
            close(null);
        }
    }

    synchronized void close(String reason) {
        try {
            if (!socket.isClosed()) {
                if (reason != null && !reason.isEmpty()) {
                    sendFrame(0x8, closePayload(reason));
                }
                socket.close();
            }
        } catch (IOException ignored) {
        }
    }

    private byte[] closePayload(String reason) {
        byte[] reasonBytes = reason.getBytes(StandardCharsets.UTF_8);
        int reasonLength = Math.min(reasonBytes.length, 123);
        byte[] payload = new byte[2 + reasonLength];
        payload[0] = 0x03;
        payload[1] = (byte) 0xE8;
        System.arraycopy(reasonBytes, 0, payload, 2, reasonLength);
        return payload;
    }

    private Frame readFrame() throws IOException {
        int first = input.read();
        if (first == -1) {
            return null;
        }
        int second = input.read();
        if (second == -1) {
            return null;
        }
        int opcode = first & 0x0F;
        boolean masked = (second & 0x80) != 0;
        long length = second & 0x7F;
        if (length == 126) {
            length = readUnsignedShort();
        } else if (length == 127) {
            length = readLongLength();
        }
        if (length < 0 || length > MAX_FRAME_PAYLOAD_BYTES) {
            throw new IOException("WebSocket frame is too large");
        }
        byte[] mask = masked ? readFixed(4) : null;
        byte[] payload = readFixed((int) length);
        if (mask != null) {
            for (int i = 0; i < payload.length; i++) {
                payload[i] = (byte) (payload[i] ^ mask[i % 4]);
            }
        }
        return new Frame(opcode, payload);
    }

    private int readUnsignedShort() throws IOException {
        byte[] bytes = readFixed(2);
        return ((bytes[0] & 0xFF) << 8) | (bytes[1] & 0xFF);
    }

    private long readLongLength() throws IOException {
        byte[] bytes = readFixed(8);
        return ByteBuffer.wrap(bytes).getLong();
    }

    private byte[] readFixed(int length) throws IOException {
        byte[] bytes = new byte[length];
        int offset = 0;
        while (offset < length) {
            int read = input.read(bytes, offset, length - offset);
            if (read == -1) {
                throw new IOException("Unexpected end of WebSocket frame");
            }
            offset += read;
        }
        return bytes;
    }

    private void sendFrame(int opcode, byte[] payload) throws IOException {
        ByteArrayOutputStream frame = new ByteArrayOutputStream();
        frame.write(0x80 | opcode);
        if (payload.length <= 125) {
            frame.write(payload.length);
        } else if (payload.length <= 65535) {
            frame.write(126);
            frame.write((payload.length >>> 8) & 0xFF);
            frame.write(payload.length & 0xFF);
        } else {
            frame.write(127);
            byte[] length = ByteBuffer.allocate(8).putLong(payload.length).array();
            frame.write(length);
        }
        frame.write(payload);
        output.write(frame.toByteArray());
        output.flush();
    }

    private static final class Frame {
        final int opcode;
        final byte[] payload;

        Frame(int opcode, byte[] payload) {
            this.opcode = opcode;
            this.payload = Arrays.copyOf(payload, payload.length);
        }
    }
}
