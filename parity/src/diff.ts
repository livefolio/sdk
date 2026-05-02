import type { AllocationHistory } from './extract-history';

export type DiffEntry = {
  readonly date: string;
  readonly assetId: string;
  readonly a: number;
  readonly b: number;
  readonly delta: number;
};

export type DiffReport = {
  readonly matched: number;
  readonly diffs: ReadonlyArray<DiffEntry>;
  readonly onlyInA: ReadonlyArray<string>;
  readonly onlyInB: ReadonlyArray<string>;
};

export interface DiffOptions {
  readonly weightTolerance?: number;
  readonly ignoreDates?: ReadonlySet<string>;
  readonly ignoreAssets?: ReadonlySet<string>;
}

/**
 * Outer-join two allocation histories on date. For shared dates, outer-join on
 * assetId. Cells with |b − a| > weightTolerance are reported as DiffEntry;
 * within-tolerance cells increment `matched`. Dates present in only one side
 * land in `onlyInA` / `onlyInB`.
 *
 * Pure: never throws, never mutates input.
 */
export function compareAllocationHistories(
  a: AllocationHistory,
  b: AllocationHistory,
  opts: DiffOptions = {},
): DiffReport {
  const tol = opts.weightTolerance ?? 1e-9;
  const ignoreDates = opts.ignoreDates ?? new Set<string>();
  const ignoreAssets = opts.ignoreAssets ?? new Set<string>();

  const aMap = new Map<string, Readonly<Record<string, number>>>();
  for (const d of a) if (!ignoreDates.has(d.date)) aMap.set(d.date, d.weights);
  const bMap = new Map<string, Readonly<Record<string, number>>>();
  for (const d of b) if (!ignoreDates.has(d.date)) bMap.set(d.date, d.weights);

  const onlyInA: string[] = [];
  const onlyInB: string[] = [];
  for (const date of aMap.keys()) if (!bMap.has(date)) onlyInA.push(date);
  for (const date of bMap.keys()) if (!aMap.has(date)) onlyInB.push(date);
  onlyInA.sort();
  onlyInB.sort();

  let matched = 0;
  const diffs: DiffEntry[] = [];
  const sharedDates = [...aMap.keys()].filter((d) => bMap.has(d)).sort();
  for (const date of sharedDates) {
    const aw = aMap.get(date)!;
    const bw = bMap.get(date)!;
    const assetIds = new Set<string>([...Object.keys(aw), ...Object.keys(bw)]);
    for (const id of [...assetIds].sort()) {
      if (ignoreAssets.has(id)) continue;
      const av = aw[id] ?? 0;
      const bv = bw[id] ?? 0;
      const delta = bv - av;
      if (Math.abs(delta) > tol) {
        diffs.push({ date, assetId: id, a: av, b: bv, delta });
      } else {
        matched++;
      }
    }
  }

  return { matched, diffs, onlyInA, onlyInB };
}
