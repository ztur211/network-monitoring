/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Settings } from '../Settings';

beforeEach(() => {
  (window as any).nodescope = {
    app: {
      getConfig: vi.fn().mockResolvedValue({ apiUrl: 'http://current' }),
      setApiUrl: vi.fn().mockResolvedValue(undefined),
    },
    auth: { login: vi.fn(), logout: vi.fn(), getToken: vi.fn(), onAuthChanged: vi.fn() },
  };
});
afterEach(() => cleanup());

describe('Settings', () => {
  it('loads the current API URL and saves an edited value through the bridge', async () => {
    render(<Settings />);
    const input = (await screen.findByLabelText('API URL')) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('http://current'));
    fireEvent.change(input, { target: { value: 'http://new:3000/api' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((window as any).nodescope.app.setApiUrl).toHaveBeenCalledWith('http://new:3000/api');
  });
});
