'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMe } from './Auth';
import { flyCard, landCard } from './CardFlight';
import { MirrorRing, type RingItem } from './MirrorRing';
import s from './festive.module.css';
import { formatPrice } from '@/lib/price';
import { applyFill, fillFor, type Answers, type CardLine, type Story } from '@/lib/story';
import { renderCard, type DrawableDoc } from '@/lib/renderCard';

type Design = { id: string; name: string; price: number | null; thumbnail: string | null; canvas: DrawableDoc };

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('he', { granularity: 'grapheme' }) : null;
const HEBREW_OR_SPACE = /[\p{Script=Hebrew}\s]/u;

/**
 * The pieces a line is inked in: each Hebrew letter and space alone, but a run of digits, Latin or punctuation
 * (19:30, a phone number) kept whole. Each piece is its own box, and boxes follow the line's right-to-left order,
 * so a number split into digits would come out reversed.
 */
function pieces(text: string) {
  const out: string[] = [];
  for (const g of segmenter ? [...segmenter.segment(text)].map((x) => x.segment) : Array.from(text)) {
    const last = out[out.length - 1];
    if (!HEBREW_OR_SPACE.test(g) && last !== undefined && !HEBREW_OR_SPACE.test(last)) out[out.length - 1] = last + g;
    else out.push(g);
  }
  return out;
}

/** a line written in ink: each new letter appears as it is typed (pieces already there keep their key, so they stay put) */
function Ink({ text }: { text: string }) {
  return (
    <>
      {pieces(text).map((ch, i) => (
        <span key={i} className={s.inkLetter}>
          {ch}
        </span>
      ))}
    </>
  );
}

const storageKey = (topic: string) => `story:${topic}`;

/**
 * The story of a simcha, on its category page (acts 3 and 4 of the experience):
 * a blank invitation is written in front of the visitor, one question at a time, each answer appearing on it in ink;
 * then the card dissolves into the ring and every design of the category is dealt out with those details already in it.
 * Opening one creates the customer's copy with the details filled and flies it into the editor.
 * The answers stay in this tab (sessionStorage), so a visitor who signs up on the way comes back to them.
 */
export function StoryTable({ topic, story, onSkip }: { topic: string; story: Story; onSkip: () => void }) {
  const { me } = useMe();
  const router = useRouter();
  const qs = story.questions;
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<'writing' | 'folding' | 'reveal'>('writing');
  const [designs, setDesigns] = useState<Design[] | null>(null);
  const [ring, setRing] = useState<RingItem[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fills = useRef(new Map<string, Record<string, string>>());
  const inputRef = useRef<HTMLInputElement>(null);

  const q = qs[step];
  const complete = (a: Answers) => qs.every((x) => x.optional || (a[x.key] ?? '').trim());

  // a story already told in this tab goes straight to its invitations
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey(topic)) ?? 'null') as Answers | null;
      if (saved) {
        setAnswers(saved);
        if (complete(saved)) setPhase('reveal');
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey(topic), JSON.stringify(answers));
    } catch {}
  }, [topic, answers]);

  // the designs load while the visitor writes
  useEffect(() => {
    fetch(`/api/templates/canvas?topic=${encodeURIComponent(topic)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'טעינת העיצובים נכשלה');
        setDesigns(d as Design[]);
      })
      .catch((e) => setError(e.message));
  }, [topic]);

  // act 4: every design drawn with the answers
  useEffect(() => {
    if (phase === 'writing' || !designs) return;
    let alive = true;
    (async () => {
      const items: RingItem[] = [];
      for (const d of designs) {
        const fill = fillFor(d.canvas, answers);
        fills.current.set(d.id, fill);
        const image = await renderCard(applyFill(d.canvas, fill)).catch(() => d.thumbnail);
        items.push({ id: d.id, name: d.name, image, note: d.price === null ? 'עם הפרטים שלכם' : `עם הפרטים שלכם · ${formatPrice(d.price)}` });
      }
      if (alive) setRing(items);
    })();
    return () => {
      alive = false;
    };
  }, [phase, designs, answers]);

  // the paper folds away, then the ring is dealt
  useEffect(() => {
    if (phase !== 'folding') return;
    const t = setTimeout(() => setPhase('reveal'), 900);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase === 'writing') inputRef.current?.focus();
  }, [step, phase]);

  const set = (v: string) => setAnswers((a) => ({ ...a, [q.key]: v }));
  const value = q ? answers[q.key] ?? '' : '';
  const canGo = !!q && (q.optional || value.trim() !== '');

  function next(e?: FormEvent) {
    e?.preventDefault();
    if (!canGo) return;
    if (step < qs.length - 1) setStep(step + 1);
    else {
      setRing(null);
      setPhase('folding');
    }
  }
  function skip() {
    setAnswers((a) => ({ ...a, [q.key]: '' }));
    if (step < qs.length - 1) setStep(step + 1);
    else setPhase('folding');
  }

  const open = useCallback(
    async (item: RingItem, from: DOMRect | null) => {
      if (!me) {
        // the story waits in this tab; after signing up the visitor lands back on these invitations
        router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      setBusy(true);
      setError('');
      if (from) flyCard(from, item.image);
      try {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateId: item.id, fill: fills.current.get(item.id) ?? {} }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || 'לא הצלחנו לפתוח את ההזמנה');
        router.push(`/editor/${d.id}`);
      } catch (err) {
        landCard(null);
        setError((err as Error).message);
        setBusy(false);
      }
    },
    [me, router],
  );

  const lines = useMemo(() => story.card(answers), [story, answers]);
  const paper = (
    <div className={s.paper} data-folding={phase === 'folding'} aria-label="ההזמנה שלכם">
      {lines.map((l: CardLine, i) =>
        l.text || l.from === q?.key ? (
          <p
            key={l.from === 'date' ? `date-${l.text}` : i}
            className={s[`paper_${l.size}`]}
            data-active={phase === 'writing' && !!l.from && l.from === q?.key}
            data-stamp={l.from === 'date' && !!l.text}
          >
            {l.from === 'date' ? l.text : <Ink text={l.text} />}
            {phase === 'writing' && l.from === q?.key && <span className={s.quill} aria-hidden="true" />}
          </p>
        ) : null,
      )}
    </div>
  );

  if (phase === 'reveal') {
    return (
      <div className={s.story}>
        <div className={`${s.head} ${s.rise}`}>
          <span className={s.eyebrow}>{topic}</span>
          <h1 className={s.h2}>
            ההזמנות <span className={s.shine}>שלכם</span>
          </h1>
          <p>כל העיצובים כבר כתובים עם הפרטים שלכם. בחרו את זו שמדברת אליכם.</p>
        </div>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {ring === null ? (
          <p className={s.storyWait}>ההזמנות נכתבות…</p>
        ) : ring.length === 0 ? (
          <div className={s.emptyState}>
            <strong>עוד אין עיצובים לשמחה הזו</strong>
            <span>הפרטים שלכם שמורים. בינתיים אפשר להציץ בשמחות האחרות.</span>
            <Link className={`${s.btn} ${s.dark}`} href="/">
              לכל השמחות
            </Link>
          </div>
        ) : (
          <MirrorRing items={ring} label={`ההזמנות שלכם, ${topic}`} spinKey={topic} onOpen={open} openLabel={busy ? 'פותח…' : 'לפתוח את ההזמנה ←'} fit="contain" />
        )}
        <div className={s.storyActions}>
          <button
            type="button"
            className={s.back}
            onClick={() => {
              setStep(0);
              setPhase('writing');
            }}
          >
            ✎ לתקן את הפרטים
          </button>
          <button type="button" className={s.back} onClick={onSkip}>
            כל העיצובים בלי הפרטים
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={s.story}>
      <div className={`${s.head} ${s.rise}`}>
        <span className={s.eyebrow}>{topic}</span>
        <h1 className={s.h2}>
          {story.blessing.split('!')[0]}! <span className={s.shine}>{story.blessing.split('!').slice(1).join('!').trim()}</span>
        </h1>
        <p>ספרו לנו כמה פרטים, ונכתוב אותם על ההזמנה.</p>
      </div>

      <div className={`${s.storyStage} ${s.rise}`} style={{ animationDelay: '.15s' }}>
        {paper}
        {phase === 'writing' && q && (
          <form className={s.ask} onSubmit={next}>
            <label htmlFor="story-answer">{q.ask}</label>
            <input
              ref={inputRef}
              id="story-answer"
              className={s.askInput}
              type={q.kind ?? 'text'}
              value={value}
              placeholder={q.placeholder}
              maxLength={80}
              autoComplete="off"
              onChange={(e) => set(e.target.value)}
            />
            <div className={s.askRow}>
              {step > 0 && (
                <button type="button" className={s.back} onClick={() => setStep(step - 1)}>
                  → הקודם
                </button>
              )}
              {q.optional && (
                <button type="button" className={s.back} onClick={skip}>
                  לדלג
                </button>
              )}
              <button type="submit" className={`${s.btn} ${s.dark}`} disabled={!canGo}>
                {step < qs.length - 1 ? 'המשך ←' : 'לראות את ההזמנות ✦'}
              </button>
            </div>
            <div className={s.dots} aria-label={`שאלה ${step + 1} מתוך ${qs.length}`}>
              {qs.map((x, i) => (
                <span key={x.key} data-on={i <= step} />
              ))}
            </div>
          </form>
        )}
      </div>

      <button type="button" className={s.storySkip} onClick={onSkip}>
        או לראות את כל העיצובים בלי לכתוב
      </button>
    </div>
  );
}
