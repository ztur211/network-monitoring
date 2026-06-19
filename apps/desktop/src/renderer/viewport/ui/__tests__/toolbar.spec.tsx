/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Toolbar } from '../Toolbar';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';

function model() {
  const wall = new THREE.Group();
  wall.add(new THREE.Mesh(), new THREE.Mesh());
  return { categories: new Map([['IfcWall', wall]]) } as any;
}
beforeEach(() => useViewportStore.setState({ ...initialViewportState(), model: model() }));
afterEach(() => cleanup());

describe('Toolbar', () => {
  it('Fit requests a fit', () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByText('Fit'));
    expect(useViewportStore.getState().fitNonce).toBe(1);
  });
  it('Show all clears hidden state', () => {
    useViewportStore.setState({ isolated: 3 });
    render(<Toolbar />);
    fireEvent.click(screen.getByText('Show all'));
    expect(useViewportStore.getState().isolated).toBeNull();
  });
  it('toggles the section plane', () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByLabelText('Section'));
    expect(useViewportStore.getState().section.enabled).toBe(true);
  });
  it('lists categories with counts and toggles visibility', () => {
    render(<Toolbar />);
    expect(screen.getByText(/IfcWall \(2\)/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('toggle IfcWall'));
    expect(useViewportStore.getState().hiddenCategories.has('IfcWall')).toBe(true);
  });
});
