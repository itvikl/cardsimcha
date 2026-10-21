'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Category, ImageAsset } from '@/lib/types';
import { useMe } from '@/components/Auth';
import { CATEGORIES, GENERAL_TOPIC, applyCarousel, defaultCards, type CarouselSetting } from '@/lib/categories';

type Published = { id: string; name: string; topic: string | null; thumbnail: string | null };
type Row = { name: string; image: string | null; hidden: boolean };

const UPLOAD_CATEGORY = 'קרוסלה';

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

export default function CarouselPage() {
  const { me } = useMe();
  if (me?.role !== 'admin') {
    return (
      <main className="page">
        <p className="error" role="alert">העמוד הזה זמין למנהלים בלבד.</p>
      </main>
    );
  }
  return <CarouselManager />;
}

function CarouselManager() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [templates, setTemplates] = useState<Published[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [picking, setPicking] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const loadLibrary = useCallback(async () => {
    const lib = await api<{ categories: Category[]; images: ImageAsset[] }>('/api/library');
    setCategories(lib.categories);
    setImages(lib.images);
    return lib;
  }, []);

  useEffect(() => {
    Promise.all([api<Published[]>('/api/templates'), api<CarouselSetting[]>('/api/carousel'), loadLibrary()])
      .then(([t, c]) => {
        setTemplates(t);
        const byName = new Map(c.map((s) => [s.name, s]));
        setRows(
          applyCarousel(defaultCards(t), c).map((card) => ({
            name: card.name,
            image: byName.get(card.name)?.image ?? null,
            hidden: card.hidden,
          }))
        );
      })
      .catch((e) => setError(e.message));
  }, [loadLibrary]);

  /** the URL an image choice shows; null image means the topic's default cover */
  function srcOf(row: Row): string | null {
    if (row.image?.startsWith('template:')) {
      return templates.find((t) => `template:${t.id}` === row.image)?.thumbnail ?? null;
    }
    if (row.image) return row.image;
    const fixed = CATEGORIES.find((c) => c.name === row.name);
    if (fixed) return fixed.image;
    return templates.find((t) => (t.topic || GENERAL_TOPIC) === row.name && t.thumbnail)?.thumbnail ?? null;
  }

  function change(name: string, patch: Partial<Row>) {
    setRows((rs) => rs && rs.map((r) => (r.name === name ? { ...r, ...patch } : r)));
    setDirty(true);
    setNotice('');
  }

  function move(i: number, by: -1 | 1) {
    setRows((rs) => {
      if (!rs || i + by < 0 || i + by >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });
    setDirty(true);
    setNotice('');
  }

  async function save() {
    if (!rows) return;
    setSaving(true);
    setError('');
    try {
      await api('/api/carousel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slides: rows }),
      });
      setDirty(false);
      setNotice('נשמר. הקרוסלה בעמוד הבית מעודכנת.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /** uploads into the "קרוסלה" library category (created on first use) and picks the new image */
  async function upload(file: File) {
    if (!picking) return;
    setUploading(true);
    setError('');
    try {
      const { width, height } = await readSize(file);
      const cat =
        categories.find((c) => c.name === UPLOAD_CATEGORY) ??
        (await api<Category>('/api/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: UPLOAD_CATEGORY, description: 'תמונות שהועלו לקרוסלה בעמוד הבית' }),
        }));
      const form = new FormData();
      form.append('file', file);
      form.append('width', String(width));
      form.append('height', String(height));
      const asset = await api<ImageAsset>(`/api/categories/${cat.id}/images`, { method: 'POST', body: form });
      await loadLibrary();
      change(picking, { image: `/api/uploads/${asset.file}` });
      setPicking(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const pickRow = rows?.find((r) => r.name === picking) ?? null;
  const shown = rows?.filter((r) => !r.hidden).length ?? 0;

  return (
    <main className="page">
      <h1>קרוסלה בעמוד הבית</h1>
      <p className="sub">בחרו אילו כרטיסים יופיעו בקרוסלה, באיזה סדר, ואיזו תמונה תוצג על כל אחד.</p>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="row" style={{ marginBottom: 16 }}>
        <button className="btn primary" onClick={save} disabled={!dirty || saving || !rows}>
          {saving ? 'שומר…' : 'שמירה'}
        </button>
        {rows && (
          <span className="status">
            {shown} מתוך {rows.length} כרטיסים מוצגים
          </span>
        )}
        {dirty && <span className="status">· יש שינויים שלא נשמרו</span>}
        {notice && <span className="status" role="status">{notice}</span>}
      </div>

      {rows === null ? (
        !error && <p className="status">טוען…</p>
      ) : (
        <div className="thumb-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          {rows.map((r, i) => {
            const src = srcOf(r);
            return (
              <figure key={r.name} className="thumb" style={{ margin: 0, opacity: r.hidden ? 0.5 : 1 }}>
                <div className="img" style={{ aspectRatio: '3 / 4' }}>
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt={`תמונת הכרטיס ${r.name}`} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span className="status">אין תמונה</span>
                  )}
                </div>
                <figcaption className="meta">
                  <strong className="name">
                    {i + 1}. {r.name}
                  </strong>
                  <label className="row" style={{ gap: 6 }}>
                    <input type="checkbox" checked={!r.hidden} onChange={(e) => change(r.name, { hidden: !e.target.checked })} />
                    מוצג בקרוסלה
                  </label>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn small" onClick={() => setPicking(r.name)}>
                      בחירת תמונה
                    </button>
                    <button className="btn small" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`הזזת ${r.name} קדימה`} title="קדימה">
                      ↑
                    </button>
                    <button className="btn small" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`הזזת ${r.name} אחורה`} title="אחורה">
                      ↓
                    </button>
                  </div>
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}

      {pickRow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`בחירת תמונה עבור ${pickRow.name}`}
          onClick={(e) => e.target === e.currentTarget && setPicking(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', padding: 16, zIndex: 100 }}
        >
          <div className="card" style={{ width: 'min(960px, 100%)', maxHeight: '85vh', overflow: 'auto', display: 'grid', gap: 16 }}>
            <div className="row">
              <strong style={{ fontSize: 20 }}>תמונה עבור "{pickRow.name}"</strong>
              <span className="spacer" />
              <button className="btn small" onClick={() => setPicking(null)}>
                סגירה
              </button>
            </div>

            <div className="row">
              <button className="btn primary small" onClick={() => fileInput.current?.click()} disabled={uploading}>
                {uploading ? 'מעלה…' : 'העלאת תמונה חדשה'}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f);
                  e.target.value = '';
                }}
              />
              <button
                className="btn small"
                onClick={() => {
                  change(pickRow.name, { image: null });
                  setPicking(null);
                }}
              >
                ברירת מחדל
              </button>
            </div>

            <PickGroup
              title="תמונות הקטגוריות המובנות"
              options={CATEGORIES.map((c) => ({ value: c.image, src: c.image, label: c.name }))}
              current={pickRow.image}
              onPick={(v) => {
                change(pickRow.name, { image: v });
                setPicking(null);
              }}
            />
            <PickGroup
              title="תבניות שפורסמו"
              options={templates
                .filter((t) => t.thumbnail)
                .map((t) => ({ value: `template:${t.id}`, src: t.thumbnail!, label: t.name }))}
              current={pickRow.image}
              onPick={(v) => {
                change(pickRow.name, { image: v });
                setPicking(null);
              }}
            />
            {categories.map((c) => (
              <PickGroup
                key={c.id}
                title={`ספריית תמונות: ${c.name}`}
                options={images
                  .filter((img) => img.categoryId === c.id)
                  .map((img) => ({ value: `/api/uploads/${img.file}`, src: `/api/uploads/${img.file}`, label: img.name }))}
                current={pickRow.image}
                onPick={(v) => {
                  change(pickRow.name, { image: v });
                  setPicking(null);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

function PickGroup({
  title,
  options,
  current,
  onPick,
}: {
  title: string;
  options: { value: string; src: string; label: string }[];
  current: string | null;
  onPick: (value: string) => void;
}) {
  if (!options.length) return null;
  return (
    <section style={{ display: 'grid', gap: 8 }}>
      <h2 style={{ fontSize: 16, margin: 0 }}>{title}</h2>
      <div className="thumb-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
        {options.map((o) => (
          <button
            key={o.value}
            className="thumb"
            onClick={() => onPick(o.value)}
            aria-pressed={o.value === current}
            title={o.label}
            style={{ padding: 0, cursor: 'pointer', outline: o.value === current ? '3px solid var(--brand-text)' : undefined }}
          >
            <div className="img">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={o.src} alt={o.label} loading="lazy" />
            </div>
            <div className="meta name" style={{ display: 'block' }}>{o.label}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
