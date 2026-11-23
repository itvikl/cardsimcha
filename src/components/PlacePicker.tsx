'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Label, TreeNode } from '@/lib/data/tree';
import s from './PlacePicker.module.css';

/**
 * Choosing where something is filed in the occasion tree (קטגוריה → אירוע → סוג), and for a
 * design its "what it is" label. Used for templates on the admin home page and for library
 * images (backgrounds) on the images page. Admin only: it reads /api/tree.
 */

export type TreeData = { nodes: TreeNode[]; labels: Label[] };

/** the label choice "leave each one's own" when several items are filed at once */
const KEEP = '__keep__';

/** whether every list names the same items, in any order */
export const sameIds = (lists: (string[] | string | null)[]) => {
  const key = (l: string[] | string | null) => (Array.isArray(l) ? [...l].sort().join(',') : (l ?? ''));
  return lists.every((l) => key(l) === key(lists[0]));
};

export function useTreeData() {
  const [data, setData] = useState<TreeData | null>(null);
  const reload = useCallback(
    () =>
      fetch('/api/tree')
        .then((r) => (r.ok ? r.json() : null))
        .then((d: TreeData | null) => d && setData({ nodes: d.nodes, labels: d.labels })),
    [],
  );
  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);
  return { data, reload };
}

/** "שמחות › הולדת בן › ברית" */
export function placePath(nodes: TreeNode[], id: string): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const names: string[] = [];
  for (let n = byId.get(id); n; n = n.parentId ? byId.get(n.parentId) : undefined) names.unshift(n.name);
  return names.join(' › ');
}

/** the places of an item as short chips, or a warning when it has none */
export function PlaceChips({ nodes, ids, label }: { nodes: TreeNode[]; ids: string[]; label?: string | null }) {
  return (
    <span className={s.chips}>
      {ids.length === 0 ? (
        <span className={s.none}>לא משויך לעץ</span>
      ) : (
        ids.map((id) => (
          <span key={id} className={s.chip}>
            {placePath(nodes, id) || 'מקום שנמחק'}
          </span>
        ))
      )}
      {label && <span className={`${s.chip} ${s.label}`}>{label}</span>}
    </span>
  );
}

export function PlacePicker({
  title,
  note,
  data,
  door,
  value,
  labelId,
  withLabel,
  mixedPlaces,
  mixedLabel,
  onSave,
  onClose,
}: {
  title: string;
  /** a line under the title, e.g. what saving does to several items at once */
  note?: string;
  data: TreeData;
  /** only this door's part of the tree (a template); all of it when unset (a background) */
  door?: 'private' | 'business';
  value: string[];
  labelId?: string | null;
  withLabel?: boolean;
  /** several items whose places differ: until the tree is touched, saving leaves each one's places */
  mixedPlaces?: boolean;
  /** several items whose labels differ: "keep each one's label" is offered and chosen */
  mixedLabel?: boolean;
  /** `ids` / `labelId` undefined: leave that part as it is */
  onSave: (ids: string[] | undefined, labelId: string | null | undefined) => Promise<void> | void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(value));
  const [touched, setTouched] = useState(false);
  const [label, setLabel] = useState<string | null>(mixedLabel ? KEEP : (labelId ?? null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  /** branches opposite to how they start: a category open, and below it only what holds something checked */
  const [flipped, setFlipped] = useState<Set<string>>(() => new Set());

  const kids = useMemo(() => {
    const m = new Map<string | null, TreeNode[]>();
    for (const n of data.nodes) {
      if (n.parentId === null && n.level !== 'category') continue;
      if (n.parentId === null && door && n.audience !== door) continue;
      m.set(n.parentId, [...(m.get(n.parentId) ?? []), n]);
    }
    for (const list of m.values()) list.sort((a, b) => a.position - b.position);
    return m;
  }, [data.nodes, door]);

  const labels = data.labels.filter((l) => !door || l.audience === door);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // `picked` holds the fewest nodes that say it: a checked node stands for everything under it,
  // so its children show checked without being stored
  const parentOf = useMemo(() => new Map(data.nodes.map((n) => [n.id, n.parentId])), [data.nodes]);
  const childIds = useCallback((id: string) => (kids.get(id) ?? []).map((c) => c.id), [kids]);
  const below = useCallback(
    (id: string): string[] => childIds(id).flatMap((c) => [c, ...below(c)]),
    [childIds],
  );
  /** the checked node at or above `id`, if any */
  const coveredBy = (set: Set<string>, id: string): string | null => {
    for (let at: string | null | undefined = id; at; at = parentOf.get(at)) if (set.has(at)) return at;
    return null;
  };

  const toggle = (id: string) => {
    setTouched(true);
    pick(id);
  };
  const pick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      const holder = coveredBy(next, id);
      if (holder) {
        // unchecking: the node that held it lets go, and every branch beside the way down to `id` stays checked
        next.delete(holder);
        for (let at = id; at !== holder; at = parentOf.get(at)!) {
          for (const sib of childIds(parentOf.get(at)!)) if (sib !== at) next.add(sib);
        }
        return next;
      }
      // checking: it stands for what is under it, and a node whose children are now all checked takes their place
      for (const d of below(id)) next.delete(d);
      next.add(id);
      for (let at = id, up = parentOf.get(id); up; at = up, up = parentOf.get(up)) {
        const sibs = childIds(up);
        if (!sibs.length || !sibs.every((c) => next.has(c))) break;
        sibs.forEach((c) => next.delete(c));
        next.add(up);
      }
      return next;
    });

  // what a search leaves: the nodes it finds, the way down to them, and what is inside them
  const needle = query.trim().toLowerCase();
  const found = useMemo(() => {
    if (!needle) return null;
    const keep = new Set<string>();
    for (const n of data.nodes) {
      if (!n.name.toLowerCase().includes(needle)) continue;
      for (let at: string | null | undefined = n.id; at; at = parentOf.get(at)) keep.add(at);
      for (const d of below(n.id)) keep.add(d);
    }
    return keep;
  }, [needle, data.nodes, parentOf, below]);

  // the branches that start open: categories, and whatever has a checked node under it
  const startsOpen = useMemo(() => {
    const open = new Set<string>();
    for (const n of data.nodes) if (n.level === 'category') open.add(n.id);
    for (const id of value) for (let at = parentOf.get(id); at; at = parentOf.get(at)) open.add(at);
    return open;
  }, [data.nodes, value, parentOf]);

  const flip = (id: string) =>
    setFlipped((f) => {
      const next = new Set(f);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const branch = (parent: string | null, covered: boolean) => (
    <ul className={s.tree}>
      {(kids.get(parent) ?? [])
        .filter((n) => !found || found.has(n.id))
        .map((n) => {
          const on = covered || picked.has(n.id);
          const partly = !on && below(n.id).some((d) => picked.has(d));
          const hasKids = kids.has(n.id);
          const open = hasKids && (!!found || startsOpen.has(n.id) !== flipped.has(n.id));
          return (
            <li key={n.id} data-level={n.level}>
              <div className={s.row}>
                <label className={s.option}>
                  <input
                    type="checkbox"
                    checked={on}
                    ref={(el) => {
                      if (el) el.indeterminate = partly;
                    }}
                    onChange={() => toggle(n.id)}
                  />
                  <span className={s.name}>{n.name}</span>
                </label>
                {hasKids && !found && (
                  <button type="button" className={s.toggle} aria-expanded={open} aria-label={`${open ? 'קיפול' : 'פתיחה של'} ${n.name}`} onClick={() => flip(n.id)}>
                    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M10 3 5 8l5 5" />
                    </svg>
                  </button>
                )}
              </div>
              {open && branch(n.id, on)}
            </li>
          );
        })}
    </ul>
  );

  const summary = data.nodes.filter((n) => picked.has(n.id)).map((n) => placePath(data.nodes, n.id));
  const keepPlaces = mixedPlaces && !touched;

  async function save() {
    setSaving(true);
    setError('');
    try {
      const order = data.nodes.map((n) => n.id);
      await onSave(
        keepPlaces ? undefined : [...picked].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
        withLabel && label !== KEEP ? label : undefined,
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  // on the body: a page that animates its content (the door turn) would otherwise hold the fixed layer inside it
  return createPortal(
    <div className={s.backdrop} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.panel}>
        <div className={s.head}>
          <strong>{title}</strong>
        </div>

        <div className={s.body}>
          {note && <p className={s.note}>{note}</p>}
          <section>
            <h3>איפה זה מופיע</h3>
            <p className="status">אפשר לסמן כמה מקומות. סימון של קטגוריה או אירוע מסמן את כל מה שבתוכם, גם מה שיתווסף אליהם בהמשך.</p>
            {mixedPlaces && (
              <p className={s.note}>
                {keepPlaces
                  ? 'למה שנבחר יש היום מקומות שונים. כל עוד לא משנים כאן סימון, כל אחד נשאר במקומות שלו.'
                  : 'שיניתם סימון: השמירה תשים את כל מה שנבחר בדיוק במקומות המסומנים.'}
              </p>
            )}
            {kids.size > 0 && (
              <input
                type="text"
                inputMode="search"
                className={s.search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="חיפוש בעץ, למשל ברית"
                aria-label="חיפוש בעץ"
              />
            )}
            {!kids.size ? (
              <p className="status">העץ ריק. בונים אותו בעמוד "עץ הקטגוריות".</p>
            ) : found && !found.size ? (
              <p className="status">לא נמצא מקום בשם הזה.</p>
            ) : (
              branch(null, false)
            )}
          </section>

          {withLabel && (
            <section>
              <h3>מה זה</h3>
              <div className={s.labels} role="radiogroup" aria-label="מה זה">
                {mixedLabel && (
                  <button type="button" role="radio" aria-checked={label === KEEP} className={s.labelBtn} onClick={() => setLabel(KEEP)}>
                    להשאיר לכל אחד את שלו
                  </button>
                )}
                <button type="button" role="radio" aria-checked={label === null} className={s.labelBtn} onClick={() => setLabel(null)}>
                  בלי תווית
                </button>
                {labels.map((l) => (
                  <button key={l.id} type="button" role="radio" aria-checked={label === l.id} className={s.labelBtn} onClick={() => setLabel(l.id)}>
                    {l.name}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className={s.foot}>
          <span className={'status ' + s.summary}>{keepPlaces ? 'המקומות לא משתנים' : summary.length ? `מסומן: ${summary.join(', ')}` : 'לא מסומן אף מקום'}</span>
          <button className="btn small" onClick={onClose}>
            ביטול
          </button>
          <button className="btn small primary" onClick={save} disabled={saving}>
            {saving ? 'שומר…' : 'שמירה'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
