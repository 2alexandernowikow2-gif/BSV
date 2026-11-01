import { redirect } from 'next/navigation';
import { currentAccount } from '@/lib/server';
import { listAccounts } from '@/lib/accounts-server';
import EmployeeAdministration from '@/components/EmployeeAdministration';

export const dynamic = 'force-dynamic';
export default async function EmployeePage() {
  const actor = await currentAccount();
  if (!actor || actor.role !== 'admin' || actor.account_status !== 'aktiv' || actor.archived_at) redirect('/?access=denied');
  const accounts = await listAccounts();
  return <EmployeeAdministration initialAccounts={accounts} actorId={actor.user_id!} />;
}