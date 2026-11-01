import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { bootstrapAdmin } from '@/lib/accounts-server';
import { AccountError } from '@/lib/account-rules';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export async function POST(request: Request) {
  const secret = process.env.BOOTSTRAP_SECRET;
  const supplied = request.headers.get('x-bootstrap-secret') ?? '';
  if (!secret || secret.length < 32 || !timingSafeEqual(createHash('sha256').update(supplied).digest(),createHash('sha256').update(secret).digest())) {
    return NextResponse.json({ error:'Nicht autorisiert.' },{ status:401 });
  }
  if (process.env.VERCEL_ENV !== 'production') return NextResponse.json({ error:'Ersteinrichtung nur in Production erlaubt.' },{ status:403 });
  try { return NextResponse.json(await bootstrapAdmin()); }
  catch (error) { return NextResponse.json({ error:error instanceof AccountError ? error.message : 'Ersteinrichtung nicht verfuegbar. Konfiguration und Migration pruefen.' },{ status:503 }); }
}