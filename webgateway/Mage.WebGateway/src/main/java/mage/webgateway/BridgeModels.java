package mage.webgateway;

import java.util.ArrayList;
import java.util.List;

final class BridgeModels {

    private BridgeModels() {
    }

    static final class StartSoloGameRequest {
        String mageHost;
        Integer magePort;
        String playerName;
        Integer playerRating;
        String opponentName;
        String opponentType;
        String ai;
        String deckName;
        String format;
        List<DeckEntry> main = new ArrayList<>();
        List<DeckEntry> sideboard = new ArrayList<>();
        String opponentDeckName;
        List<DeckEntry> opponentMain = new ArrayList<>();
        List<DeckEntry> opponentSideboard = new ArrayList<>();
    }

    static final class DeckEntry {
        String name;
        int quantity;
        String set;
        String collectorNumber;
    }

    static final class StartSoloGameResponse {
        final String id;
        final String eventUrl;
        final boolean opponentDeckAccepted;

        StartSoloGameResponse(String id, String eventUrl, boolean opponentDeckAccepted) {
            this.id = id;
            this.eventUrl = eventUrl;
            this.opponentDeckAccepted = opponentDeckAccepted;
        }
    }

    static final class ErrorResponse {
        final String error;

        ErrorResponse(String error) {
            this.error = error;
        }
    }
}
