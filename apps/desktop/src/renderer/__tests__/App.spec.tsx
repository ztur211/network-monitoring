/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import App from '../App';
import { useAuthStore } from '../stores/auth-store';

// The Shell calls useBootstrap() on mount; stub it so mounting the authed route does no real I/O.
vi.mock('../data/use-bootstrap', () => ({ useBootstrap: () => {} }));

function stubBridge(token: string | null) {
  (window as any).nodescope = {
    auth: {
      login: vi.fn(),
      logout: vi.fn(),
      getToken: vi.fn().mockResolvedValue(token),
      onAuthChanged: vi.fn().mockReturnValue(() => {}),
    },
    app: { getConfig: vi.fn().mockResolvedValue({ apiUrl: 'http://api' }) },
  };
}

beforeEach(() => {
  useAuthStore.setState({ authed: false, org: null });
  window.location.hash = '';
});
afterEach(() => cleanup());

describe('App routing', () => {
  it('shows the Login (Sign in) when unauthenticated and calls login() on click', async () => {
    stubBridge(null);
    render(<App />);
    const btn = await screen.findByRole('button', { name: 'Sign in' });
    fireEvent.click(btn);
    expect((window as any).nodescope.auth.login).toHaveBeenCalled();
  });

  it('renders the Shell (Sign out + viewport) when a token exists', async () => {
    stubBridge('TKN');
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(screen.getByText('Select a building')).toBeTruthy();
  });
});
