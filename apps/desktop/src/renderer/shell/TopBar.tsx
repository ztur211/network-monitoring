import { useAuthStore } from '../stores/auth-store';

export function TopBar() {
  const org = useAuthStore((s) => s.org);
  return (
    <header>
      <span>NodeScope</span>
      <span>{org?.name ?? ''}</span>
      <button onClick={() => window.nodescope.auth.logout()}>Sign out</button>
    </header>
  );
}
