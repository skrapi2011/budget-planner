import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  CardSkeleton,
  StatCardSkeleton,
  StatTileSkeleton,
  SkeletonGrid,
  ListSkeleton,
  ChartSkeleton,
  TableSkeleton,
} from './Skeleton';

// These components were written on `feature/darkmode` and never merged. The tests pin
// the two things that made them worth rescuing: they match the current surface tokens in
// both themes (§7.3), and the shimmer blocks are decoration with a single Polish a11y label
// — so a screen reader does not read a wall of empty divs while a page loads.

const ALL = {
  CardSkeleton,
  StatCardSkeleton,
  StatTileSkeleton,
  ListSkeleton,
  ChartSkeleton,
  TableSkeleton,
};

describe('Skeleton placeholders', () => {
  it('every skeleton announces itself once, in Polish', () => {
    for (const [name, Component] of Object.entries(ALL)) {
      // unmount between iterations: all these renders share document.body
      const { getByRole, unmount } = render(<Component />);
      const status = getByRole('status');
      expect(status.textContent, name).toMatch(/Ładowanie/);
      unmount();
    }
  });

  it('every shimmer block is hidden from assistive tech', () => {
    for (const [name, Component] of Object.entries(ALL)) {
      const { container } = render(<Component />);
      const bars = container.querySelectorAll('.skeleton');
      expect(bars.length, name).toBeGreaterThan(0);
      for (const bar of bars) {
        expect(bar.closest('[aria-hidden="true"]'), `${name} bar`).not.toBeNull();
      }
    }
  });

  it('every surface carries a light and a dark variant (§7.3)', () => {
    for (const [name, Component] of Object.entries(ALL)) {
      const { container, unmount } = render(<Component />);
      // ListSkeleton is a stack; its ROWS carry the surface, not the wrapper
      const surface = name === 'ListSkeleton'
        ? container.firstElementChild.children[1]
        : container.firstElementChild;
      expect(surface.className, name).toContain('bg-white');
      expect(surface.className, name).toContain('dark:bg-slate-800');
      expect(surface.className, name).toContain('border-gray-100');
      expect(surface.className, name).toContain('dark:border-slate-700');
      unmount();
    }
  });

  it('ListSkeleton renders `count` rows and defaults to five', () => {
    const { container } = render(<ListSkeleton />);
    // The avatar of each row is the only round shimmer bar.
    expect(container.querySelectorAll('.skeleton.rounded-full')).toHaveLength(5);

    const three = render(<ListSkeleton count={3} />);
    expect(three.container.querySelectorAll('.skeleton.rounded-full')).toHaveLength(3);

    const zero = render(<ListSkeleton count={0} />);
    expect(zero.container.querySelectorAll('.skeleton.rounded-full')).toHaveLength(0);
  });

  it('ListSkeleton takes a layout className (grid placement on Tags)', () => {
    const { container } = render(<ListSkeleton className="lg:col-span-1" />);
    expect(container.firstElementChild.className).toContain('space-y-3');
    expect(container.firstElementChild.className).toContain('lg:col-span-1');
  });

  it('SkeletonGrid repeats its children `count` times in a responsive grid', () => {
    const { container } = render(
      <SkeletonGrid count={3} cols="md:grid-cols-3">
        <StatTileSkeleton />
      </SkeletonGrid>,
    );
    const grid = container.firstElementChild;
    expect(grid.className).toContain('grid');
    expect(grid.className).toContain('md:grid-cols-3');
    expect(grid.children).toHaveLength(3);
    // Each slot holds one full tile placeholder with its own surface.
    expect(grid.querySelectorAll('.skeleton.h-6')).toHaveLength(3);
  });

  it('TableSkeleton renders rows × cols cells under one header plate', () => {
    const { container } = render(<TableSkeleton rows={3} cols={2} />);
    expect(container.querySelectorAll('.skeleton.flex-1')).toHaveLength(6);
    // 3 × 2 cells + the single header bar.
    expect(container.querySelectorAll('.skeleton')).toHaveLength(7);

    const big = render(<TableSkeleton rows={2} cols={5} />);
    expect(big.container.querySelectorAll('.skeleton.flex-1')).toHaveLength(10);
  });

  it('ChartSkeleton reserves a chart-sized plate', () => {
    const { container, getByRole } = render(<ChartSkeleton />);
    expect(container.querySelector('.skeleton.h-64')).toBeInTheDocument();
    expect(getByRole('status')).toHaveTextContent('Ładowanie wykresu');
  });
});
