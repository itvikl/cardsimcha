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
};

export type CanvasElement = TextElement | ImageElement | ShapeElement;

export type CanvasDoc = {
  schema_version: 1;
  page: PageSpec;
  elements: CanvasElement[];
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

/** A template is built by an admin; a design is a customer's copy of a template. */
export type Project = {
  id: string;
  kind: 'template' | 'design';
  ownerId: string;
  templateId?: string;
  status: 'draft' | 'published'; // only meaningful for templates
  name: string;
  canvas: CanvasDoc;
  thumbnail?: string;
  createdAt: string;
  updatedAt: string;
};

export type Db = {
  categories: Category[];
  images: ImageAsset[];
  projects: Project[];
  users: User[];
  sessions: Session[];
};
