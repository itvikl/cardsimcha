'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PAGE_PRESETS } from '@/lib/canvas';
import { useMe } from '@/components/Auth';
import { Landing } from '@/components/Landing';
import { CATEGORIES, GENERAL_TOPIC, topicAudience, type CarouselSetting } from '@/lib/categories';
import { DoorTurn, RevolvingDoor, useAdminDoor } from '@/components/RevolvingDoor';
import { PlaceChips, PlacePicker, sameIds, useTreeData } from '@/components/PlacePicker';
import { TreeCrumbs, TreeHeading, TreeKids, TreeTile, TreeTiles, TreeTop, UNFILED, useTreeIndex, useTreeSpot } from '@/components/TreeBrowse';
import type { TreeNode } from '@/lib/data/tree';
import h from './admin-home.module.css';

type Item = {
  id: string;
  kind: 'template' | 'design' | 'wording';
  status: 'draft' | 'published';
  name: string;
  topic: string | null;
  /** where it is filed in the occasion tree, and its "what it is" label */
  places: string[];
  labelId: string | null;
  updatedAt: string;
  width_mm: number;
  height_mm: number;
  editableFields: number;
  thumbnail: string | null;
};

/** the label filter's "those with no label" */
const NO_LABEL = '__none__';
const howMany = (n: number) => (n === 1 ? 'תבנית אחת' : `${n} תבניות`);

const Preview = ({ src, label }: { src: string | null; label: string }) => (
  <span className="preview" role={label ? 'img' : undefined} style={src ? { backgroundImage: `url(${src})`, backgroundSize: 'contain' } : undefined} aria-label={label || undefined}>
    {!src && 'אין תצוגה מקדימה'}
  </span>
);

/** a window over the page, in the middle or as a panel at the side. Esc and a click outside close it */
function Sheet({
  title,
  side,
  paused,
  onClose,
  children,
}: {
  title: string;
  side?: boolean;
  /** another window is open on top of this one and takes the keys */
  paused?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // a field being typed in saves when it loses focus, so it has to lose it before the window goes
  const close = useCallback(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    onClose();
  }, [onClose]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => before?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !paused) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paused, close]);
  return createPortal(
    <div className={h.backdrop + (side ? ' ' + h.side : '')} onClick={(e) => e.target === e.currentTarget && close()}>
      <div ref={panel} className={h.sheet} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className={h.head}>
          <strong>{title}</strong>
          <button type="button" className="btn small" onClick={close}>
            סגירה
          </button>
        </div>
        <div className={h.body}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

const BG_CATEGORY = 'רקעים';

/** Uploads the picture into the "רקעים" library category (created on first use) and returns the asset id. */
async function uploadBackground(file: File): Promise<string> {
  const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('אי אפשר לקרוא את התמונה'));
    };
    img.src = url;
  });
  const lib = await api<{ categories: { id: string; name: string }[] }>('/api/library');
  const cat =
    lib.categories.find((c) => c.name === BG_CATEGORY) ??
    (await api<{ id: string }>('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: BG_CATEGORY, description: 'רקעים שהועלו בעת יצירת תבנית' }),
    }));
  const form = new FormData();
  form.set('file', file);
  form.set('width', String(dims.width));
  form.set('height', String(dims.height));
  const asset = await api<{ id: string }>(`/api/categories/${cat.id}/images`, { method: 'POST', body: form });
  return asset.id;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'שגיאה לא צפויה');
  return data as T;
}

export default function Dashboard() {
  const { me } = useMe();
  if (me?.role === 'admin') return <AdminHome />;
  return <Landing />;
}

/* ------------------------------ admin ------------------------------ */

function AdminHome() {
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [preset, setPreset] = useState<string>(PAGE_PRESETS[0].id);
  const [isWording, setIsWording] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [bgFile, setBgFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [importing, setImporting] = useState(false);
  const [door, setDoor] = useAdminDoor();
  const [carousel, setCarousel] = useState<CarouselSetting[]>([]);
  const { data: tree } = useTreeData();
  /** the new-template window */
  const [creating, setCreating] = useState(false);
  /** places and label for the template about to be made */
  const [newPlaces, setNewPlaces] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState<string | null>(null);
  /** whose places the picker is open for: 'new', 'chosen' (the selection) or a template id */
  const [choosing, setChoosing] = useState<string | null>(null);
  /** templates chosen for filing together */
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  /** the template whose details panel is open */
  const [details, setDetails] = useState<string | null>(null);
  const [at, go] = useTreeSpot();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [labelFilter, setLabelFilter] = useState('');

  const load = useCallback(async () => {
    const [list, c] = await Promise.all([api<Item[]>('/api/projects'), api<CarouselSetting[]>('/api/carousel').catch(() => [])]);
    setItems(list);
    setCarousel(c);
  }, []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const p = PAGE_PRESETS.find((x) => x.id === preset) ?? PAGE_PRESETS[0];
    if (!isWording && business && !newPlaces.length) {
      setError('בחרו לתבנית מקום בעץ (למשל עסקים, או תחום מסוים).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const backgroundAssetId = bgFile ? await uploadBackground(bgFile) : undefined;
      const r = await api<{ id: string }>('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          topic: isWording ? topic : '',
          places: isWording ? [] : newPlaces,
          labelId: isWording ? null : newLabel,
          audience: door,
          width_mm: p.width_mm,
          height_mm: p.height_mm,
          backgroundAssetId,
          wording: !business && isWording,
        }),
      });
      router.push(`/editor/${r.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  /** a finished design as a picture: the server reads its texts, and it opens as a draft to go over */
  async function importDesign(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setError('');
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('name', name || file.name.replace(/\.[^.]+$/, ''));
      form.set('topic', '');
      form.set('places', JSON.stringify(newPlaces));
      if (newLabel) form.set('labelId', newLabel);
      form.set('audience', door);
      const r = await api<{ id: string; texts: number; rough: number }>('/api/templates/import', { method: 'POST', body: form });
      if (r.rough > 0) window.alert(`זוהו ${r.texts} טקסטים. ב-${r.rough} מהם הרקע לא אחיד, אז כדאי לבדוק שם את המקום שנמחק.`);
      router.push(`/editor/${r.id}`);
    } catch (err) {
      setError((err as Error).message);
      setImporting(false);
    }
  }

  async function setStatus(it: Item, status: 'draft' | 'published') {
    if (status === 'published' && it.editableFields === 0 && !confirm('בתבנית אין אף שדה טקסט שהלקוח יכול לערוך. לפרסם בכל זאת?')) return;
    try {
      await api(`/api/projects/${it.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function tryAsCustomer(it: Item) {
    try {
      const r = await api<{ id: string }>('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: it.id }),
      });
      router.push(`/editor/${r.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(it: Item) {
    if (!confirm(`למחוק את "${it.name}"? אי אפשר לבטל. כרטיסים שלקוחות כבר יצרו ממנה יישארו.`)) return;
    try {
      await api(`/api/projects/${it.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const inDoor = (topicName: string) => topicAudience(topicName, carousel) === door;
  const nodes = useMemo<TreeNode[]>(() => tree?.nodes ?? [], [tree]);
  const { byId, lineOf, childrenOf, onTree, holdings } = useTreeIndex(nodes);
  // a template filed in the tree is behind its places' door; otherwise behind its old topic's
  // (one without a topic lands in "כללי", which is on the private side)
  const itemInDoor = (i: Item) => (i.places.length && byId.has(i.places[0]) ? byId.get(i.places[0])!.audience === door : inDoor(i.topic || GENERAL_TOPIC));
  const templates = items?.filter((i) => i.kind === 'template' && itemInDoor(i)) ?? [];
  const labelName = new Map((tree?.labels ?? []).map((l) => [l.id, l.name]));
  const doorLabels = (tree?.labels ?? []).filter((l) => l.audience === door);
  const business = door === 'business';

  // search and filters narrow everything below them: the tiles' counts as well as the lists
  const needle = query.trim().toLowerCase();
  const activeLabel = labelFilter === NO_LABEL || doorLabels.some((l) => l.id === labelFilter) ? labelFilter : '';
  const filtering = !!needle || statusFilter !== 'all' || !!activeLabel;
  const matching = templates.filter(
    (t) =>
      (!needle || t.name.toLowerCase().includes(needle)) &&
      (statusFilter === 'all' || t.status === statusFilter) &&
      (!activeLabel || (activeLabel === NO_LABEL ? !t.labelId : t.labelId === activeLabel)),
  );
  const clearFilters = () => {
    setQuery('');
    setStatusFilter('all');
    setLabelFilter('');
  };

  // walking the tree
  const holds = holdings(matching, (t) => t.places);
  const categories = childrenOf(null).filter((c) => c.audience === door && (!filtering || holds.has(c.id)));
  const unfiled = matching.filter((t) => !t.places.some(onTree));
  const here = at && at !== UNFILED ? byId.get(at) : undefined;
  const line = here ? lineOf(here.id) : [];
  const above = line.slice(0, -1);
  const inNode = !!here && line[0].level === 'category' && line[0].audience === door;
  const view: 'categories' | 'search' | 'unfiled' | 'node' = inNode ? 'node' : at === UNFILED && tree ? 'unfiled' : needle ? 'search' : 'categories';
  /** the templates on screen */
  const shown = view === 'node' ? (holds.get(here!.id) ?? []) : view === 'unfiled' ? unfiled : view === 'search' ? matching : [];
  /** templates filed above the open node, which customers also find in it */
  const fromAbove = view === 'node' ? matching.filter((t) => !shown.includes(t) && t.places.some((p) => above.some((a) => a.id === p))) : [];
  const allShownChosen = shown.length > 0 && shown.every((t) => chosen.has(t.id));
  const leave = (id: string | null) => {
    if (view === 'search') setQuery('');
    go(id);
  };

  /** the chosen templates behind this door (a choice made behind the other door doesn't count here) */
  const chosenHere = templates.filter((t) => chosen.has(t.id));
  /** the templates the picker is open for: the chosen ones, or the one whose own button was pressed */
  const picking = choosing === 'chosen' ? chosenHere : templates.filter((t) => t.id === choosing);
  const open = templates.find((t) => t.id === details);
  const wordings = items?.filter((i) => i.kind === 'wording' && inDoor(i.topic || GENERAL_TOPIC)) ?? [];
  /** example topics shown to the admin as suggestions; any free text is accepted */
  const topicOptions = Array.from(
    new Set([
      ...CATEGORIES.map((c) => c.name),
      ...carousel.map((c) => c.name),
      ...(items ?? []).map((t) => t.topic).filter((t): t is string => !!t),
    ])
  ).filter(inDoor);

  /** a new template starts where the admin stands in the tree */
  function openNew() {
    setNewPlaces(view === 'node' ? [here!.id] : []);
    setNewLabel(null);
    setName('');
    setTopic('');
    setIsWording(false);
    setBgFile(null);
    setFileKey((k) => k + 1);
    setError('');
    setBusy(false);
    setCreating(true);
  }

  const toggleChosen = (id: string) =>
    setChosen((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <main className="page">
      <RevolvingDoor value={door} onChange={setDoor} />
      <DoorTurn door={door}>
      <div className={h.title}>
        <h1>{business ? 'תבניות לעסקים' : 'תבניות לשמחות'}</h1>
        <span className="spacer" />
        <button type="button" className="btn primary" onClick={openNew}>
          {view === 'node' ? `תבנית חדשה ב${here!.name}` : 'תבנית חדשה'}
        </button>
      </div>
      <p className="sub">לקוחות רואים רק תבניות שפורסמו, בדלת &quot;{business ? 'לעסק' : 'לשמחה'}&quot; בעמוד הבית.</p>

      {error && !creating && !open && <p className="error" role="alert">{error}</p>}

      <TreeTop />
      {items === null || !tree ? (
        <p className="status">טוען…</p>
      ) : templates.length === 0 ? (
        <div className="empty">
          {business ? 'עוד אין תבניות לעסקים.' : 'עוד אין תבניות לשמחות.'} אפשר להתחיל בכפתור &quot;תבנית חדשה&quot;. תמונות מוסיפים ב&quot;ספריית תמונות&quot;.
        </div>
      ) : (
        <>
          <div className={h.filters} role="search">
            <input
              type="text"
              inputMode="search"
              enterKeyHint="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={view === 'node' ? `חיפוש בתוך ${here!.name}` : 'חיפוש תבנית לפי שם'}
              aria-label="חיפוש תבנית לפי שם"
            />
            <div className={h.segments} role="group" aria-label="מצב פרסום">
              {(
                [
                  ['all', 'הכול'],
                  ['published', 'פורסמו'],
                  ['draft', 'טיוטות'],
                ] as const
              ).map(([value, text]) => (
                <button key={value} type="button" aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>
                  {text}
                </button>
              ))}
            </div>
            <select value={activeLabel} onChange={(e) => setLabelFilter(e.target.value)} aria-label="סינון לפי תווית">
              <option value="">כל התוויות</option>
              <option value={NO_LABEL}>בלי תווית</option>
              {doorLabels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            {filtering && (
              <button type="button" className="btn small" onClick={clearFilters}>
                ניקוי
              </button>
            )}
          </div>

          {view === 'categories' ? (
            <>
              <TreeHeading title="לפי קטגוריות" detail={filtering ? `נמצאו: ${howMany(matching.length)}` : howMany(templates.length)} />
              {categories.length === 0 && unfiled.length === 0 ? (
                <div className="empty">
                  {filtering ? (
                    <>
                      לא נמצאו תבניות שמתאימות לסינון.{' '}
                      <button type="button" className="btn small" onClick={clearFilters}>
                        ניקוי הסינון
                      </button>
                    </>
                  ) : (
                    <>
                      לדלת הזו עוד אין קטגוריות. <Link href="/tree">בונים אותן בעץ הקטגוריות</Link>.
                    </>
                  )}
                </div>
              ) : (
                <TreeTiles>
                  {categories.map((c) => {
                    const list = holds.get(c.id) ?? [];
                    const drafts = list.filter((t) => t.status === 'draft').length;
                    return (
                      <TreeTile
                        key={c.id}
                        name={c.name}
                        detail={howMany(list.length) + (drafts ? ` · ${drafts} טיוטות` : '')}
                        thumbs={list.flatMap((t) => t.thumbnail ?? [])}
                        onOpen={() => go(c.id)}
                      />
                    );
                  })}
                  {unfiled.length > 0 && (
                    <TreeTile name="לא משויכות לעץ" detail={howMany(unfiled.length)} thumbs={unfiled.flatMap((t) => t.thumbnail ?? [])} warn onOpen={() => go(UNFILED)} />
                  )}
                </TreeTiles>
              )}
            </>
          ) : (
            <>
              <TreeCrumbs above={view === 'node' ? above : []} onGo={leave} />
              <TreeHeading
                title={view === 'node' ? here!.name : view === 'unfiled' ? 'לא משויכות לעץ' : `תוצאות עבור "${query.trim()}"`}
                detail={howMany(shown.length) + (view === 'unfiled' ? ' · לקוחות לא יגיעו אליהן עד שישויכו' : '')}
                action={
                  shown.length > 0 && (
                    <button
                      type="button"
                      className="btn small"
                      onClick={() =>
                        setChosen((c) => {
                          const next = new Set(c);
                          for (const t of shown) {
                            if (allShownChosen) next.delete(t.id);
                            else next.add(t.id);
                          }
                          return next;
                        })
                      }
                    >
                      {allShownChosen ? 'ביטול הבחירה כאן' : 'בחירת כל התבניות כאן'}
                    </button>
                  )
                }
              />
              {view === 'node' && <TreeKids kids={childrenOf(here!.id)} count={(id) => holds.get(id)?.length ?? 0} onGo={go} />}
              {fromAbove.length > 0 && (
                <p className={'status ' + h.inherited}>
                  ללקוח מופיעות כאן גם {howMany(fromAbove.length)} נוספות, ששויכו לרמה שמעל:{' '}
                  {above
                    .filter((a) => fromAbove.some((t) => t.places.includes(a.id)))
                    .map((a) => a.name)
                    .join(', ')}
                  .
                </p>
              )}
              {shown.length === 0 ? (
                <div className="empty" style={{ marginTop: 12 }}>
                  {filtering ? (
                    <>
                      לא נמצאו תבניות שמתאימות לסינון.{' '}
                      <button type="button" className="btn small" onClick={clearFilters}>
                        ניקוי הסינון
                      </button>
                    </>
                  ) : view === 'unfiled' ? (
                    <>
                      אין בדלת הזו תבניות בלי שיוך.{' '}
                      <button type="button" className="btn small" onClick={() => setDoor(business ? 'private' : 'business')}>
                        בדיקה בדלת השנייה
                      </button>
                    </>
                  ) : (
                    'אין עדיין תבניות שמשויכות לכאן.'
                  )}
                </div>
              ) : (
                <>
                  <div className={h.cards}>
                    {shown.map((it) => (
                      <article key={it.id} className={h.card + (chosen.has(it.id) ? ' ' + h.picked : '')}>
                        <label className="thumb-check" title="בחירה">
                          <input type="checkbox" checked={chosen.has(it.id)} aria-label={`בחירת ${it.name}`} onChange={() => toggleChosen(it.id)} />
                        </label>
                        <button type="button" className={h.open} onClick={() => setDetails(it.id)} aria-label={`פרטים על ${it.name}`}>
                          <Preview src={it.thumbnail} label="" />
                          <strong>{it.name}</strong>
                          <span className={h.status}>
                            <span className={'badge ' + it.status}>{it.status === 'published' ? 'פורסם' : 'טיוטה'}</span>
                          </span>
                        </button>
                        <PlaceChips nodes={nodes} ids={it.places} label={it.labelId && labelName.get(it.labelId)} />
                        <div className={h.buttons}>
                          <Link className="btn small primary" href={`/editor/${it.id}`}>
                            עריכה
                          </Link>
                          <button type="button" className="btn small" onClick={() => setDetails(it.id)}>
                            פרטים
                          </button>
                          <button type="button" className={'btn small ' + h.wide} onClick={() => setChoosing(it.id)}>
                            {it.places.length ? 'שינוי שיוך' : 'שיוך לעץ'}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {chosenHere.length > 0 && (
        <div className="select-bar" role="toolbar" aria-label="בחירה מרובה">
          <strong>{chosenHere.length === 1 ? 'תבנית אחת נבחרה' : `${chosenHere.length} תבניות נבחרו`}</strong>
          <span className="spacer" />
          <button className="btn small" onClick={() => setChosen(new Set())}>
            ניקוי בחירה
          </button>
          <button className="btn small primary" onClick={() => setChoosing('chosen')}>
            שיוך לעץ ותווית
          </button>
        </div>
      )}

      {open && (
        <Sheet title={open.name} side paused={choosing !== null} onClose={() => setDetails(null)}>
          <div className={h.detailsTop}>
            <Link href={`/editor/${open.id}`} aria-label={`עריכת ${open.name}`} style={{ display: 'grid' }}>
              <Preview src={open.thumbnail} label="" />
            </Link>
            <div>
              <span className={'badge ' + open.status}>{open.status === 'published' ? 'פורסם' : 'טיוטה'}</span>
              <span className="status">
                {open.width_mm}×{open.height_mm} מ״מ · {open.editableFields} שדות לעריכה ללקוח
              </span>
            </div>
          </div>
          <div className={h.actions}>
            <Link className="btn small primary" href={`/editor/${open.id}`}>
              עריכה
            </Link>
            <button className="btn small" onClick={() => setStatus(open, open.status === 'published' ? 'draft' : 'published')}>
              {open.status === 'published' ? 'ביטול פרסום' : 'פרסום'}
            </button>
            <button className="btn small" onClick={() => tryAsCustomer(open)} title="יוצר עותק ניסיון שנראה כמו אצל לקוח">
              נסה כלקוח
            </button>
          </div>
          <div className={'field ' + h.placeBox}>
            מקום בעץ ותווית
            <PlaceChips nodes={nodes} ids={open.places} label={open.labelId && labelName.get(open.labelId)} />
            <button type="button" className="btn small" onClick={() => setChoosing(open.id)}>
              {open.places.length ? 'שינוי שיוך' : 'שיוך לעץ'}
            </button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className={h.danger}>
            <button className="btn small danger" onClick={() => remove(open)}>
              מחיקת התבנית
            </button>
            <span className="status">אי אפשר לבטל. כרטיסים שלקוחות יצרו ממנה יישארו.</span>
          </div>
        </Sheet>
      )}

      {creating && (
        <Sheet title={!business && isWording ? 'נוסח חדש' : 'תבנית חדשה'} paused={choosing !== null} onClose={() => setCreating(false)}>
          <form className={h.form} onSubmit={create}>
            {!business && (
              <label className="field">
                מה יוצרים
                <select value={isWording ? 'wording' : 'card'} onChange={(e) => setIsWording(e.target.value === 'wording')}>
                  <option value="card">כרטיס (רקע ונוסח)</option>
                  <option value="wording">נוסח לבחירה בכרטיסים</option>
                </select>
              </label>
            )}
            <div className={h.twoCols}>
              <label className="field">
                {!business && isWording ? 'שם הנוסח' : 'שם התבנית'}
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={!business && isWording ? 'למשל: מסורתי' : 'תבנית חדשה'} maxLength={100} />
              </label>
              <label className="field">
                גודל
                <select value={preset} onChange={(e) => setPreset(e.target.value)}>
                  {PAGE_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.width_mm}×{p.height_mm} מ״מ)
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!business && isWording ? (
              <label className="field">
                נושא (הנוסח נמצא לפיו)
                <input type="text" list="topic-options" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="למשל: שלום זכר" maxLength={60} required />
                <datalist id="topic-options">
                  {topicOptions.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </label>
            ) : (
              <div className={'field ' + h.placeBox}>
                מקום בעץ ותווית
                <PlaceChips nodes={nodes} ids={newPlaces} label={newLabel && labelName.get(newLabel)} />
                <button type="button" className="btn small" onClick={() => setChoosing('new')} disabled={!tree}>
                  {newPlaces.length ? 'שינוי שיוך' : 'שיוך לעץ'}
                </button>
              </div>
            )}
            <label className="field">
              {!business && isWording ? 'רקע לתצוגה (לא חובה)' : 'תמונת רקע (לא חובה)'}
              <input key={fileKey} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => setBgFile(e.target.files?.[0] ?? null)} />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <div className={h.formFoot}>
              <button className="btn primary" type="submit" disabled={busy || importing}>
                {busy && bgFile ? 'מעלה…' : busy ? 'יוצר…' : !business && isWording ? 'יצירת הנוסח' : 'יצירת התבנית'}
              </button>
              {!isWording && (
                <label className="btn sticker-upload" title="הטקסטים נקראים מהתמונה והופכים לשדות. התוצאה נפתחת כטיוטה לבדיקה.">
                  {importing ? 'קורא את העיצוב… (עד 2 דקות)' : 'מעיצוב מוכן (תמונה)'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-file" aria-label="תבנית מעיצוב מוכן" onChange={importDesign} disabled={importing || busy} />
                </label>
              )}
            </div>
          </form>
        </Sheet>
      )}

      {tree && choosing === 'new' && (
        <PlacePicker
          title="איפה תופיע התבנית החדשה"
          data={tree}
          door={door}
          value={newPlaces}
          labelId={newLabel}
          withLabel
          onClose={() => setChoosing(null)}
          onSave={(ids, label) => {
            if (ids) setNewPlaces(ids);
            if (label !== undefined) setNewLabel(label);
          }}
        />
      )}

      {tree && picking.length > 0 && (
        <PlacePicker
          title={picking.length === 1 ? `איפה מופיע "${picking[0].name}"` : `איפה מופיעות ${picking.length} התבניות שנבחרו`}
          data={tree}
          door={door}
          value={sameIds(picking.map((t) => t.places)) ? picking[0].places : []}
          labelId={picking[0].labelId}
          mixedPlaces={!sameIds(picking.map((t) => t.places))}
          mixedLabel={!sameIds(picking.map((t) => t.labelId))}
          withLabel
          onClose={() => setChoosing(null)}
          onSave={async (ids, label) => {
            if (!ids && label === undefined) return;
            await api('/api/tree/places', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ templateIds: picking.map((t) => t.id), topicIds: ids, labelId: label, audience: door }),
            });
            if (picking.length > 1) setChosen(new Set());
            await load();
          }}
        />
      )}

      {!business && view === 'categories' && !filtering && wordings.length > 0 && (
        <>
          <h2 style={{ marginTop: 32 }}>נוסחים</h2>
          <p className="sub">לקוח בתוך כרטיס יכול לעבור לכל נוסח שפורסם באותו נושא ובאותו גודל. שינוי בנוסח חל על בחירות חדשות, וכרטיסים קיימים נשארים כמו שהם.</p>
          <div className="grid">
            {wordings.map((it) => (
              <div key={it.id} className="card" style={{ display: 'grid', gap: 8 }}>
                <Link href={`/editor/${it.id}`} style={{ display: 'grid' }}>
                  <Preview src={it.thumbnail} label={`תצוגה מקדימה של ${it.name}`} />
                </Link>
                <div className="row">
                  <Link href={`/editor/${it.id}`} style={{ fontWeight: 700, fontSize: 18 }}>
                    {it.name}
                  </Link>
                  <span className="spacer" />
                  <span className={'badge ' + it.status}>{it.status === 'published' ? 'פורסם' : 'טיוטה'}</span>
                </div>
                <span className="status">
                  {it.topic} · {it.width_mm}×{it.height_mm} מ״מ
                </span>
                <div className="row">
                  <Link className="btn small primary" href={`/editor/${it.id}`}>
                    עריכה
                  </Link>
                  <button className="btn small" onClick={() => setStatus(it, it.status === 'published' ? 'draft' : 'published')}>
                    {it.status === 'published' ? 'ביטול פרסום' : 'פרסום'}
                  </button>
                  <button className="btn small danger" style={{ marginInlineStart: 'auto' }} onClick={() => remove(it)}>
                    מחיקה
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      </DoorTurn>
    </main>
  );
}
