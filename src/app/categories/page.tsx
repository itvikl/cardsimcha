'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Category, ImageAsset } from '@/lib/types';
import { useMe } from '@/components/Auth';
import { PlaceChips, PlacePicker, sameIds, useTreeData } from '@/components/PlacePicker';
import { TreeCrumbs, TreeHeading, TreeKids, TreeTile, TreeTiles, TreeTop, UNFILED, useTreeIndex, useTreeSpot } from '@/components/TreeBrowse';
import type { TreeNode } from '@/lib/data/tree';

const howMany = (n: number) => (n === 1 ? 'תמונה אחת' : `${n} תמונות`);

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'שגיאה לא צפויה');
  return data as T;
}

function readSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`הקובץ "${file.name}" אינו תמונה תקינה`));
    };
    img.src = url;
  });
}

export default function CategoriesPage() {
  const { me } = useMe();
  if (me?.role !== 'admin') {
    return (
      <main className="page">
        <p className="error" role="alert">העמוד הזה זמין למנהלים בלבד.</p>
      </main>
    );
  }
  return <CategoriesManager />;
}

function CategoriesManager() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(0);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { data: tree } = useTreeData();
  /** where each image is filed in the occasion tree (a background shows in the cards of those places) */
  const [places, setPlaces] = useState<Record<string, string[]>>({});
  /** the images the tree picker is open for (one, or the chosen ones) */
  const [placing, setPlacing] = useState<ImageAsset[] | null>(null);
  /** images chosen for filing together; kept while moving between folders */
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  /** the library is seen by its folders, or by where its images are filed in the tree */
  const [mode, setMode] = useState<'folders' | 'tree'>('folders');
  const [at, go] = useTreeSpot();
  const byTree = mode === 'tree' || at !== null;
  const nodes = useMemo<TreeNode[]>(() => tree?.nodes ?? [], [tree]);
  const { byId, lineOf, childrenOf, onTree, holdings } = useTreeIndex(nodes);

  const load = useCallback(async () => {
    api<Record<string, string[]>>('/api/tree/assets').then(setPlaces).catch(() => {});
    const lib = await api<{ categories: Category[]; images: ImageAsset[] }>('/api/library');
    setCategories(lib.categories);
    setImages(lib.images);
    setSelectedId((cur) => (cur && lib.categories.some((c) => c.id === cur) ? cur : lib.categories[0]?.id ?? null));
    setLoaded(true);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  const selected = categories.find((c) => c.id === selectedId) ?? null;
  const catImages = images.filter((i) => i.categoryId === selectedId);

  // the same images as the tree sees them
  const placesOf = (i: ImageAsset) => places[i.id] ?? [];
  const holds = holdings(images, placesOf);
  const unfiled = images.filter((i) => !placesOf(i).some(onTree));
  const here = at && at !== UNFILED ? byId.get(at) : undefined;
  const line = here ? lineOf(here.id) : [];
  const above = line.slice(0, -1);
  const fromAbove = here ? images.filter((i) => !holds.get(here.id)?.includes(i) && placesOf(i).some((p) => above.some((a) => a.id === p))) : [];
  const treeImages = here ? (holds.get(here.id) ?? []) : at === UNFILED ? unfiled : [];
  /** the images on screen, which "choose all" takes */
  const shownImages = byTree ? treeImages : catImages;
  const allShownChosen = shownImages.length > 0 && shownImages.every((i) => chosen.has(i.id));
  const urlOf = (i: ImageAsset) => `/api/uploads/${i.file}`;

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const cat = await api<Category>('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      setNewName('');
      await load();
      setSelectedId(cat.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveCategory(patch: Partial<Pick<Category, 'name' | 'description'>>) {
    if (!selected) return;
    setError('');
    try {
      await api(`/api/categories/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
      await load();
    }
  }

  async function deleteCategory() {
    if (!selected) return;
    const n = catImages.length;
    const msg = n
      ? `למחוק את התיקייה "${selected.name}" ואת ${n} התמונות שבה? אי אפשר לבטל.`
      : `למחוק את התיקייה "${selected.name}"?`;
    if (!confirm(msg)) return;
    setError('');
    try {
      await api(`/api/categories/${selected.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function upload(files: FileList | File[]) {
    if (!selected) return;
    const list = Array.from(files);
    if (!list.length) return;
    setError('');
    const errors: string[] = [];
    setUploading((n) => n + list.length);
    for (const file of list) {
      try {
        const { width, height } = await readSize(file);
        const form = new FormData();
        form.append('file', file);
        form.append('width', String(width));
        form.append('height', String(height));
        await api(`/api/categories/${selected.id}/images`, { method: 'POST', body: form });
      } catch (err) {
        errors.push(`${file.name}: ${(err as Error).message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    await load();
    if (errors.length) setError(errors.join(' | '));
  }

  async function renameImage(img: ImageAsset, name: string) {
    if (!name.trim() || name === img.name) return;
    try {
      await api(`/api/images/${img.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function deleteImage(img: ImageAsset) {
    if (!confirm(`למחוק את "${img.name}"? עיצובים שמשתמשים בתמונה יציגו מקום ריק.`)) return;
    try {
      await api(`/api/images/${img.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const selectAll = shownImages.length > 0 && tree && (
    <button
      type="button"
      className="btn small"
      onClick={() =>
        setChosen((c) => {
          const next = new Set(c);
          shownImages.forEach((i) => (allShownChosen ? next.delete(i.id) : next.add(i.id)));
          return next;
        })
      }
    >
      {allShownChosen ? 'ביטול הבחירה כאן' : 'בחירת כל התמונות כאן'}
    </button>
  );

  const imageGrid = (list: ImageAsset[]) => (
    <div className="thumb-grid">
      {list.map((img) => (
        <figure key={img.id} className={'thumb' + (chosen.has(img.id) ? ' chosen' : '')} style={{ margin: 0, position: 'relative' }}>
          <label className="thumb-check" title="בחירה">
            <input
              type="checkbox"
              checked={chosen.has(img.id)}
              aria-label={`בחירת ${img.name || 'התמונה'}`}
              onChange={() =>
                setChosen((c) => {
                  const next = new Set(c);
                  if (next.has(img.id)) next.delete(img.id);
                  else next.add(img.id);
                  return next;
                })
              }
            />
          </label>
          <div className="img">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={urlOf(img)} alt={img.name} loading="lazy" />
          </div>
          <figcaption className="meta">
            <input
              type="text"
              defaultValue={img.name}
              aria-label="שם התמונה"
              maxLength={100}
              style={{ minHeight: 32, padding: '4px 8px' }}
              onBlur={(e) => renameImage(img, e.target.value)}
            />
            <span className="count">
              {img.width}×{img.height}
            </span>
            {tree && <PlaceChips nodes={tree.nodes} ids={places[img.id] ?? []} />}
            <div className="row" style={{ gap: 6 }}>
              <button className="btn small" onClick={() => setPlacing([img])} disabled={!tree} title="באילו כרטיסים הרקע מוצע">
                {places[img.id]?.length ? 'שינוי שיוך' : 'שיוך לעץ'}
              </button>
              <button className="btn danger small" style={{ marginInlineStart: 'auto' }} onClick={() => deleteImage(img)}>
                מחיקה
              </button>
            </div>
          </figcaption>
        </figure>
      ))}
    </div>
  );

  return (
    <main className="page">
      <h1>ספריית תמונות</h1>
      <p className="sub">התמונות שמכניסים לעיצובים. תמונה ששויכה למקום בעץ מוצעת כרקע בעיצובים של אותו מקום.</p>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="view-switch" role="group" aria-label="תצוגה">
        <button
          type="button"
          aria-pressed={!byTree}
          onClick={() => {
            setMode('folders');
            if (at) go(null);
          }}
        >
          לפי תיקיות
        </button>
        <button type="button" aria-pressed={byTree} onClick={() => setMode('tree')}>
          לפי העץ
        </button>
      </div>

      <TreeTop />
      {byTree ? (
        !loaded || !tree ? (
          <p className="status">טוען…</p>
        ) : at === null || (at !== UNFILED && !here) ? (
          <>
            <TreeHeading title="לפי קטגוריות" detail={`${howMany(images.length - unfiled.length)} משויכות`} />
            <TreeTiles>
              {childrenOf(null).map((c) => {
                const list = holds.get(c.id) ?? [];
                return (
                  <TreeTile
                    key={c.id}
                    name={c.name}
                    detail={(c.audience === 'business' ? 'לעסק · ' : '') + howMany(list.length)}
                    thumbs={list.map(urlOf)}
                    onOpen={() => go(c.id)}
                  />
                );
              })}
              {unfiled.length > 0 && <TreeTile name="לא משויכות לעץ" detail={howMany(unfiled.length)} thumbs={unfiled.map(urlOf)} warn onOpen={() => go(UNFILED)} />}
            </TreeTiles>
          </>
        ) : (
          <>
            <TreeCrumbs above={above} onGo={go} />
            <TreeHeading title={here ? here.name : 'לא משויכות לעץ'} detail={howMany(treeImages.length)} action={selectAll} />
            {here && <TreeKids kids={childrenOf(here.id)} count={(id) => holds.get(id)?.length ?? 0} onGo={go} />}
            {fromAbove.length > 0 && (
              <p className="status" style={{ margin: '4px 0 0' }}>
                בעיצובים של המקום הזה מוצעות גם {howMany(fromAbove.length)} ששויכו לרמה שמעל.
              </p>
            )}
            {treeImages.length === 0 ? <div className="empty" style={{ marginTop: 12 }}>אין עדיין תמונות שמשויכות לכאן.</div> : imageGrid(treeImages)}
          </>
        )
      ) : (
      <div className="cat-layout">
        <section className="card" aria-label="רשימת תיקיות">
          <form onSubmit={addCategory} className="row" style={{ marginBottom: 12 }}>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="שם תיקייה חדשה"
              aria-label="שם תיקייה חדשה"
              maxLength={80}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button className="btn primary" type="submit" disabled={!newName.trim()}>
              הוספה
            </button>
          </form>
          {!loaded ? (
            <p className="status">טוען…</p>
          ) : categories.length === 0 ? (
            <p className="status">עדיין אין תיקיות. הוסיפו את הראשונה למעלה.</p>
          ) : (
            <div className="cat-list">
              {categories.map((c) => (
                <button
                  key={c.id}
                  className="cat-item"
                  aria-current={c.id === selectedId}
                  onClick={() => setSelectedId(c.id)}
                >
                  <span>{c.name}</span>
                  <span className="count">{images.filter((i) => i.categoryId === c.id).length}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section aria-label="פרטי התיקייה">
          {!selected ? (
            <div className="empty">בחרו תיקייה או צרו חדשה כדי להוסיף תמונות.</div>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              <div className="card" style={{ display: 'grid', gap: 12 }} key={selected.id}>
                <label className="field">
                  שם התיקייה
                  <input
                    type="text"
                    defaultValue={selected.name}
                    maxLength={80}
                    onBlur={(e) => e.target.value.trim() !== selected.name && saveCategory({ name: e.target.value })}
                  />
                </label>
                <label className="field">
                  תיאור (לא חובה)
                  <input
                    type="text"
                    defaultValue={selected.description}
                    maxLength={300}
                    onBlur={(e) => e.target.value.trim() !== selected.description && saveCategory({ description: e.target.value })}
                  />
                </label>
                <div className="row">
                  <button className="btn danger small" onClick={deleteCategory}>
                    מחיקת התיקייה
                  </button>
                </div>
              </div>

              <div
                className={'dropzone' + (over ? ' over' : '')}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  upload(e.dataTransfer.files);
                }}
              >
                <p style={{ margin: '0 0 8px' }}>גררו לכאן תמונות, או</p>
                <button className="btn primary" onClick={() => fileInput.current?.click()}>
                  בחירת תמונות מהמחשב
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files) upload(e.target.files);
                    e.target.value = '';
                  }}
                />
                <p className="status" style={{ margin: '8px 0 0' }}>
                  {uploading > 0 ? `מעלה ${uploading} קבצים…` : 'PNG, JPG, WebP או GIF, עד 25MB לקובץ. PNG שקוף נתמך.'}
                </p>
              </div>

              {catImages.length === 0 ? (
                <div className="empty">אין עדיין תמונות בתיקייה &quot;{selected.name}&quot;.</div>
              ) : (
                <>
                  <TreeHeading title="התמונות" detail={howMany(catImages.length)} action={selectAll} />
                  {imageGrid(catImages)}
                </>
              )}
            </div>
          )}
        </section>
      </div>
      )}

      {chosen.size > 0 && tree && (
        <div className="select-bar" role="toolbar" aria-label="בחירה מרובה">
          <strong>{chosen.size === 1 ? 'תמונה אחת נבחרה' : `${chosen.size} תמונות נבחרו`}</strong>
          <span className="spacer" />
          <button className="btn small" onClick={() => setChosen(new Set())}>
            ניקוי בחירה
          </button>
          <button className="btn small primary" onClick={() => setPlacing(images.filter((i) => chosen.has(i.id)))}>
            שיוך לעץ
          </button>
        </div>
      )}

      {tree && placing && placing.length > 0 && (
        <PlacePicker
          title={placing.length === 1 ? `איפה מוצע "${placing[0].name || 'הרקע'}"` : `איפה מוצעות ${placing.length} התמונות שנבחרו`}
          note={placing.length > 1 && sameIds(placing.map((i) => places[i.id] ?? [])) ? 'השמירה קובעת את אותו שיוך לכל התמונות שנבחרו.' : undefined}
          data={tree}
          value={sameIds(placing.map((i) => places[i.id] ?? [])) ? (places[placing[0].id] ?? []) : []}
          mixedPlaces={!sameIds(placing.map((i) => places[i.id] ?? []))}
          onClose={() => setPlacing(null)}
          onSave={async (ids) => {
            if (!ids) return;
            await api('/api/tree/assets', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ assetIds: placing.map((i) => i.id), topicIds: ids }),
            });
            setPlaces((p) => ({ ...p, ...Object.fromEntries(placing.map((i) => [i.id, ids])) }));
            if (placing.length > 1) setChosen(new Set());
          }}
        />
      )}
    </main>
  );
}
