/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ImportModelButton } from '../ImportModelButton';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';
import type { AccessSummaryDto } from '@nodescope/shared';

const uploadModelVersion = vi.fn();
const activateModelVersion = vi.fn();
vi.mock('../../../data/clients', () => ({
  getClients: () => ({ rest: { uploadModelVersion, activateModelVersion } }),
}));

const ownerAccess = { role: 'OWNER' } as AccessSummaryDto;
const memberAccess = { role: 'MEMBER' } as AccessSummaryDto;
// jsdom's File doesn't implement .arrayBuffer() reliably; a minimal File-like with the bytes the
// component reads is enough (it sets input.files to whatever we pass and reads files[0]).
const ifcFile = (name = 'house.ifc') => ({
  name,
  arrayBuffer: () => Promise.resolve(new TextEncoder().encode('ISO-10303-21;').buffer),
});

beforeEach(() => {
  useViewportStore.setState(initialViewportState());
  uploadModelVersion.mockReset().mockResolvedValue({ id: 'ver-1', versionNumber: 1 });
  activateModelVersion.mockReset().mockResolvedValue({});
});
afterEach(() => cleanup());

describe('ImportModelButton', () => {
  it('renders nothing for a non-OWNER/ADMIN member', () => {
    useViewportStore.setState({ access: memberAccess, activeBuildingPropertyId: 'b' });
    const { container } = render(<ImportModelButton />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when no building is active', () => {
    useViewportStore.setState({ access: ownerAccess, activeBuildingPropertyId: null });
    const { container } = render(<ImportModelButton />);
    expect(container.firstChild).toBeNull();
  });

  it('uploads + activates the picked file and bumps the reload nonce', async () => {
    useViewportStore.setState({ access: ownerAccess, activeBuildingPropertyId: 'b' });
    render(<ImportModelButton />);
    const input = screen.getByLabelText('Import IFC model file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [ifcFile('tower.ifc')] } });

    await waitFor(() => expect(activateModelVersion).toHaveBeenCalledWith('b', 'ver-1'));
    const [propertyId, fileName, body] = uploadModelVersion.mock.calls[0];
    expect(propertyId).toBe('b');
    expect(fileName).toBe('tower.ifc');
    expect(body.byteLength).toBeGreaterThan(0);
    expect(useViewportStore.getState().reloadNonce).toBe(1);
  });

  it('surfaces an error and does not reload when upload is rejected', async () => {
    useViewportStore.setState({ access: ownerAccess, activeBuildingPropertyId: 'b' });
    uploadModelVersion.mockRejectedValueOnce(new Error('forbidden'));
    render(<ImportModelButton />);
    fireEvent.change(screen.getByLabelText('Import IFC model file'), {
      target: { files: [ifcFile()] },
    });
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'forbidden');
    expect(useViewportStore.getState().reloadNonce).toBe(0);
  });
});
