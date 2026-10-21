'use client';

import { useEffect, useRef, useState } from 'react';
import { useToast } from './Toast';
import { SparkIcon, SendIcon } from './Icons';
import type { CanvasDoc } from '@/lib/types';

type Turn = { role: 'user' | 'assistant'; text: string; changes?: number };

/** What the assistant shows while a request runs; advances on a timer, the last step holds. */
const STEPS = ['קורא את הכרטיס', 'מנסח ובוחר צבעים', 'מעדכן את העיצוב'];

/** Chat with the AI assistant; each answer that changes the card arrives as one undoable edit. */
export function AgentPanel({
  projectId,
  getDoc,
  onApply,
  onBusyChange,
  placeholder,
  suggestions = [],
}: {
  projectId: string;
  getDoc: () => CanvasDoc | null;
  /** Applies the new card and returns how many elements changed. */
  onApply: (doc: CanvasDoc) => number;
  onBusyChange?: (busy: boolean) => void;
  placeholder: string;
  suggestions?: string[];
}) {
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
  }, [busy, onBusyChange]);

  const send = async (text = input) => {
    const message = text.trim();
    const canvas = getDoc();
    if (!message || busy || !canvas) return;
    setBusy(true);
    setInput('');
    setTurns((t) => [...t, { role: 'user', text: message }]);
    try {
      const res = await fetch(`/api/projects/${projectId}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, canvas, history: turns.map(({ role, text }) => ({ role, text })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'העוזר לא זמין כרגע');
      const changes = data.changed ? onApply(data.canvas) : 0;
      setTurns((t) => [...t, { role: 'assistant', text: data.reply || (data.changed ? 'עדכנתי את הכרטיס.' : 'לא שיניתי דבר.'), changes }]);
    } catch (e) {
      push((e as Error).message, 'error');
      setTurns((t) => t.slice(0, -1));
      setInput(message);
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
          <p className="agent-sub">{busy ? 'עובד על הכרטיס שלכם…' : 'כתבו מה תרצו, והעוזר יעדכן את הכרטיס'}</p>
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
                  <SparkIcon /> {t.changes === 1 ? 'שינוי אחד בוצע בכרטיס' : `${t.changes} שינויים בוצעו בכרטיס`}
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
