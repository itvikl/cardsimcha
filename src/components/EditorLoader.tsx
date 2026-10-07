'use client';

import dynamic from 'next/dynamic';

// react-konva needs the browser canvas, so the editor is never rendered on the server.
const Editor = dynamic(() => import('./Editor'), {
  ssr: false,
  loading: () => (
    <p className="status" style={{ padding: 24 }}>
      טוען את העורך…
    </p>
  ),
});

export function EditorLoader({ id }: { id: string }) {
  return <Editor id={id} />;
}
