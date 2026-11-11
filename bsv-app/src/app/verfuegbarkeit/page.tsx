import { redirect } from 'next/navigation';
import { currentAccount } from '@/lib/server';
import Availability from '@/components/Availability';

export const dynamic = 'force-dynamic';
export default async function AvailabilityPage() {
  if (!await currentAccount()) redirect('/?access=denied');
  return <Availability />;
}