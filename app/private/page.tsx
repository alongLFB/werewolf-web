import { redirect } from 'next/navigation';

import { createBrowserSupabaseClient } from '@/utils/supabase/server';

export default async function PrivatePage() {
  const supabase = await createBrowserSupabaseClient();

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    redirect('/login');
  }

  return <p>Hello {data.user.email}</p>;
}
