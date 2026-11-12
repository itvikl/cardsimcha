export type Category = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  /** its pictures are stickers: customers can put them on their designs */
  stickers?: boolean;
};

export type ImageAsset = {
  id: string;
  categoryId: string;
  name: string;
  file: string; // file name inside data/uploads
  width: number;
  height: number;
  createdAt: string;
  /** a transparent picture a customer can place on a design, as its category says */
  sticker?: boolean;
  /** what the picture shows, and the category names it suits: how a customer or the system finds a sticker */
  tags?: string[];
  /** a business's own sticker, from its own file: stays in its private category, so only it sees it */
  ownSticker?: boolean;
  /** taken off the business's list of pictures; designs made with it keep showing it */
  removed?: boolean;
};

export type PageSpec = {
  width_mm: number;
  height_mm: number;
  background: string;
  /** with it the page is a gradient from `background` to this colour, at `backgroundAngle` degrees */
  background2?: string;
  backgroundAngle?: number;
};

/** the details a business writes in its brand kit */
export type BrandDetail = 'businessName' | 'phone' | 'slogan' | 'address' | 'website';
/** which detail of the week's Shabbat times a text shows */
export type ShabbatTextRole = 'parsha' | 'candles' | 'havdalah' | 'city' | 'hebrewDate';
/** which detail of a business's brand kit a text shows; `initial` is the first letter of its name (for monograms) */
export type BrandTextRole = BrandDetail | 'initial';
/** which colour of a business's brand kit an element takes; `on…` is black or white, whichever reads on that colour */
export type BrandColorRole = 'primaryColor' | 'secondaryColor' | 'onPrimary' | 'onSecondary';

export type TextElement = {
  id: string;
  type: 'text';
  x_mm: number;
  y_mm: number;
  w_mm: number;
  rotation: number;
  z: number;
  text: string;
  align: 'right' | 'center' | 'left';
  /** customers may change the text of this element (shown to them as a form field) */
  editable?: boolean;
  /** field name shown to the customer */
  label?: string;
  /** a business's copy shows this detail of its brand kit instead of the sample text */
  role?: BrandTextRole;
  colorRole?: BrandColorRole;
  /** this text is filled from the week's Shabbat times (see shabbat.ts); nobody types it */
  shabbatRole?: ShabbatTextRole;
  /** the site's credit line: stays on free copies, a subscriber's copy doesn't get it */
  credit?: boolean;
  /** a wording's field for the customer's own details: what they wrote stays when they change wording, by `label` */
  detail?: boolean;
  /** the colour the designer gave this wording's text; matching it to a background always starts from here */
  designColor?: string;
  /** bends the line onto a circle, -100 to 100 (see arcText.ts); unset or near 0 is a straight line */
  arc?: number;
  /** extra space between letters, in pt; negative draws them closer */
  letterSpacing?: number;
  /** the distance between lines as a multiple of the font size; unset is 1.25 */
  lineHeight?: number;
  /** 'shrink': the text gets smaller until each of its lines fits the box on one line */
  fit?: 'shrink';
  /** a soft shadow under the letters */
  shadow?: boolean;
  /** an outline around the letters */
  stroke?: { color: string; width_mm: number };
  /** a metal foil look instead of the flat colour */
  foil?: 'gold' | 'silver';
  /** elements sharing this move, align and get selected together (Ctrl+G) */
  group?: string;
  /** an author's lock: the element stays where it is in the editor and clicks go through it */
  locked?: boolean;
  /** hidden in the editor and left out of every download */
  hidden?: boolean;
  /** a text the business added to its ad itself: it can restyle or remove it */
  own?: boolean;
  /** generated for this catalog item by applyProducts; the next choice of products replaces it */
  product?: string;
  font: { family: string; weight: 400 | 700; size_pt: number; color: string };
};

export type ImageElement = {
  id: string;
  type: 'image';
  x_mm: number;
  y_mm: number;
  w_mm: number;
  h_mm: number;
  rotation: number;
  z: number;
  asset_id: string;
  /** customers may replace this image with another one from `swapCategoryId` (e.g. the card background) */
  swappable?: boolean;
  swapCategoryId?: string;
  /** when set, the element is drawn as a flat colour instead of its image (customer's "plain colour" background) */
  colorOverride?: string;
  /** name shown to the customer, e.g. "רקע" */
  label?: string;
  /**
   * `logo`: a business's copy shows its own logo here, fitted inside this box. `photo`: a picture from its catalog can go here.
   * `sticker`: placed by the customer or the system; the customer can move, resize or remove it.
   */
  role?: 'logo' | 'photo' | 'sticker';
  /** a `photo`'s visible place: a picture covers it, and whatever it overflows is hidden by what is drawn over it */
  photoBox?: { x_mm: number; y_mm: number; w_mm: number; h_mm: number };
  /** in the design's video, this picture is replaced by that moving background (see shabbatLoops.ts) */
  loopId?: string;
  /** generated for this catalog item by applyProducts; the next choice of products replaces it */
  product?: string;
  /** the picture shows through this shape instead of its square box */
  mask?: 'circle' | 'rounded' | 'arch';
  /**
   * The part of the picture the box shows: it covers the box at `zoom` 1 and closer above that, moved by `x` and `y`
   * (-1 to 1, from the middle to an edge). Unset: the whole picture is drawn into the box, as before.
   */
  crop?: { zoom: number; x: number; y: number };
  /** elements sharing this move, align and get selected together (Ctrl+G) */
  group?: string;
  /** an author's lock: the element stays where it is in the editor and clicks go through it */
  locked?: boolean;
  /** hidden in the editor and left out of every download */
  hidden?: boolean;
};

export type ShapeElement = {
  id: string;
  type: 'rect';
  x_mm: number;
  y_mm: number;
  w_mm: number;
  h_mm: number;
  rotation: number;
  z: number;
  fill: string;
  colorRole?: BrandColorRole;
  /**
   * `logoPlate`: the plate behind the business's logo, which goes with the logo when the business has none.
   * `productArea`: where the ad's products are laid out (see products.ts); drawn under them.
   */
  role?: 'logoPlate' | 'productArea';
  /** rounded corners; half the shorter side makes a pill or a circle */
  cornerRadius_mm?: number;
  /** 0 to 1; unset is solid */
  opacity?: number;
  /** with it the shape is a gradient from `fill` to this colour, at `angle` degrees */
  fill2?: string;
  angle?: number;
  /** elements sharing this move, align and get selected together (Ctrl+G) */
  group?: string;
  /** an author's lock: the element stays where it is in the editor and clicks go through it */
  locked?: boolean;
  /** hidden in the editor and left out of every download */
  hidden?: boolean;
  /** generated for this catalog item by applyProducts; the next choice of products replaces it */
  product?: string;
};

export type CanvasElement = TextElement | ImageElement | ShapeElement;

export type CanvasDoc = {
  schema_version: 1;
  page: PageSpec;
  elements: CanvasElement[];
  /** the wording this card's texts came from; only a card that has one can change wording (see wording.ts) */
  wordingId?: string;
  /** what this card's texts lie on, when the customer chose another backdrop than the card's own (see backdrop.ts) */
  backdropId?: string;
  /** the catalog items on an ad with a product area, in order; unset while it still shows the sample ones (see products.ts) */
  productIds?: string[];
};

export type Role = 'admin' | 'user';

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
  salt: string;
  createdAt: string;
  /** a visitor working without an account: signing up or in keeps what they made (see guest.ts) */
  guest?: boolean;
};

export type Session = {
  tokenHash: string;
  userId: string;
  expiresAt: number;
};

/**
 * A template is built by an admin; a design is a customer's copy of a template.
 * A wording is also built by an admin: designed texts that any card of its topic and page size can take.
 */
export type Project = {
  id: string;
  kind: 'template' | 'design' | 'wording';
  ownerId: string;
  templateId?: string;
  status: 'draft' | 'published'; // only meaningful for templates
  name: string;
  /** topic shown to customers as a category tile on the home page, e.g. "בית כנסת" (templates only) */
  topic?: string;
  /** price in shekels shown to customers, set by an admin; unset shows no price (templates only) */
  price?: number;
  /** templates sharing this name are one series: a customer can take them all at once (templates only) */
  series?: string;
  /** templates sharing this are one ad in different sizes; only the one that also has a `series` shows in the plain gallery (templates only) */
  sizeGroup?: string;
  /** designs only: the copies made together from a series share this, and are paid for together */
  seriesRun?: string;
  /** designs only: the Friday (YYYY-MM-DD) whose Shabbat times were written in; after it the design is out of date */
  shabbatFor?: string;
  /** designs only: the business keeps this one as its own template, to start a new ad from it each time */
  keep?: boolean;
  canvas: CanvasDoc;
  thumbnail?: string;
  createdAt: string;
  updatedAt: string;
  /**
   * designs only: when the customer first changed the content or name. null = opened but never edited
   * (kept out of the basket); missing = created before this was tracked.
   */
  editedAt?: string | null;
};

/** admin's choices for one home-page carousel card, keyed by its topic name */
export type CarouselSlide = {
  id: string;
  name: string;
  /** '/categories/…' or '/api/uploads/…' URL, or 'template:<id>' for that template's thumbnail; null keeps the default cover */
  image: string | null;
  hidden: boolean;
  order: number;
  /** which home-page door shows it; unset means the default from CATEGORIES (private for free topics) */
  audience?: 'private' | 'business';
};

/** A business's details, written once and dealt into every design. Each user has one: its id is the user's id. */
export type BrandKit = {
  id: string;
  businessName: string;
  phone: string;
  slogan: string;
  address: string;
  website: string;
  primaryColor: string;
  secondaryColor: string;
  logo?: { assetId: string; file: string; width: number; height: number };
  /** the QR code on its ads, and where it leads; made on the server when the kit is saved (see brandQr.ts) */
  qr?: { target: QrTarget; url: string; assetId: string; file: string; width: number; height: number };
  /** what the business tells about itself, so an ad can say true and specific things */
  profile?: BusinessProfile;
  updatedAt: string;
};

/** what a business's QR code opens */
export type QrTarget = 'website' | 'whatsapp';

export type BusinessProfile = {
  services: string;
  area: string;
  experience: string;
  promise: string;
  reviews: string;
};

/** A product, project or service a business keeps ready for its ads. Only its owner sees it. */
export type CatalogItem = {
  id: string;
  ownerId: string;
  name: string;
  details: string;
  /** as the business writes it, e.g. "2,490 ₪ כולל התקנה" */
  price: string;
  photo?: { assetId: string; file: string; width: number; height: number };
  createdAt: string;
  updatedAt: string;
};

/** A font an admin uploaded for designs; `customer` offers it to businesses when they write their own text. */
export type FontAsset = {
  id: string;
  family: string;
  file: string;
  customer: boolean;
  createdAt: string;
};

/** How many ads a user asked the system to write on one day; its id is "<user id>:<YYYY-MM-DD>". */
export type DailyUse = { id: string; count: number };

/** A customer's monthly plan. Each user has at most one: its id is the user's id. */
export type Subscription = {
  id: string;
  /** canceled: no more charges, and it still counts until currentPeriodEnd */
  status: 'active' | 'canceled';
  currentPeriodEnd: string;
  provider: string;
  providerRef: string;
  updatedAt: string;
};

/** One payment attempt. The amount is worked out on the server when it starts. */
export type Purchase = {
  id: string;
  userId: string;
  kind: 'ad' | 'series' | 'subscription';
  /** kind 'ad': the design it opens */
  projectId?: string;
  /** kind 'series': the designs it opens, which share this */
  seriesRun?: string;
  amount: number;
  status: 'pending' | 'paid' | 'failed' | 'canceled';
  provider: string;
  providerRef?: string;
  createdAt: string;
  settledAt?: string;
};

export type Db = {
  fonts: FontAsset[];
  catalog: CatalogItem[];
  usage: DailyUse[];
  subscriptions: Subscription[];
  purchases: Purchase[];
  brands: BrandKit[];
  categories: Category[];
  carousel: CarouselSlide[];
  images: ImageAsset[];
  projects: Project[];
  users: User[];
  sessions: Session[];
};
