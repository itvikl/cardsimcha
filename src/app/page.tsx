'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PAGE_PRESETS } from '@/lib/canvas';
import { useMe } from '@/components/Auth';
import { Landing } from '@/components/Landing';
import { CATEGORIES, GENERAL_TOPIC, topicAudience, type CarouselSetting } from '@/lib/categories';
import { DoorTurn, RevolvingDoor, useAdminDoor } from '@/components/RevolvingDoor';

type Item = {
  id: string;
  kind: 'template' | 'design';
  status: 'draft' | 'published';
  name: string;
  topic: string | null;
  updatedAt: string;
  width_mm: number;
  height_mm: number;
  editableFields: number;
  thumbnail: string | null;
};


const Preview = ({ src, label }: { src: string | null; label: string }) => (
  <div className="preview" style={src ? { backgroundImage: `url(${src})`, backgroundSize: 'contain' } : undefined} aria-label={label}>
    {!src && 'אין תצוגה מקדימה'}
  </div>
);

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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [bgFile, setBgFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [door, setDoor] = useAdminDoor();
  const [carousel, setCarousel] = useState<CarouselSetting[]>([]);

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
    setBusy(true);
    setError('');
    try {
      const backgroundAssetId = bgFile ? await uploadBackground(bgFile) : undefined;
      const r = await api<{ id: string }>('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, topic, audience: door, width_mm: p.width_mm, height_mm: p.height_mm, backgroundAssetId }),
      });
      router.push(`/editor/${r.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
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

  async function saveTopic(it: Item, input: HTMLInputElement) {
    const next = input.value.trim();
    if (next === (it.topic ?? '')) return;
    setError('');
    try {
      await api(`/api/projects/${it.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: next, audience: door }),
      });
      await load();
    } catch (err) {
      // refused (e.g. a topic of the other door): show the saved topic again
      input.value = it.topic ?? '';
      setError((err as Error).message);
    }
  }

  const inDoor = (topicName: string) => topicAudience(topicName, carousel) === door;
  // a template without a topic lands in "כללי", which is on the private side
  const templates = items?.filter((i) => i.kind === 'template' && inDoor(i.topic || GENERAL_TOPIC)) ?? [];
  /** example topics shown to the admin as suggestions; any free text is accepted */
  const topicOptions = Array.from(
    new Set([
      ...CATEGORIES.map((c) => c.name),
      ...carousel.map((c) => c.name),
      ...(items ?? []).map((t) => t.topic).filter((t): t is string => !!t),
    ])
  ).filter(inDoor);
  const business = door === 'business';

  return (
    <main className="page">
      <RevolvingDoor value={door} onChange={setDoor} />
      <DoorTurn door={door}>
      <h1>{business ? 'תבניות לעסקים' : 'תבניות לשמחות'}</h1>
      <p className="sub">
        בנו תבנית, סמנו אילו טקסטים הלקוח יכול לערוך, ופרסמו אותה. לקוחות רואים רק תבניות שפורסמו.
        {business ? ' התבניות כאן מופיעות בדלת "לעסק" בעמוד הבית.' : ' התבניות כאן מופיעות בדלת "לשמחה" בעמוד הבית.'}
      </p>

      <form className="card row" onSubmit={create} style={{ marginBottom: 24, alignItems: 'end' }}>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          שם התבנית
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="תבנית חדשה" maxLength={100} />
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
        <label className="field">
          נושא (קטגוריה לעמוד הבית)
          <input
            type="text"
            list="topic-options"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={business ? 'למשל: מודעות מבצע' : 'למשל: בית כנסת'}
            maxLength={60}
            // without a topic a template lands in "כללי", on the private side
            required={business}
          />
        </label>
        <label className="field">
          תמונת רקע (לא חובה)
          <input
            key={fileKey}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => setBgFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy && bgFile ? 'מעלה…' : 'תבנית חדשה'}
        </button>
      </form>

      <datalist id="topic-options">
        {topicOptions.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      {error && <p className="error" role="alert">{error}</p>}

      {items === null ? (
        <p className="status">טוען…</p>
      ) : templates.length === 0 ? (
        <div className="empty">
          {business ? 'עוד אין תבניות לעסקים.' : 'עוד אין תבניות לשמחות.'} צרו את הראשונה למעלה. כדי להוסיף תמונות, פתחו קודם את "קטגוריות ותמונות".
        </div>
      ) : (
        <div className="grid">
          {templates.map((it) => (
            <div key={it.id} className="card" style={{ display: 'grid', gap: 8 }}>
              <Link href={`/editor/${it.id}`}>
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
                {it.width_mm}×{it.height_mm} מ״מ · {it.editableFields} שדות לעריכה ללקוח
              </span>
              <label className="field" style={{ fontSize: 13 }}>
                נושא (קטגוריה לעמוד הבית)
                <input
                  type="text"
                  list="topic-options"
                  defaultValue={it.topic ?? ''}
                  placeholder="לא הוגדר נושא"
                  maxLength={60}
                  onBlur={(e) => saveTopic(it, e.currentTarget)}
                />
              </label>
              <div className="row">
                <Link className="btn small primary" href={`/editor/${it.id}`}>
                  עריכה
                </Link>
                {it.status === 'published' ? (
                  <button className="btn small" onClick={() => setStatus(it, 'draft')}>
                    ביטול פרסום
                  </button>
                ) : (
                  <button className="btn small" onClick={() => setStatus(it, 'published')}>
                    פרסום
                  </button>
                )}
                <button className="btn small" onClick={() => tryAsCustomer(it)} title="יוצר עותק ניסיון שנראה כמו אצל לקוח">
                  נסה כלקוח
                </button>
                <button className="btn small danger" onClick={() => remove(it)}>
                  מחיקה
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      </DoorTurn>
    </main>
  );
}
