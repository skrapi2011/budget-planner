// Loading placeholders — rescued from `feature/darkmode` (tip 293b579), where they were
// written against the pre-audit layout. The surfaces here follow the current reference
// surfaces (AGENTS.md §7.3: light `bg-white / border-gray-100`, dark `dark:bg-slate-800 /
// dark:border-slate-700`); the shimmer itself lives in `index.css` as `.skeleton`, next to
// the other animation utilities and neutralised under `prefers-reduced-motion`.
//
// The shimmer bars are decoration, so the block that holds them is `aria-hidden`, and every
// skeleton announces itself once to assistive tech with a Polish `sr-only` label.

function SrLoading({ label = 'Ładowanie danych' }) {
  return (
    <span className="sr-only" role="status" aria-live="polite">
      {label}
    </span>
  );
}

// Exported so pages can compose page-specific plates (e.g. the Budgets month-nav row)
// from the same tokens; Skeleton.test.jsx pins the light + dark variants.
export const SKELETON_SURFACE =
  'bg-white dark:bg-slate-800 shadow-sm border border-gray-100 dark:border-slate-700';

/** Card with an icon + two lines + a figure — the generic content card shape. */
export function CardSkeleton() {
  return (
    <div className={`${SKELETON_SURFACE} rounded-xl p-5`}>
      <SrLoading />
      <div aria-hidden="true">
        <div className="flex items-center gap-3 mb-4">
          <div className="skeleton w-10 h-10 rounded-lg" />
          <div className="space-y-2 flex-1">
            <div className="skeleton h-4 w-3/4" />
            <div className="skeleton h-3 w-1/2" />
          </div>
        </div>
        <div className="skeleton h-8 w-1/3" />
      </div>
    </div>
  );
}

/** Stat-tile shape (icon + label + big number) — pairs with the `stagger-children` grids. */
export function StatCardSkeleton() {
  return (
    <div className={`${SKELETON_SURFACE} rounded-xl p-5`}>
      <SrLoading />
      <div aria-hidden="true">
        <div className="flex items-center gap-3 mb-3">
          <div className="skeleton w-10 h-10 rounded-lg" />
          <div className="skeleton h-4 w-2/3" />
        </div>
        <div className="skeleton h-8 w-1/2" />
      </div>
    </div>
  );
}

/** Compact tile (label + figure, no icon) — the ExpensesView monthly-summary strip. */
export function StatTileSkeleton() {
  return (
    <div className={`${SKELETON_SURFACE} rounded-lg px-4 py-3`}>
      <SrLoading />
      <div aria-hidden="true">
        <div className="skeleton h-3 w-20 mb-2" />
        <div className="skeleton h-6 w-24" />
      </div>
    </div>
  );
}

/** `count` placeholders laid out in a grid — the stat-card / card-grid shapes. */
export function SkeletonGrid({ count = 4, cols = 'lg:grid-cols-4', children }) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 ${cols} gap-6`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i}>{children}</div>
      ))}
    </div>
  );
}

/** `count` list rows, each: avatar + two lines + a trailing figure. */
export function ListSkeleton({ count = 5, className = '' }) {
  return (
    <div className={`space-y-3 ${className}`}>
      <SrLoading />
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={`${SKELETON_SURFACE} rounded-lg p-4 flex items-center justify-between`}
        >
          <div className="flex items-center gap-3 flex-1">
            <div className="skeleton w-8 h-8 rounded-full shrink-0" />
            <div className="space-y-2 flex-1 min-w-0">
              <div className="skeleton h-4 w-3/4" />
              <div className="skeleton h-3 w-1/2" />
            </div>
          </div>
          <div className="skeleton h-4 w-16 ml-4" />
        </div>
      ))}
    </div>
  );
}

/** Title line + a chart-sized plate (matches the recharts blocks on Dashboard / YearOverview). */
export function ChartSkeleton() {
  return (
    <div className={`${SKELETON_SURFACE} rounded-xl p-5`}>
      <SrLoading label="Ładowanie wykresu" />
      <div aria-hidden="true">
        <div className="skeleton h-5 w-48 mb-4" />
        <div className="skeleton h-64 w-full rounded-lg" />
      </div>
    </div>
  );
}

/** Header row + `rows` × `cols` cells — the transactions/categories table shape. */
export function TableSkeleton({ rows = 6, cols = 4 }) {
  return (
    <div className={`${SKELETON_SURFACE} rounded-xl overflow-hidden`}>
      <SrLoading label="Ładowanie listy" />
      <div aria-hidden="true">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
          <div className="skeleton h-4 w-32" />
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex gap-4"
          >
            {Array.from({ length: cols }).map((_, c) => (
              <div key={c} className="skeleton flex-1 h-4" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
