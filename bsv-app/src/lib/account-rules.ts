import { z } from 'zod';

export const accountRole = z.enum(['admin', 'mitarbeiter']);
export const accountStatus = z.enum(['eingeladen', 'aktiv', 'deaktiviert']);
export const employeeInput = z.object({
  vorname: z.string().trim().min(1).max(60),
  nachname: z.string().trim().max(60),
  email: z.email().max(254).transform(value => value.toLowerCase()),
  role: accountRole.default('mitarbeiter'),
  winterActive: z.boolean().default(true),
  summerActive: z.boolean().default(false),
  qualifications: z.array(z.string().trim().min(1).max(80)).max(64).default([])
}).strict();
export type EmployeeInput = z.infer<typeof employeeInput>;
export type Account = {
  id: string; user_id: string | null; name: string; vorname: string; nachname: string;
  email: string | null; role: z.infer<typeof accountRole>; account_status: z.infer<typeof accountStatus>;
  winter_active: boolean; summer_active: boolean; qualifications: string[];
  archived_at: string | null; created_at: string; updated_at: string;
};

export class AccountError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function requireActiveAdmin(actor: Pick<Account, 'role' | 'account_status' | 'archived_at'> | null) {
  if (!actor || actor.role !== 'admin' || actor.account_status !== 'aktiv' || actor.archived_at) {
    throw new AccountError('Nur aktive Administratoren duerfen diese Aktion ausfuehren.', 403);
  }
}

export function protectAccount(actorId: string, target: Account, operation: 'edit' | 'deactivate' | 'delete', nextRole: string, activeAdmins: number) {
  if (target.user_id === actorId && operation !== 'edit') throw new AccountError('Du kannst deinen eigenen Zugang nicht deaktivieren oder loeschen.', 403);
  const removesAdmin = operation !== 'edit' || nextRole !== 'admin';
  if (target.role === 'admin' && target.account_status === 'aktiv' && !target.archived_at && removesAdmin && activeAdmins <= 1) {
    throw new AccountError('Der letzte aktive Admin muss erhalten bleiben.', 409);
  }
}

export type BootstrapClaim = { claimed: boolean; userId: string | null; reason: string };
export async function bootstrapOnce(steps: {
  claim: () => Promise<BootstrapClaim>;
  deliver: (claim: BootstrapClaim) => Promise<void>;
  finish: (status: 'sent' | 'failed') => Promise<void>;
}) {
  const claim = await steps.claim();
  if (!claim.claimed) return { sent: false, reason: claim.reason };
  try {
    await steps.deliver(claim);
    await steps.finish('sent');
    return { sent: true, reason: 'Einrichtungsmail angefordert.' };
  } catch {
    await steps.finish('failed');
    throw new AccountError('Ersteinrichtung fehlgeschlagen. Kein automatischer Neuversand; bitte die Einrichtungshinweise pruefen.', 503);
  }
}