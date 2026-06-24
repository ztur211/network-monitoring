/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Toolbar } from '../Toolbar';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';
import { createModelRender } from '../../ifc/model-render';
import type { MergedCategory } from '../../ifc/merge';

function cat(ifcType: string, count: number): MergedCategory {
  const position: number[] = [];
  const index: number[] = [];
  const ranges = Array.from({ length: count }, (_, e) => {
    const base = e * 3;
    position.push(base, 0, 0, base + 1, 0, 0, base, 1, 0);
    index.push(base, base + 1, base + 2);
    return { expressID: e + 1, indexStart: e * 3, indexCount: 3 };
  });
  return {
    ifcType,
    position: new Float32Array(position),
    normal: new Float32Array(position.length),
    color: new Float32Array(position.length).fill(1),
    index: new Uint32Array(index),
    ranges,
  };
}

function model() {
  const render = createModelRender([cat('IfcWall', 2)]);
  return {
    categories: new Map([...render.categories].map(([t, c]) => [t, c.mesh])),
    elementIndex: render.elementIndex,
    render,
  } as any;
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
