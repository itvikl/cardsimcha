'use client';

import { useEffect, useRef, useState } from 'react';
import { useToast } from './Toast';
import { SparkIcon, SendIcon } from './Icons';
import type { Audience } from '@/lib/categories';
import type { CanvasDoc, ImageAsset } from '@/lib/types';

type Turn = { role: 'user' | 'assistant'; text: string; changes?: number };

/** What the assistant shows while a request runs; advances on a timer, the last step holds. */
const WORDS = {
  private: {
    steps: ['קורא את הכרטיס', 'מנסח ובוחר צבעים', 'מעדכן את העיצוב'],
    sub: 'כתבו מה תרצו, והעוזר יעדכן את הכרטיס',
    busy: 'עובד על הכרטיס שלכם…',
    done: 'עדכנתי את הכרטיס.',
    one: 'שינוי אחד בוצע בכרטיס',
    many: (n: number) => `${n} שינויים בוצעו בכרטיס`,
  },
  business: {
    steps: ['קורא את המודעה', 'מחדד את המסר', 'מעדכן את המודעה'],
    sub: 'ספרו מה אתם רוצים לפרסם, והעוזר יכתוב את המודעה',
    busy: 'עובד על המודעה שלכם…',
    done: 'עדכנתי את המודעה.',
    one: 'שינוי אחד בוצע במודעה',
    many: (n: number) => `${n} שינויים בוצעו במודעה`,
  },
} satisfies Record<Audience, unknown>;

/** Chat with the AI assistant; each answer that changes the card arrives as one undoable edit. */
export function AgentPanel({
  projectId,
  getDoc,
  onApply,
  onBusyChange,
  placeholder,
  suggestions = [],
  intents = [],
  audience = 'private',
  onLibrary,
  onOpenSize,
}: {
  projectId: string;
  getDoc: () => CanvasDoc | null;
  /** Applies the new card and returns how many elements changed. */
  onApply: (doc: CanvasDoc) => number;
  onBusyChange?: (busy: boolean) => void;
  placeholder: string;
  suggestions?: string[];
  /** one-click requests that stay available through the conversation: the button's words, and what it asks of the assistant */
  intents?: { label: string; prompt: string }[];
  audience?: Audience;
  /** the library pictures the answer's card uses, so they draw */
  onLibrary?: (assets: ImageAsset[]) => void;
  /** the assistant asked for this ad in another size */
  onOpenSize?: (format: string) => void;
}) {
  const words = WORDS[audience];
  const STEPS = words.steps;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const { push } = useToast();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy, step]);

  useEffect(() => {
    onBusyChange?.(busy);
    if (!busy) return;
    setStep(0);
    const t = window.setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1700);
    return () => window.clearInterval(t);
  }, [busy, onBusyChange, STEPS.length]);

  const send = async (text = input, shown = text) => {
    const message = text.trim();
    const canvas = getDoc();
    if (!message || busy || !canvas) return;
    setBusy(true);
    setInput('');
    setTurns((t) => [...t, { role: 'user', text: shown.trim() }]);
    try {
      const res = await fetch(`/api/projects/${projectId}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, canvas, history: turns.map(({ role, text }) => ({ role, text })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'העוזר לא זמין כרגע');
      if (data.assets?.length) onLibrary?.(data.assets);
      const changes = data.changed ? onApply(data.canvas) : 0;
      setTurns((t) => [...t, { role: 'assistant', text: data.reply || (data.changed ? words.done : 'לא שיניתי דבר.'), changes }]);
      if (data.openSize) onOpenSize?.(data.openSize);
    } catch (e) {
      push((e as Error).message, 'error');
      setTurns((t) => t.slice(0, -1));
      if (shown === text) setInput(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={'agent' + (busy ? ' busy' : '')} aria-label="עוזר עיצוב">
      <header className="agent-head">
        <span className="agent-avatar">
          <SparkIcon />
        </span>
        <div className="agent-head-text">
          <h2 className="agent-title">
            עוזר עיצוב <span className="ai-badge">AI</span>
          </h2>
          <p className="agent-sub">{busy ? words.busy : words.sub}</p>
        </div>
        <span className={'agent-live' + (busy ? ' on' : '')} aria-hidden="true" />
      </header>
      {(turns.length > 0 || busy) && (
        <div className="agent-log" ref={listRef} aria-live="polite">
          {turns.map((t, i) => (
            <div key={i} className={'agent-turn ' + t.role}>
              <p className={'agent-msg ' + t.role} dir="auto">
                {t.text}
              </p>
              {!!t.changes && (
                <span className="agent-done">
                  <SparkIcon /> {t.changes === 1 ? words.one : words.many(t.changes)}
                </span>
              )}
            </div>
          ))}
          {busy && (
            <ol className="agent-steps" aria-label="העוזר עובד">
              {STEPS.map((s, i) => (
                <li key={s} className={i < step ? 'done' : i === step ? 'now' : ''}>
                  <span className="agent-step-dot" />
                  {s}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {turns.length === 0 && !busy && suggestions.length > 0 && (
        <div className="agent-chips" role="group" aria-label="רעיונות לבקשה">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => send(s)}>
              <SparkIcon />
              {s}
            </button>
          ))}
        </div>
      )}
      {intents.length > 0 && (
        <div className="agent-chips" role="group" aria-label="שינוי מהיר">
          {intents.map((i) => (
            <button key={i.label} type="button" disabled={busy} onClick={() => send(i.prompt, i.label)}>
              <SparkIcon />
              {i.label}
            </button>
          ))}
        </div>
      )}
      <div className="agent-compose">
        <textarea
          rows={2}
          dir="auto"
          maxLength={1000}
          value={input}
          placeholder={placeholder}
          aria-label="בקשה לעוזר"
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className={'agent-send' + (busy ? ' busy' : '')} onClick={() => send()} disabled={busy || !input.trim()} aria-label="שליחה" title="שליחה (Enter)">
          <SendIcon />
        </button>
      </div>
    </section>
  );
}
