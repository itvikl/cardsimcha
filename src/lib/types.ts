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
  file: string; // public file name, served by /api/uploads/<file>
  width: number;
  height: number;
  createdAt: string;
};

// ---- card format v2 (docs/design/v2-foundation.md §4) ----------------------------------
// Three fixed layers drawn bottom to top: background, content, overlay. Order inside a
// layer is the array order; there is no z. Element types grow in rollout step 4
// (gradients, ellipse/line, svg, groups, masks).

/** What a customer may do with an element. Authors (template admins) may do everything. */
export type Locks = {
  /** change the text / swap the image */
  content: boolean;
  /** move, resize, rotate */
  transform: boolean;
  /** remove it from the card */
  delete: boolean;
  /** change its colour */
  style: boolean;
};

/** shown to the customer as a form field; `variable` names it for batch fill and the generator */
export type Field = { label: string; variable?: string };

export type Fill = { type: 'solid'; color: string };

type Base = {
  id: string;
  x_mm: number;
  y_mm: number;
  rotation: number;
  locks: Locks;
  field?: Field;
};

export type TextElement = Base & {
  type: 'text';
  w_mm: number;
  text: string;
  align: 'right' | 'center' | 'left';
  font: {
    family: string;
    weight: number;
    size_pt: number;
    color: string;
    /** multiple of the font size; default 1.25 */
    line_height?: number;
    /** extra space between letters, in pt */
    letter_spacing?: number;
  };
};

export type ImageElement = Base & {
  type: 'image';
  w_mm: number;
  h_mm: number;
  asset_id: string;
  /** a customer allowed to swap it picks from this collection (any image when unset) */
  swap_collection_id?: string;
  /** drawn as a flat colour instead of the image (a customer's "plain colour" choice) */
  colorOverride?: string;
};

export type ShapeElement = Base & {
  type: 'shape';
  shape: 'rect';
  w_mm: number;
  h_mm: number;
  fill: Fill;
};

export type CanvasElement = TextElement | ImageElement | ShapeElement;
export type LayerName = 'content' | 'overlay';

export type BackgroundLayer = {
  /** always drawn */
  fill: Fill;
  /** drawn over the fill, filling the page */
  image?: { asset_id: string; fit: 'cover' | 'contain'; colorOverride?: string };
  /** content: customer may swap the image (or pick a plain colour); style: may change the fill */
  locks: Locks;
  field?: Field;
  swap_collection_id?: string;
};

export type CanvasDoc = {
  schema_version: 2;
  page: { width_mm: number; height_mm: number };
  layers: { background: BackgroundLayer; content: CanvasElement[]; overlay: CanvasElement[] };
};

// ---- accounts and stored records ---------------------------------------------------------

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

/** A template is built by an admin; a design is a customer's copy of a template. */
export type Project = {
  id: string;
  kind: 'template' | 'design';
  ownerId: string;
  templateId?: string;
  status: 'draft' | 'published'; // only meaningful for templates
  name: string;
  /** topic shown to customers as a category tile on the home page, e.g. "בית כנסת" (templates only) */
  topic?: string;
  canvas: CanvasDoc;
  thumbnail?: string;
  createdAt: string;
  updatedAt: string;
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

/** The legacy Firestore / db.json store (src/lib/db.ts). Its cards are still format v1. */
export type Db = {
  categories: Category[];
  carousel: CarouselSlide[];
  images: ImageAsset[];
  projects: (Omit<Project, 'canvas'> & { canvas: unknown })[];
  users: User[];
  sessions: Session[];
};
