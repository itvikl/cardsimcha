'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TreeNode } from '@/lib/data/tree';
import s from './TreeBrowse.module.css';

/**
 * Walking the occasion tree on an admin page: category tiles, then a step at a time down to a
 * type. The templates page and the image library both show their items this way.
 */

/** the spot of the items no category holds */
export const UNFILED = 'unfiled';
const TOP_ID = 'by-tree';

/** where the admin stands: a node id, UNFILED, or null. In the address's hash, so "back" walks back up */
export function useTreeSpot(): [string | null, (id: string | null) => void] {
  const [at, setAt] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setAt(decodeURIComponent(window.location.hash.slice(1)) || null);
    read();
    window.addEventListener('hashchange', read);
    window.addEventListener('popstate', read);
    return () => {
      window.removeEventListener('hashchange', read);
      window.removeEventListener('popstate', read);
    };
  }, []);
  const go = useCallback((id: string | null) => {
    if (id) window.location.hash = id;
    else if (window.location.hash) history.pushState(null, '', window.location.pathname + window.location.search);
    setAt(id);
    document.getElementById(TOP_ID)?.scrollIntoView({ block: 'start' });
  }, []);
  return [at, go];
}

export function useTreeIndex(nodes: TreeNode[]) {
  return useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    /** the node and those above it, from the category down */
    const lineOf = (id: string) => {
      const line: TreeNode[] = [];
      for (let n = byId.get(id); n; n = n.parentId ? byId.get(n.parentId) : undefined) line.unshift(n);
      return line;
    };
    const childrenOf = (id: string | null) =>
      nodes.filter((n) => n.parentId === id && (id !== null || n.level === 'category')).sort((a, b) => a.position - b.position);
    /** whether a place is on the tree proper (a topic from before the tree is not) */
    const onTree = (id: string) => lineOf(id)[0]?.level === 'category';
    /** for each node, the items filed on it or anywhere under it */
    const holdings = <T,>(items: T[], placesOf: (item: T) => string[]) => {
      const holds = new Map<string, T[]>();
      for (const item of items) {
        const seen = new Set<string>();
        for (const place of placesOf(item))
          for (let n = byId.get(place); n && !seen.has(n.id); n = n.parentId ? byId.get(n.parentId) : undefined) {
            seen.add(n.id);
            holds.set(n.id, [...(holds.get(n.id) ?? []), item]);
          }
      }
      return holds;
    };
    return { byId, lineOf, childrenOf, onTree, holdings };
  }, [nodes]);
}

/** where a step through the tree scrolls to */
export const TreeTop = () => <div id={TOP_ID} className={s.top} />;

/** a category: a peek at what it holds, and how much */
export function TreeTile({
  name,
  detail,
  thumbs,
  warn,
  onOpen,
}: {
  name: string;
  detail: string;
  thumbs: string[];
  warn?: boolean;
  onOpen: () => void;
}) {
  return (
    <button type="button" className={s.tile + (warn ? ' ' + s.warn : '')} onClick={onOpen}>
      {thumbs.length ? (
        <span className={s.thumbs} aria-hidden>
          {thumbs.slice(0, 4).map((url) => (
            <span key={url} style={{ backgroundImage: `url("${url}")` }} />
          ))}
        </span>
      ) : (
        <span className={`${s.thumbs} ${s.none}`}>עוד ריק</span>
      )}
      <strong>{name}</strong>
      <span className="status">{detail}</span>
    </button>
  );
}

export const TreeTiles = ({ children }: { children: React.ReactNode }) => <div className={s.tiles}>{children}</div>;

/** the way back up: "כל הקטגוריות › שמחות › הולדת בן" */
export function TreeCrumbs({ above, onGo }: { above: TreeNode[]; onGo: (id: string | null) => void }) {
  return (
    <nav className={s.crumbs} aria-label="איפה אני בעץ">
      <button type="button" onClick={() => onGo(null)}>
        כל הקטגוריות
      </button>
      {above.map((n) => (
        <span key={n.id}>
          <span aria-hidden>›</span>
          <button type="button" onClick={() => onGo(n.id)}>
            {n.name}
          </button>
        </span>
      ))}
    </nav>
  );
}

export function TreeHeading({ title, detail, action }: { title: string; detail?: string; action?: React.ReactNode }) {
  return (
    <div className={s.heading}>
      <h2>{title}</h2>
      {detail && <span className="status">{detail}</span>}
      {action && <span className={s.headingAction}>{action}</span>}
    </div>
  );
}

/** the steps further down, each with how much it holds */
export function TreeKids({ kids, count, onGo }: { kids: TreeNode[]; count: (id: string) => number; onGo: (id: string) => void }) {
  if (!kids.length) return null;
  return (
    <div className={s.kids}>
      {kids.map((k) => (
        <button type="button" key={k.id} className={s.kid + (count(k.id) ? '' : ' ' + s.zero)} onClick={() => onGo(k.id)}>
          {k.name} <span>{count(k.id)}</span>
        </button>
      ))}
    </div>
  );
}
