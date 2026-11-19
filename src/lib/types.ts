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

/**
 * Shown to the customer as a form field; `variable` names it for batch fill and the generator.
 * `detail`: the customer's own detail (names, date, place): what they typed stays when they swap
 * a wording or one part of it, matched by `label`.
 */
export type Field = { label: string; variable?: string; detail?: boolean };

/**
 * A flat colour, or a linear gradient from `color` to `color2` at `angle` degrees (0 runs from
 * right to left, 90 from top to bottom; nodeStyle.ts draws it). Both have `color`, so code that only knows flat colours still draws
 * something sensible.
 */
export type Fill = { type: 'solid'; color: string } | { type: 'linear'; color: string; color2: string; angle: number };

/** the three parts a wording is built from; a customer can swap one part or the whole wording */
export type WordingPart = 'header' | 'body' | 'footer';

type Base = {
  id: string;
  x_mm: number;
  y_mm: number;
  rotation: number;
  locks: Locks;
  field?: Field;
  /** elements sharing a group id move, align and get selected together (Ctrl+G) */
  group?: string;
  /** hidden in the editor and left out of every download and preview */
  hidden?: boolean;
  /** the author's pin: it stays put in the editor and clicks go through it (not a customer lock) */
  pinned?: boolean;
  /** the wording part this element belongs to */
  part?: WordingPart;
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
    /** extra space between letters, in pt; negative draws them closer */
    letter_spacing?: number;
  };
  /** bends the line onto a circle, -100 (a smile) to 100 (a rainbow); unset or near 0 is straight */
  arc?: number;
  /** 'shrink': the text gets smaller until each of its lines fits the box on one line */
  fit?: 'shrink';
  /** a soft shadow under the letters */
  shadow?: boolean;
  /** an outline around the letters */
  stroke?: { color: string; width_mm: number };
  /** a metal foil look instead of the flat colour */
  foil?: 'gold' | 'silver';
  /** the colour the designer gave it; matching text to a new background always starts from here */
  design_color?: string;
  /** the size the designer gave it, in pt; a customer's longer words shrink it from here to fit (fitText.ts) */
  design_size?: number;
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
  /** the picture shows through this shape instead of its square box */
  mask?: 'circle' | 'rounded' | 'arch';
  /**
   * The part of the picture the box shows: it covers the box at `zoom` 1 and closer above that,
   * moved by `x` and `y` (-1 to 1, from the middle to an edge). Unset: the whole picture fills the box.
   */
  crop?: { zoom: number; x: number; y: number };
};

export type ShapeElement = Base & {
  type: 'shape';
  shape: 'rect';
  w_mm: number;
  h_mm: number;
  fill: Fill;
  /** rounded corners; half the shorter side makes a pill or a circle */
  corner_radius_mm?: number;
  /** 0 to 1; unset is solid */
  opacity?: number;
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
  /** the author's guide lines, in mm from the page's left (x) and top (y) edges; never drawn in downloads */
  guides?: { x: number[]; y: number[] };
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
  /** templates: the nodes of the occasion tree it is filed on (src/lib/data/tree.ts) */
  places?: string[];
  /** templates: its "what it is" label */
  labelId?: string;
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
