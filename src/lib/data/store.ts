import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * The document store under the repositories in src/lib/data/. Each record is one document,
 * addressed by collection and id. DATA_DRIVER picks where they live:
 * - firestore (default): Cloud Firestore of FIREBASE_PROJECT_ID, collections named
 *   `${FIRESTORE_PREFIX}<name>` (default prefix "v2_", so the v1 collections that main still
 *   reads are never touched)
 * - local: one JSON file, data/store.json, for development without Firebase credentials
 *
 * Queries are equality / membership filters only, and results come back unsorted: the
 * repositories sort in memory, so Firestore needs no composite indexes.
 *
 * In a transaction every read comes first and the writes are applied when the callback
 * returns (Firestore's rule, kept the same by the local driver). A read inside a transaction
 * does not see that transaction's own writes.
 */

export type Where = [field: string, op: '==' | 'in' | 'array-contains' | 'array-contains-any', value: unknown];

export interface Reader {
  get<T>(col: string, id: string): Promise<T | null>;
  /** every document matching all the filters; no filter: the whole collection */
  find<T>(col: string, ...where: Where[]): Promise<T[]>;
  /** like find, but each document comes with only these fields (and `id`): for lists that skip the cards */
  pick<T>(col: string, fields: string[], ...where: Where[]): Promise<T[]>;
}

export interface Tx extends Reader {
  /** replaces the document */
  set(col: string, id: string, data: object): void;
  /** changes the given fields; creates the document when it is missing */
  update(col: string, id: string, patch: object): void;
  delete(col: string, id: string): void;
}

export interface Store extends Reader {
  tx<T>(fn: (t: Tx) => Promise<T>): Promise<T>;
  set(col: string, id: string, data: object): Promise<void>;
  update(col: string, id: string, patch: object): Promise<void>;
  delete(col: string, id: string): Promise<void>;
}

type Write = { kind: 'set' | 'update' | 'delete'; col: string; id: string; data?: object };

/** Firestore rejects `undefined` fields; dropping them keeps "not given" the same in both drivers */
function clean(data: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
}

function bufferingTx(reader: Reader, writes: Write[]): Tx {
  return {
    get: (col, id) => reader.get(col, id),
    find: (col, ...where) => reader.find(col, ...where),
    pick: (col, fields, ...where) => reader.pick(col, fields, ...where),
    set: (col, id, data) => void writes.push({ kind: 'set', col, id, data: clean(data) }),
    update: (col, id, data) => void writes.push({ kind: 'update', col, id, data: clean(data) }),
    delete: (col, id) => void writes.push({ kind: 'delete', col, id }),
  };
}

// ---- Firestore -------------------------------------------------------------------------

function firestoreStore(prefix: string): Store {
  type Fs = import('firebase-admin/firestore').Firestore;
  type Query = import('firebase-admin/firestore').Query;
  // loaded on first use, so the local driver never needs Firebase credentials
  let fsp: Promise<Fs> | null = null;
  const fs = () => (fsp ??= import('../firebase').then((m) => m.firestore()));
  const name = (col: string) => `${prefix}${col}`;

  /** Firestore takes at most 30 values in an "in" filter: a longer list is split into queries */
  function queries(f: Fs, col: string, where: Where[]): Query[] {
    const big = where.findIndex(([, op, v]) => (op === 'in' || op === 'array-contains-any') && Array.isArray(v) && v.length > 30);
    if (big >= 0) {
      const [field, op, values] = where[big] as [string, Where[1], unknown[]];
      const rest = where.filter((_, i) => i !== big);
      const out: Query[] = [];
      for (let i = 0; i < values.length; i += 30) out.push(...queries(f, col, [...rest, [field, op, values.slice(i, i + 30)]]));
      return out;
    }
    let q: Query = f.collection(name(col));
    for (const [field, op, value] of where) q = q.where(field, op, value);
    return [q];
  }

  function reader(get: (ref: import('firebase-admin/firestore').DocumentReference) => Promise<import('firebase-admin/firestore').DocumentSnapshot>, run: (q: Query) => Promise<import('firebase-admin/firestore').QuerySnapshot>): Reader {
    return {
      async get<T>(col: string, id: string) {
        const snap = await get((await fs()).collection(name(col)).doc(id));
        return snap.exists ? (snap.data() as T) : null;
      },
      find<T>(col: string, ...where: Where[]) {
        return this.pick<T>(col, [], ...where);
      },
      async pick<T>(col: string, fields: string[], ...where: Where[]) {
        // an empty "in" list matches nothing (Firestore refuses it)
        if (where.some(([, op, v]) => (op === 'in' || op === 'array-contains-any') && Array.isArray(v) && !v.length)) return [];
        const qs = queries(await fs(), col, where).map((q) => (fields.length ? q.select(...new Set(['id', ...fields])) : q));
        const snaps = await Promise.all(qs.map(run));
        const seen = new Map<string, T>();
        for (const s of snaps) for (const d of s.docs) seen.set(d.id, d.data() as T);
        return [...seen.values()];
      },
    };
  }

  type Ref = import('firebase-admin/firestore').DocumentReference;
  /** what a transaction and a batch have in common */
  type Writer = { set(ref: Ref, data: object, options?: { merge: boolean }): unknown; delete(ref: Ref): unknown };
  function apply(f: Fs, t: Writer, w: Write) {
    const ref = f.collection(name(w.col)).doc(w.id);
    if (w.kind === 'set') t.set(ref, w.data!);
    else if (w.kind === 'update') t.set(ref, w.data!, { merge: true });
    else t.delete(ref);
  }

  const plain = reader((ref) => ref.get(), (q) => q.get());
  const single = async (w: Write) => {
    const f = await fs();
    const b = f.batch();
    apply(f, b as unknown as Writer, w);
    await b.commit();
  };

  return {
    ...plain,
    async tx(fn) {
      const f = await fs();
      return f.runTransaction(async (t) => {
        const writes: Write[] = [];
        const result = await fn(bufferingTx(reader((ref) => t.get(ref), (q) => t.get(q)), writes));
        for (const w of writes) apply(f, t as unknown as Writer, w);
        return result;
      });
    },
    set: (col, id, data) => single({ kind: 'set', col, id, data: clean(data) }),
    update: (col, id, data) => single({ kind: 'update', col, id, data: clean(data) }),
    delete: (col, id) => single({ kind: 'delete', col, id }),
  };
}

// ---- local JSON file -------------------------------------------------------------------

function matches(row: Record<string, unknown>, [field, op, value]: Where): boolean {
  const v = row[field] ?? null;
  if (op === '==') return v === value;
  if (op === 'in') return (value as unknown[]).includes(v);
  if (op === 'array-contains') return Array.isArray(v) && v.includes(value);
  return Array.isArray(v) && (value as unknown[]).some((x) => v.includes(x));
}

function localStore(file: string): Store {
  type Data = Record<string, Record<string, Record<string, unknown>>>;
  let data: Promise<Data> | null = null;
  const load = () =>
    (data ??= readFile(file, 'utf8').then(
      (s): Data => JSON.parse(s) as Data,
      (e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return {} as Data;
        throw e;
      },
    ));
  // one change at a time, so a transaction's reads and writes are not interleaved with another's
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const read: Reader = {
    async get<T>(col: string, id: string) {
      const row = (await load())[col]?.[id];
      return row ? (structuredClone(row) as T) : null;
    },
    find<T>(col: string, ...where: Where[]) {
      return this.pick<T>(col, [], ...where);
    },
    async pick<T>(col: string, fields: string[], ...where: Where[]) {
      const rows = Object.values((await load())[col] ?? {}).filter((r) => where.every((w) => matches(r, w)));
      const keep = fields.length ? new Set(['id', ...fields]) : null;
      return rows.map((r) => structuredClone(keep ? Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k))) : r) as T);
    },
  };

  async function commit(writes: Write[]) {
    if (!writes.length) return;
    const d = await load();
    for (const w of writes) {
      const col = (d[w.col] ??= {});
      if (w.kind === 'set') col[w.id] = structuredClone(w.data as Record<string, unknown>);
      else if (w.kind === 'update') col[w.id] = { ...col[w.id], ...structuredClone(w.data as Record<string, unknown>) };
      else delete col[w.id];
    }
    await mkdir(path.dirname(file), { recursive: true });
    // written to a side file and renamed, so a crash never leaves half a file
    await writeFile(`${file}.tmp`, JSON.stringify(d));
    await rename(`${file}.tmp`, file);
  }

  return {
    ...read,
    tx: (fn) =>
      serial(async () => {
        const writes: Write[] = [];
        const result = await fn(bufferingTx(read, writes));
        await commit(writes);
        return result;
      }),
    set: (col, id, d) => serial(() => commit([{ kind: 'set', col, id, data: clean(d) }])),
    update: (col, id, d) => serial(() => commit([{ kind: 'update', col, id, data: clean(d) }])),
    delete: (col, id) => serial(() => commit([{ kind: 'delete', col, id }])),
  };
}

function createStore(): Store {
  const driver = process.env.DATA_DRIVER ?? 'firestore';
  if (driver === 'firestore') return firestoreStore(process.env.FIRESTORE_PREFIX ?? 'v2_');
  if (driver === 'local') return localStore(path.join(process.cwd(), 'data', 'store.json'));
  throw new Error(`DATA_DRIVER=${driver} is not supported (firestore or local)`);
}

// one store per server process (Next.js reloads modules in development)
const g = globalThis as unknown as { cardStore?: Store };
export const db: Store = (g.cardStore ??= createStore());

/** the collections, in one place */
export const C = {
  users: 'users',
  workspaces: 'workspaces',
  sessions: 'sessions',
  topics: 'topics',
  labels: 'labels',
  templates: 'templates',
  creatives: 'creatives',
  collections: 'collections',
  assets: 'assets',
  fonts: 'fonts',
  textStyles: 'text_styles',
} as const;

export const now = () => new Date().toISOString();
