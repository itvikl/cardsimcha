'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { Audience } from '@/lib/categories';

const LABELS: Record<Audience, string> = { private: 'לשמחות', business: 'לעסקים' };
const STORAGE_KEY = 'admin-door';

/** the admin's last door, remembered per browser; starts on the private side */
export function useAdminDoor(): [Audience, (a: Audience) => void] {
  const [door, setDoor] = useState<Audience>('private');
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === 'business') setDoor('business');
    } catch {}
  }, []);
  const choose = (a: Audience) => {
    setDoor(a);
    try {
      localStorage.setItem(STORAGE_KEY, a);
    } catch {}
  };
  return [door, choose];
}

/** the two-door switch for admin pages; the door icon turns half a circle on every switch */
export function RevolvingDoor({ value, onChange }: { value: Audience; onChange: (a: Audience) => void }) {
  return (
    <div className="revolving" role="group" aria-label="בשביל מי">
      <button type="button" data-door="private" aria-pressed={value === 'private'} onClick={() => onChange('private')}>
        {LABELS.private}
      </button>
      <svg className="revolving-icon" style={{ rotate: value === 'business' ? '180deg' : '0deg' }} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2v20M4.9 7.5 19.1 16.5M4.9 16.5 19.1 7.5" />
      </svg>
      <button type="button" data-door="business" aria-pressed={value === 'business'} onClick={() => onChange('business')}>
        {LABELS.business}
      </button>
    </div>
  );
}

/** wrap the content behind the door: it swings in around its middle each time the door turns */
export function DoorTurn({ door, children }: { door: Audience; children: ReactNode }) {
  return (
    <div key={door} className="door-turn" data-door={door}>
      {children}
    </div>
  );
}
