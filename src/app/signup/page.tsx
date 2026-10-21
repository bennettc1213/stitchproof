import { AuthPage } from '@/components/auth-page';
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return <AuthPage kind="signup" next={(await searchParams).next} />;
}
