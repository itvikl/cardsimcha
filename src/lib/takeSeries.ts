/**
 * Copies a whole series into the customer's basket. Each copy starts without a preview, so the pictures the page
 * already drew (template id -> data URL) become their previews; one that fails just waits for the editor to make it.
 */
export async function takeSeries(body: Record<string, unknown>, previews: Record<string, string | null | undefined>) {
  const res = await fetch('/api/projects/series', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'לא הצלחנו ליצור את הסדרה');
  await Promise.allSettled(
    (d.designs as { id: string; templateId: string }[]).flatMap(({ id, templateId }) => {
      const thumbnail = previews[templateId];
      if (!thumbnail?.startsWith('data:')) return [];
      return [fetch(`/api/projects/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thumbnail }) })];
    }),
  );
}
