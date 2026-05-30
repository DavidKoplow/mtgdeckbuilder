export type ScryfallImageUris = {
  small?: string;
  normal?: string;
  large?: string;
  png?: string;
  art_crop?: string;
  border_crop?: string;
};

export type ScryfallCardFace = {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  image_uris?: ScryfallImageUris;
};

export type ScryfallCard = {
  id: string;
  oracle_id?: string;
  name: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
  color_identity?: string[];
  rarity?: string;
  set?: string;
  set_name?: string;
  released_at?: string;
  collector_number?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  layout?: string;
  image_uris?: ScryfallImageUris;
  card_faces?: ScryfallCardFace[];
  scryfall_uri?: string;
  legalities?: Record<string, string>;
  printings?: string[];
  prices?: { usd?: string | null };
  edhrec_rank?: number;
  similarity?: number;
  rerank_score?: number;
};

export type ScryfallSearchResponse = {
  object: "list";
  total_cards?: number;
  has_more: boolean;
  next_page?: string;
  data: ScryfallCard[];
};

export type ScryfallError = {
  object: "error";
  code: string;
  status: number;
  details: string;
  warnings?: string[];
};

export type ScryfallSet = {
  id: string;
  code: string;
  name: string;
  set_type?: string;
  released_at?: string;
  card_count?: number;
  icon_svg_uri?: string;
  digital?: boolean;
};

export type ScryfallSetsResponse = {
  object: "list";
  has_more: boolean;
  data: ScryfallSet[];
};

export type DeckEntry = {
  cardId: string;
  name: string;
  quantity: number;
  isCommander?: boolean;
  // Snapshot so decks still render when offline / API is down
  imageSmall?: string;
  imageNormal?: string;
  imageArtCrop?: string;
  manaCost?: string;
  cmc?: number;
  typeLine?: string;
  colors?: string[];
  rarity?: string;
  set?: string;
  collectorNumber?: string;
  priceUsd?: number;
  legalities?: Record<string, string>;
};

export type DeckZone = "main" | "sideboard" | "maybeboard";

export type Deck = {
  id: string;
  publicId?: string;
  isPublic: boolean;
  name: string;
  format: string;
  cardCount: number;
  sideboardCount: number;
  maybeboardCount: number;
  createdAt: number;
  updatedAt: number;
  entries: DeckEntry[];
  sideboard: DeckEntry[];
  maybeboard: DeckEntry[];
};

export type DeckSummary = Omit<Deck, "entries" | "sideboard" | "maybeboard">;

export type PublicDeckPreviewCard = {
  name: string;
  quantity: number;
};

export type DeckColorBreakdown = {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  C: number;
};

export type PublicDeckSummary = {
  publicId: string;
  ownedDeckId?: string;
  name: string;
  format: string;
  cardCount: number;
  sideboardCount: number;
  maybeboardCount: number;
  createdAt: number;
  updatedAt: number;
  authorName: string;
  sourceType?: string;
  sourceId?: string;
  sourceUrl?: string;
  sourceDeckCode?: string;
  sourceDeckFileName?: string;
  sourceDeckType?: string;
  sourceReleaseDate?: string;
  sourceUpdatedAt?: number;
  sourceVersion?: string;
  viewCount: number;
  matchingCards: PublicDeckPreviewCard[];
  previewCards: PublicDeckPreviewCard[];
  featuredCardName?: string;
  featuredImage?: string;
  totalPriceUsd?: number;
  pricedCardCount: number;
  manaCurve: number[];
  colorBreakdown: DeckColorBreakdown;
};

export type PublicDeck = Omit<Deck, "publicId"> & {
  publicId: string;
  ownedDeckId?: string;
  authorName: string;
  sourceType?: string;
  sourceId?: string;
  sourceUrl?: string;
  sourceDeckCode?: string;
  sourceDeckFileName?: string;
  sourceDeckType?: string;
  sourceReleaseDate?: string;
  sourceUpdatedAt?: number;
  sourceVersion?: string;
};
