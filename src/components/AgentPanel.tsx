'use client';

import { useEffect, useRef, useState } from 'react';
import { useToast } from './Toast';
import type { CanvasDoc } from '@/lib/types';

type Turn = { role: 'user' | 'assistant'; text: string };

/** Chat with the AI assistant; each answer that changes the card arrives as one undoable edit. */
export function AgentPanel({
  projectId,
  getDoc,
  onApply,
  placeholder,
}: {
  projectId: string;
  getDoc: () => CanvasDoc | null;
  onApply: (doc: CanvasDoc) => void;
  placeholder: string;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const { push } = useToast();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns, busy]);

  const send = async () => {
    const message = input.trim();
    const canvas = getDoc();
    if (!message || busy || !canvas) return;
    setBusy(true);
    setInput('');
    setTurns((t) => [...t, { role: 'user', text: message }]);
    try {
      const res = await fetch(`/api/projects/${projectId}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, canvas, history: turns }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'העוזר לא זמין כרגע');
      if (data.changed) onApply(data.canvas);
      setTurns((t) => [...t, { role: 'assistant', text: data.reply || (data.changed ? 'עדכנתי את הכרטיס.' : 'לא שיניתי דבר.') }]);
    } catch (e) {
      push((e as Error).message, 'error');
      setTurns((t) => t.slice(0, -1));
      setInput(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="agent" aria-label="עוזר עיצוב">
      <h2 className="panel-title">עוזר עיצוב</h2>
      {turns.length > 0 && (
        <div className="agent-log" ref={listRef} aria-live="polite">
          {turns.map((t, i) => (
            <p key={i} className={'agent-msg ' + t.role} dir="auto">
              {t.text}
            </p>
          ))}
          {busy && <p className="agent-msg assistant status">העוזר עובד…</p>}
        </div>
      )}
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
      <button className="btn small primary" onClick={send} disabled={busy || !input.trim()}>
        {busy ? 'עובד…' : 'שליחה'}
      </button>
    </section>
  );
}
