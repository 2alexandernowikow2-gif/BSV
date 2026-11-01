import { redirect } from 'next/navigation';
import { currentAccount } from '@/lib/server';
import OwnProfile from '@/components/OwnProfile';

export const dynamic = 'force-dynamic';
export default async function ProfilePage() {
  const account = await currentAccount();
  if (!account) redirect('/?access=denied');
  return <OwnProfile vorname={account.vorname} nachname={account.nachname} email={account.email ?? ''} admin={account.role === 'admin'} />;
}