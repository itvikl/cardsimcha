'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Category, ImageAsset } from '@/lib/types';
import { useMe } from '@/components/Auth';

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

  const load = useCallback(async () => {
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
      ? `למחוק את הקטגוריה "${selected.name}" ואת ${n} התמונות שבה? אי אפשר לבטל.`
      : `למחוק את הקטגוריה "${selected.name}"?`;
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

  return (
    <main className="page">
      <h1>קטגוריות ותמונות</h1>
      <p className="sub">צרו קטגוריות והוסיפו להן תמונות. את התמונות תוכלו להכניס לעיצובים בעורך.</p>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="cat-layout">
        <section className="card" aria-label="רשימת קטגוריות">
          <form onSubmit={addCategory} className="row" style={{ marginBottom: 12 }}>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="שם קטגוריה חדשה"
              aria-label="שם קטגוריה חדשה"
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
            <p className="status">עדיין אין קטגוריות. הוסיפו את הראשונה למעלה.</p>
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

        <section aria-label="פרטי הקטגוריה">
          {!selected ? (
            <div className="empty">בחרו קטגוריה או צרו חדשה כדי להוסיף תמונות.</div>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              <div className="card" style={{ display: 'grid', gap: 12 }} key={selected.id}>
                <label className="field">
                  שם הקטגוריה
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
                    מחיקת קטגוריה
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
                <div className="empty">אין עדיין תמונות בקטגוריה "{selected.name}".</div>
              ) : (
                <div className="thumb-grid">
                  {catImages.map((img) => (
                    <figure key={img.id} className="thumb" style={{ margin: 0 }}>
                      <div className="img">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/uploads/${img.file}`} alt={img.name} loading="lazy" />
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
                        <button className="btn danger small" onClick={() => deleteImage(img)}>
                          מחיקה
                        </button>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
