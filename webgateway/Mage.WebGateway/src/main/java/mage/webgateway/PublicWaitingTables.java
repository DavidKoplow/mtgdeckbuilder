package mage.webgateway;

import mage.constants.TableState;
import mage.players.PlayerType;
import mage.view.SeatView;
import mage.view.TableView;

import java.util.Locale;

final class PublicWaitingTables {

    private PublicWaitingTables() {
    }

    static String supportedFormat(TableView table) {
        if (!isPublicWaiting(table) || waitingHumanPlayers(table) <= 0 || openHumanSeats(table) <= 0) {
            return null;
        }
        return formatFromTable(table);
    }

    static boolean isJoinable(TableView table, String format) {
        String supportedFormat = supportedFormat(table);
        return supportedFormat != null && supportedFormat.equals(normalize(format));
    }

    static int minimumRating(TableView table) {
        if (table == null || table.getMinimumRating() == null) {
            return 0;
        }
        try {
            return Math.max(0, Integer.parseInt(table.getMinimumRating().trim()));
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    static int waitingHumanPlayers(TableView table) {
        if (table == null || table.getSeats() == null) {
            return 0;
        }
        int players = 0;
        for (SeatView seat : table.getSeats()) {
            if (isOccupiedHumanSeat(seat)) {
                players++;
            }
        }
        return players;
    }

    private static int openHumanSeats(TableView table) {
        if (table == null || table.getSeats() == null) {
            return 0;
        }
        int seats = 0;
        for (SeatView seat : table.getSeats()) {
            if (seat != null
                    && !isOccupied(seat)
                    && PlayerType.HUMAN.equals(seat.getPlayerType())) {
                seats++;
            }
        }
        return seats;
    }

    private static boolean isPublicWaiting(TableView table) {
        return table != null
                && !table.isTournament()
                && TableState.WAITING.equals(table.getTableState())
                && !table.isPassworded();
    }

    private static String formatFromTable(TableView table) {
        String deckType = normalize(table.getDeckType());
        switch (deckType) {
            case "variant magic - commander":
                return "commander";
            case "constructed - standard":
                return "standard";
            case "constructed - pioneer":
                return "pioneer";
            case "constructed - modern":
                return "modern";
            case "constructed - legacy":
                return "legacy";
            case "constructed - vintage":
                return "vintage";
            case "constructed - pauper":
                return "pauper";
            case "constructed - freeform":
                return "freeform";
            default:
                return null;
        }
    }

    private static boolean isOccupiedHumanSeat(SeatView seat) {
        return seat != null && isOccupied(seat) && PlayerType.HUMAN.equals(seat.getPlayerType());
    }

    private static boolean isOccupied(SeatView seat) {
        return seat.getPlayerName() != null && !seat.getPlayerName().trim().isEmpty();
    }

    private static String normalize(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ENGLISH).trim();
    }
}
