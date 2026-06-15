/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

describe('App', () => {
  beforeEach(() => {
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.nodescope = {
      auth: {
        login: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn(),
        getToken: vi.fn().mockResolvedValue(null),
        onAuthChanged: vi.fn().mockReturnValue(() => {}),
      },
      app: { getConfig: vi.fn() },
    };
  });
  it('shows Sign in and calls auth.login on click', async () => {
    render(<App />);
    const btn = await screen.findByRole('button', { name: 'Sign in' });
    fireEvent.click(btn);
    expect((window as any).nodescope.auth.login).toHaveBeenCalled();
  });
  it('renders Signed in when a token exists', async () => {
    (window as any).nodescope.auth.getToken.mockResolvedValue('TKN');
    render(<App />);
    await waitFor(() => expect(screen.getByText('Signed in')).toBeTruthy());
  });
});
