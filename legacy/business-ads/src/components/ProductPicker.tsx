'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MAX_PRODUCTS } from '@/lib/products';
import type { CatalogItem } from '@/lib/types';

/** Which of the catalog's items are on this ad, in the order chosen. */
export function ProductPicker({ chosen, onChange }: { chosen: string[]; onChange: (items: CatalogItem[]) => void }) {
  const [items, setItems] = useState<CatalogItem[] | null>(null);

  useEffect(() => {
    fetch('/api/catalog')
      .then((r) => (r.ok ? r.json() : []))
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  const toggle = (id: string) => {
    const next = chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id];
    onChange(next.flatMap((c) => items?.find((i) => i.id === c) ?? []));
  };

  return (
    <div className="field field-card" style={{ order: -1 }}>
      <span className="field-label">המוצרים במודעה</span>
      {items === null ? (
        <span className="status">טוען…</span>
      ) : items.length === 0 ? (
        <span className="status">
          עוד אין מוצרים בקטלוג. <Link href="/business/catalog" target="_blank" style={{ textDecoration: 'underline' }}>מוסיפים שם תמונה, שם ומחיר</Link>, וחוזרים לכאן.
        </span>
      ) : (
        <>
          <div className="product-list">
            {items.map((i) => (
              <label key={i.id} className="product-row">
                <input type="checkbox" checked={chosen.includes(i.id)} disabled={!chosen.includes(i.id) && chosen.length >= MAX_PRODUCTS} onChange={() => toggle(i.id)} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {i.photo && <img src={`/api/uploads/${i.photo.file}`} alt="" />}
                <span>{i.name}</span>
                {i.price && <small>{i.price}</small>}
              </label>
            ))}
          </div>
          <span className="status">
            עד {MAX_PRODUCTS} מוצרים. שם ומחיר שמשנים כאן נשארים רק במודעה הזו. <Link href="/business/catalog" target="_blank" style={{ textDecoration: 'underline' }}>לעריכת הקטלוג</Link>
          </span>
        </>
      )}
    </div>
  );
}
