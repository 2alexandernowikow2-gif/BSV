export async function accountRequest<Result>(url: string, body?: unknown): Promise<Result> {
  const response = await fetch(url,{ method:body === undefined ? 'GET' : 'POST',credentials:'same-origin',cache:'no-store',
    headers:{ 'Content-Type':'application/json' },body:body === undefined ? undefined : JSON.stringify(body) });
  let data;
  try { data = await response.json(); } catch { throw new Error('Der Server hat keine gueltige Antwort geliefert.'); }
  if (!response.ok) throw new Error(data.error || 'Aktion fehlgeschlagen.');
  return data as Result;
}