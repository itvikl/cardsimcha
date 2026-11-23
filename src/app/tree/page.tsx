'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMe } from '@/components/Auth';
import type { Label, Tree, TreeNode } from '@/lib/data/tree';
import s from './tree.module.css';

const LEVEL = { category: 'קטגוריה', event: 'אירוע', type: 'סוג' } as const;
const CHILD = { category: 'אירוע', event: 'סוג', type: null } as const;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'שגיאה לא צפויה');
  return data as T;
}

export default function TreePage() {
  const { me } = useMe();
  if (me?.role !== 'admin') {
    return (
      <main className="page">
        <p className="error" role="alert">העמוד הזה זמין למנהלים בלבד.</p>
      </main>
    );
  }
  return <TreeManager />;
}

function TreeManager() {
  const [tree, setTree] = useState<Tree | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [newDoor, setNewDoor] = useState<'private' | 'business'>('private');
  const [tab, setTab] = useState<'tree' | 'labels' | 'loose'>('tree');
  /** branches opposite to how they start: a category starts open, an event closed */
  const [flipped, setFlipped] = useState<Set<string>>(() => new Set());
  /** the node whose actions menu is open */
  const [menu, setMenu] = useState<string | null>(null);
  /** the node a new child is being typed under */
  const [adding, setAdding] = useState<string | null>(null);
  /** the row being dragged to a new place among its siblings, and the row it is over */
  const [dragged, setDragged] = useState<TreeNode | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const load = useCallback(() => api<Tree>('/api/tree').then(setTree), []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  /** runs one change, then shows the tree as the server has it */
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError('');
      setMenu(null);
      try {
        await fn();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        await load().catch(() => {});
        setBusy(false);
      }
    },
    [load],
  );

  // the menu closes on a click anywhere outside it, and on Esc
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest('[data-menu]')) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const kids = useMemo(() => {
    const m = new Map<string | null, TreeNode[]>();
    for (const n of tree?.nodes ?? []) {
      if (n.parentId === null && n.level !== 'category') continue;
      m.set(n.parentId, [...(m.get(n.parentId) ?? []), n]);
    }
    for (const list of m.values()) list.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'he'));
    return m;
  }, [tree]);

  const byId = useMemo(() => new Map((tree?.nodes ?? []).map((n) => [n.id, n])), [tree]);
  const path = useCallback(
    (n: TreeNode) => {
      const names = [n.name];
      for (let p = n.parentId && byId.get(n.parentId); p; p = p.parentId ? byId.get(p.parentId) : undefined) names.unshift(p.name);
      return names.join(' › ');
    },
    [byId],
  );

  /** every node of the tree in reading order, for the "file under" pickers */
  const ordered = useMemo(() => {
    const out: TreeNode[] = [];
    const walk = (id: string | null) => kids.get(id)?.forEach((n) => (out.push(n), walk(n.id)));
    walk(null);
    return out;
  }, [kids]);

  const loose = useMemo(
    () => (tree?.nodes ?? []).filter((n) => n.parentId === null && n.level !== 'category').sort((a, b) => a.name.localeCompare(b.name, 'he')),
    [tree],
  );

  const isOpen = (n: TreeNode) => (n.level === 'category') !== flipped.has(n.id);
  const setOpen = (n: TreeNode, open: boolean) =>
    setFlipped((f) => {
      const next = new Set(f);
      if (open === (n.level === 'category')) next.delete(n.id);
      else next.add(n.id);
      return next;
    });
  const branches = ordered.filter((n) => n.level !== 'type');
  const allOpen = branches.every(isOpen);
  const openAll = (open: boolean) => setFlipped(new Set(branches.filter((n) => open !== (n.level === 'category')).map((n) => n.id)));

  const ctx: Ctx = { kids, ordered, path, run, busy, isOpen, setOpen, menu, setMenu, adding, setAdding, dragged, setDragged, over, setOver };
  const shownTab = tab === 'loose' && !loose.length ? 'tree' : tab;

  return (
    <main className="page">
      <h1>עץ הקטגוריות</h1>
      <p className="sub">קטגוריה, בתוכה אירוע, בתוכו סוג. מה שמשויך לרמה גבוהה מופיע גם בכל מה שמתחתיה.</p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {tree && tree.unfiled.length > 0 && (
        <Link href="/#unfiled" className={s.todo}>
          <strong>{tree.unfiled.length === 1 ? 'עיצוב אחד מחכה לשיוך' : `${tree.unfiled.length} עיצובים מחכים לשיוך`}</strong>
          <span>לקוחות לא מגיעים אליהם עד שישויכו. למעבר אליהם</span>
        </Link>
      )}

      <div className={s.tabs} role="group" aria-label="חלקי העמוד">
        <button type="button" aria-pressed={shownTab === 'tree'} onClick={() => setTab('tree')}>
          העץ
        </button>
        <button type="button" aria-pressed={shownTab === 'labels'} onClick={() => setTab('labels')}>
          תוויות
        </button>
        {loose.length > 0 && (
          <button type="button" aria-pressed={shownTab === 'loose'} onClick={() => setTab('loose')}>
            נושאים ישנים ({loose.length})
          </button>
        )}
      </div>

      {!tree ? (
        !error && <p className="status">טוען…</p>
      ) : shownTab === 'tree' ? (
        <>
          <div className={s.toolbar}>
            <form
              className={s.addCat}
              onSubmit={(e) => {
                e.preventDefault();
                const name = newCat.trim();
                if (!name) return;
                run(async () => {
                  await api('/api/tree', { method: 'POST', body: JSON.stringify({ name, audience: newDoor }) });
                  setNewCat('');
                });
              }}
            >
              <input type="text" id="new-category" value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="שם של קטגוריה חדשה" maxLength={60} aria-label="שם של קטגוריה חדשה" />
              <select id="new-category-door" value={newDoor} onChange={(e) => setNewDoor(e.target.value as 'private' | 'business')} aria-label="דלת">
                <option value="private">לשמחה</option>
                <option value="business">לעסק</option>
              </select>
              <button className="btn primary small" disabled={busy || !newCat.trim()}>
                הוספת קטגוריה
              </button>
            </form>
            <button type="button" className="btn small" onClick={() => openAll(!allOpen)}>
              {allOpen ? 'קיפול הכול' : 'פתיחת הכול'}
            </button>
          </div>
          <ul className={s.tree}>
            {(kids.get(null) ?? []).map((n, i, all) => (
              <NodeRow key={n.id} node={n} index={i} count={all.length} ctx={ctx} />
            ))}
          </ul>
        </>
      ) : shownTab === 'labels' ? (
        <section className={s.section}>
          <p className="status">התווית אומרת מה העיצוב, ליד העץ שאומר לאיזה אירוע. בתוך כל מקום בעץ הלקוח יוכל לסנן לפיה.</p>
          <div className={s.labelDoors}>
            <LabelList title="לשמחה" audience="private" labels={tree.labels} ctx={ctx} />
            <LabelList title="לעסק" audience="business" labels={tree.labels} ctx={ctx} />
          </div>
        </section>
      ) : (
        <section className={s.section}>
          <p className="status">נושאים מלפני העץ, שהאתר ללקוח עוד קורא כרגע. העיצובים שלהם כבר קיבלו תווית ומקום בעץ. כשהאתר ללקוח יעבור לעץ, אפשר יהיה למחוק אותם.</p>
          <ul className={s.loose}>
            {loose.map((n) => (
              <li key={n.id} className={s.looseRow}>
                <strong>{n.name}</strong>
                <Counts node={n} />
                <span className="spacer" />
                <select
                  value=""
                  disabled={busy}
                  aria-label={`שיבוץ ${n.name} בעץ`}
                  onChange={(e) => {
                    const to = e.target.value;
                    if (to) run(() => api(`/api/tree/${n.id}`, { method: 'PATCH', body: JSON.stringify({ parentId: to === 'root' ? null : to }) }));
                  }}
                >
                  <option value="">לשבץ תחת…</option>
                  <option value="root">להפוך לקטגוריה</option>
                  {ordered
                    .filter((p) => p.level !== 'type')
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {path(p)} (יהיה {CHILD[p.level]})
                      </option>
                    ))}
                </select>
                {n.templates + n.assets === 0 && (
                  <button className="btn small danger" disabled={busy} onClick={() => run(() => api(`/api/tree/${n.id}`, { method: 'DELETE' }))}>
                    מחיקה
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

type Ctx = {
  kids: Map<string | null, TreeNode[]>;
  ordered: TreeNode[];
  path: (n: TreeNode) => string;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  isOpen: (n: TreeNode) => boolean;
  setOpen: (n: TreeNode, open: boolean) => void;
  menu: string | null;
  setMenu: (id: string | null) => void;
  adding: string | null;
  setAdding: (id: string | null) => void;
  dragged: TreeNode | null;
  setDragged: (n: TreeNode | null) => void;
  over: string | null;
  setOver: (id: string | null) => void;
};

function LabelList({ title, audience, labels, ctx }: { title: string; audience: 'private' | 'business'; labels: Label[]; ctx: Ctx }) {
  const { run, busy } = ctx;
  const [name, setName] = useState('');
  const mine = labels.filter((l) => l.audience === audience);
  return (
    <div className={s.labelDoor}>
      <h3>{title}</h3>
      <ul className={s.labelList}>
        {mine.map((l) => (
          <li key={l.id} className={s.labelRow}>
            <input
              type="text"
              id={`label-${l.id}`}
              defaultValue={l.name}
              maxLength={40}
              aria-label={`שם התווית ${l.name}`}
              onBlur={(e) => {
                const v = e.currentTarget.value.trim();
                if (v && v !== l.name) run(() => api(`/api/labels/${l.id}`, { method: 'PATCH', body: JSON.stringify({ name: v }) }));
              }}
            />
            <span className="status">{l.templates ? `${l.templates} עיצובים` : 'ריק'}</span>
            <button
              className="btn small danger"
              disabled={busy}
              onClick={() => {
                if (!l.templates || confirm(`למחוק את התווית "${l.name}"? ${l.templates} עיצובים יישארו בלי תווית, במקום שלהם בעץ.`)) {
                  run(() => api(`/api/labels/${l.id}`, { method: 'DELETE' }));
                }
              }}
            >
              מחיקה
            </button>
          </li>
        ))}
      </ul>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          if (n) run(async () => (await api('/api/labels', { method: 'POST', body: JSON.stringify({ name: n, audience }) }), setName('')));
        }}
      >
        <input type="text" id={`new-label-${audience}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="תווית חדשה" maxLength={40} aria-label={`תווית חדשה ${title}`} />
        <button className="btn small" disabled={busy || !name.trim()}>
          הוספה
        </button>
      </form>
    </div>
  );
}

function Counts({ node }: { node: TreeNode }) {
  const parts = [node.templates && `${node.templates} עיצובים`, node.assets && `${node.assets} רקעים`].filter(Boolean);
  return <span className="status">{parts.length ? parts.join(' · ') : 'ריק'}</span>;
}

function NodeRow({ node, index, count, ctx }: { node: TreeNode; index: number; count: number; ctx: Ctx }) {
  const { kids, ordered, path, run, busy, isOpen, setOpen, menu, setMenu, adding, setAdding, dragged, setDragged, over, setOver } = ctx;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(node.name);
  const [child, setChild] = useState('');
  const menuButton = useRef<HTMLButtonElement>(null);
  const children = kids.get(node.id) ?? [];
  const childLevel = CHILD[node.level];
  const open = !!childLevel && isOpen(node);
  const menuOpen = menu === node.id;
  const canDelete = !children.length && node.templates + node.assets === 0;

  // where it can go: a node with children keeps its level, a leaf may change it
  const destinations =
    node.level === 'category'
      ? []
      : ordered.filter((p) => {
          if (p.id === node.parentId || p.id === node.id || p.level === 'type') return false;
          if (children.length) return CHILD[p.level] === LEVEL[node.level];
          return true;
        });

  const move = (parentId: string | null, i?: number) =>
    run(() => api(`/api/tree/${node.id}`, { method: 'PATCH', body: JSON.stringify({ parentId, index: i }) }));

  const dropsHere = !!dragged && dragged.id !== node.id && dragged.parentId === node.parentId;

  return (
    <li className={s.node} data-level={node.level}>
      <div
        className={s.line + (over === node.id && dropsHere ? ' ' + s.dropTarget : '')}
        draggable={!renaming && !menuOpen && !busy}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', node.name);
          setDragged(node);
        }}
        onDragEnd={() => {
          setDragged(null);
          setOver(null);
        }}
        onDragOver={(e) => {
          if (!dropsHere) return;
          e.preventDefault();
          if (over !== node.id) setOver(node.id);
        }}
        onDrop={(e) => {
          if (!dropsHere) return;
          e.preventDefault();
          const moved = dragged!;
          setDragged(null);
          setOver(null);
          run(() => api(`/api/tree/${moved.id}`, { method: 'PATCH', body: JSON.stringify({ parentId: node.parentId, index }) }));
        }}
      >
        <span className={s.grip} aria-hidden title="גוררים כדי לשנות סדר">
          <svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor">
            {[2, 8, 14].flatMap((y) => [2, 8].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />))}
          </svg>
        </span>
        {childLevel ? (
          <button type="button" className={s.toggle} aria-expanded={open} aria-label={`${open ? 'קיפול' : 'פתיחה של'} ${node.name}`} onClick={() => setOpen(node, !open)}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10 3 5 8l5 5" />
            </svg>
          </button>
        ) : (
          <span className={s.noToggle} />
        )}
        {renaming ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api(`/api/tree/${node.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
                setRenaming(false);
              });
            }}
          >
            <input type="text" id={`rename-${node.id}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus aria-label="שם חדש" />
            <button className="btn small primary" disabled={busy || !name.trim()}>
              שמירה
            </button>
            <button type="button" className="btn small" onClick={() => (setRenaming(false), setName(node.name))}>
              ביטול
            </button>
          </form>
        ) : childLevel ? (
          <button type="button" className={s.name} onClick={() => setOpen(node, !open)}>
            {node.name}
          </button>
        ) : (
          <span className={s.name}>{node.name}</span>
        )}
        {node.level === 'category' && node.audience === 'business' && <span className="badge">לעסק</span>}
        <Counts node={node} />
        <span className="spacer" />
        <div className={s.menuWrap} data-menu>
          <button
            ref={menuButton}
            type="button"
            className={s.menuButton}
            aria-expanded={menuOpen}
            aria-label={`פעולות על ${node.name}`}
            onClick={() => setMenu(menuOpen ? null : node.id)}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
              <circle cx="3" cy="8" r="1.6" />
              <circle cx="8" cy="8" r="1.6" />
              <circle cx="13" cy="8" r="1.6" />
            </svg>
          </button>
          {menuOpen && (
            <div className={s.menu}>
              <button type="button" onClick={() => (setMenu(null), setRenaming(true))}>
                שינוי שם
              </button>
              <button type="button" disabled={busy || index === 0} onClick={() => move(node.parentId, index - 1)}>
                הזזה למעלה
              </button>
              <button type="button" disabled={busy || index === count - 1} onClick={() => move(node.parentId, index + 1)}>
                הזזה למטה
              </button>
              {destinations.length > 0 && (
                <select value="" disabled={busy} aria-label={`העברת ${node.name}`} onChange={(e) => e.target.value && move(e.target.value)}>
                  <option value="">העברה אל…</option>
                  {destinations.map((p) => (
                    <option key={p.id} value={p.id}>
                      {path(p)}
                    </option>
                  ))}
                </select>
              )}
              <hr />
              <button type="button" className={s.menuDanger} disabled={busy || !canDelete} onClick={() => run(() => api(`/api/tree/${node.id}`, { method: 'DELETE' }))}>
                מחיקה
              </button>
              {!canDelete && <span className={s.menuNote}>אפשר למחוק רק מקום ריק</span>}
            </div>
          )}
        </div>
      </div>

      {open && childLevel && (
        <ul>
          {children.map((c, i) => (
            <NodeRow key={c.id} node={c} index={i} count={children.length} ctx={ctx} />
          ))}
          <li className={s.addRow}>
            {adding === node.id ? (
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = child.trim();
                  if (!n) return;
                  run(async () => {
                    await api('/api/tree', { method: 'POST', body: JSON.stringify({ name: n, parentId: node.id }) });
                    setChild('');
                    setAdding(null);
                  });
                }}
              >
                <input type="text" id={`add-${node.id}`} value={child} onChange={(e) => setChild(e.target.value)} placeholder={`${childLevel} חדש ב${node.name}`} maxLength={60} autoFocus aria-label={`${childLevel} חדש`} />
                <button className="btn small primary" disabled={busy || !child.trim()}>
                  הוספה
                </button>
                <button type="button" className="btn small" onClick={() => (setAdding(null), setChild(''))}>
                  ביטול
                </button>
              </form>
            ) : (
              <button type="button" className={s.addButton} onClick={() => setAdding(node.id)}>
                + הוספת {childLevel}
              </button>
            )}
          </li>
        </ul>
      )}
    </li>
  );
}
