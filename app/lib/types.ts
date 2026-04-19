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
  collector_number?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  layout?: string;
  image_uris?: ScryfallImageUris;
  card_faces?: ScryfallCardFace[];
  scryfall_uri?: string;
  prices?: { usd?: string | null };
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
  // Snapshot so decks still render when offline / API is down
  imageSmall?: string;
  imageNormal?: string;
  manaCost?: string;
  cmc?: number;
  typeLine?: string;
  colors?: string[];
  set?: string;
  collectorNumber?: string;
  priceUsd?: number;
};

export type Deck = {
  id: string;
  name: string;
  format: string;
  createdAt: number;
  updatedAt: number;
  entries: DeckEntry[];
};
