'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMe } from '@/components/Auth';
import { BUILTIN_FONTS, WEIGHT_NAMES, type UploadedFont } from '@/lib/fonts';
import { registerFonts } from '@/lib/fonts-client';

type Usage = Record<string, { templates: number; designs: number }>;

const SAMPLE = 'מזל טוב! שמחה וששון · Mazal Tov 2026';
const ACCEPT = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'שגיאה לא צפויה');
  return data as T;
}

export default function FontsPage() {
  const { me } = useMe();
  if (me?.role !== 'admin') {
    return (
      <main className="page">
        <p className="error" role="alert">העמוד הזה זמין למנהלים בלבד.</p>
      </main>
    );
  }
  return <FontsManager />;
}

function usageText(u: { templates: number; designs: number } | undefined) {
  if (!u || (!u.templates && !u.designs)) return 'לא בשימוש';
  const parts = [u.templates && `${u.templates} תבניות`, u.designs && `${u.designs} עיצובים של לקוחות`].filter(Boolean);
  return 'בשימוש ב-' + parts.join(' וב-');
}

function FontsManager() {
  const [fonts, setFonts] = useState<UploadedFont[]>([]);
  const [usage, setUsage] = useState<Usage>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [family, setFamily] = useState('');
  const [weight, setWeight] = useState('');
  const [uploading, setUploading] = useState(0);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const data = await api<{ fonts: UploadedFont[]; usage: Usage }>('/api/fonts?usage=1');
    registerFonts(data.fonts);
    setFonts(data.fonts);
    setUsage(data.usage ?? {});
    setLoaded(true);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  async function upload(list: FileList | File[]) {
    const files = Array.from(list);
    if (!files.length) return;
    setError('');
    setNotice('');
    const errors: string[] = [];
    const added: UploadedFont[] = [];
    setUploading((n) => n + files.length);
    for (const file of files) {
      try {
        const form = new FormData();
        form.append('file', file);
        if (family.trim()) form.append('family', family.trim());
        if (weight) form.append('weight', weight);
        added.push(await api<UploadedFont>('/api/fonts', { method: 'POST', body: form }));
      } catch (err) {
        errors.push(`${file.name}: ${(err as Error).message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    await load();
    if (added.length) {
      setNotice(`נוספו: ${added.map((f) => `${f.family} ${WEIGHT_NAMES[f.weight] ?? f.weight}${f.style === 'italic' ? ' נטוי' : ''}`).join(', ')}`);
      setFamily('');
      setWeight('');
    }
    if (errors.length) setError(errors.join(' | '));
  }

  async function remove(f: UploadedFont, lastOfFamily: boolean) {
    const u = usage[f.family];
    const used = u && (u.templates || u.designs);
    const what = `${f.family} ${WEIGHT_NAMES[f.weight] ?? f.weight}${f.style === 'italic' ? ' נטוי' : ''}`;
    const msg =
      used && lastOfFamily
        ? `"${f.family}" ${usageText(u)}. אחרי המחיקה הטקסטים האלה יוצגו בפונט ברירת מחדל, עד שתעלו את הפונט שוב באותו שם. למחוק?`
        : `למחוק את "${what}"?`;
    if (!confirm(msg)) return;
    setError('');
    setNotice('');
    try {
      await api(`/api/fonts/${f.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const families = [...new Set(fonts.map((f) => f.family))];

  return (
    <main className="page">
      <h1>פונטים</h1>
      <p className="sub">
        פונטים שתעלו כאן יופיעו בעורך לצד הפונטים המובנים ({BUILTIN_FONTS.map((f) => f.family).join(', ')}). לכל משקל (רגיל, מודגש וכו׳)
        מעלים קובץ נפרד באותו שם משפחה.
      </p>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="status" role="status">{notice}</p>}

      <div style={{ display: 'grid', gap: 16 }}>
        <section className="card" style={{ display: 'grid', gap: 12 }} aria-label="העלאת פונט">
          <div className="row" style={{ alignItems: 'end', flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: '1 1 240px' }}>
              שם המשפחה (לא חובה, אחרת נלקח מהקובץ)
              <input type="text" value={family} maxLength={60} onChange={(e) => setFamily(e.target.value)} placeholder="למשל: גוטמן פרנק" />
            </label>
            <label className="field" style={{ width: 160 }}>
              משקל
              <select value={weight} onChange={(e) => setWeight(e.target.value)}>
                <option value="">לפי הקובץ</option>
                {Object.entries(WEIGHT_NAMES).map(([w, n]) => (
                  <option key={w} value={w}>
                    {n} ({w})
                  </option>
                ))}
              </select>
            </label>
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
            <p style={{ margin: '0 0 8px' }}>גררו לכאן קובצי פונט, או</p>
            <button className="btn primary" onClick={() => fileInput.current?.click()}>
              בחירת קבצים מהמחשב
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) upload(e.target.files);
                e.target.value = '';
              }}
            />
            <p className="status" style={{ margin: '8px 0 0' }}>
              {uploading > 0 ? `מעלה ${uploading} קבצים…` : 'TTF, OTF, WOFF או WOFF2, עד 10MB לקובץ. ודאו שיש לכם רישיון לשימוש בפונט באתר.'}
            </p>
          </div>
        </section>

        {!loaded ? (
          <p className="status">טוען…</p>
        ) : families.length === 0 ? (
          <div className="empty">עדיין לא הועלו פונטים.</div>
        ) : (
          families.map((fam) => {
            const files = fonts.filter((f) => f.family === fam);
            const hebrew = files.some((f) => f.hebrew);
            return (
              <section key={fam} className="card" style={{ display: 'grid', gap: 10 }} aria-label={fam}>
                <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <h2 style={{ margin: 0, fontSize: 20 }}>{fam}</h2>
                  <span className="status">
                    {hebrew ? 'כולל עברית' : 'ללא אותיות עבריות'} · {usageText(usage[fam])}
                  </span>
                </div>
                {files.map((f) => (
                  <div key={f.id} className="row" style={{ alignItems: 'center', gap: 12, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                    <span className="count" style={{ minWidth: 110 }}>
                      {WEIGHT_NAMES[f.weight] ?? f.weight} ({f.weight}){f.style === 'italic' ? ' · נטוי' : ''}
                    </span>
                    <span
                      dir="auto"
                      style={{ flex: 1, minWidth: 0, fontFamily: `"${f.family}", serif`, fontWeight: f.weight, fontStyle: f.style, fontSize: 24, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {SAMPLE}
                    </span>
                    <button className="btn danger small" onClick={() => remove(f, files.length === 1)}>
                      מחיקה
                    </button>
                  </div>
                ))}
              </section>
            );
          })
        )}
      </div>
    </main>
  );
}
