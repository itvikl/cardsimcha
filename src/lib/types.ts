export type Category = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
};

export type ImageAsset = {
  id: string;
  categoryId: string;
  name: string;
  file: string; // file name inside data/uploads
  width: number;
  height: number;
  createdAt: string;
};

export type PageSpec = {
  width_mm: number;
  height_mm: number;
  background: string;
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
  /** `logo`: a business's copy shows its own logo here, fitted inside this box. `photo`: a picture from its catalog can go here */
  role?: 'logo' | 'photo';
  /** a `photo`'s visible place: a picture covers it, and whatever it overflows is hidden by what is drawn over it */
  photoBox?: { x_mm: number; y_mm: number; w_mm: number; h_mm: number };
  /** in the design's video, this picture is replaced by that moving background (see shabbatLoops.ts) */
  loopId?: string;
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
  /** the plate behind the business's logo: it goes with the logo when the business has none */
  role?: 'logoPlate';
  /** rounded corners; half the shorter side makes a pill or a circle */
  cornerRadius_mm?: number;
  /** 0 to 1; unset is solid */
  opacity?: number;
};

export type CanvasElement = TextElement | ImageElement | ShapeElement;

export type CanvasDoc = {
  schema_version: 1;
  page: PageSpec;
  elements: CanvasElement[];
  /** the wording this card's texts came from; only a card that has one can change wording (see wording.ts) */
  wordingId?: string;
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
  /** what the business tells about itself, so an ad can say true and specific things */
  profile?: BusinessProfile;
  updatedAt: string;
};

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
