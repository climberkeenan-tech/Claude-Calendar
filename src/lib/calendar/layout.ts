/**
 * Overlap layout for day/week time grids — pure and unit-tested.
 *
 * Given items with start/end minutes, assign each a column and column count so
 * overlapping items render side by side, filling the full width otherwise.
 */

export type LayoutInput = {
  id: string;
  startMin: number; // minutes from day start
  endMin: number;
};

export type LayoutBox = LayoutInput & {
  col: number;
  cols: number;
};

export function layoutDay(items: LayoutInput[]): LayoutBox[] {
  const sorted = [...items].sort(
    (a, b) => a.startMin - b.startMin || b.endMin - a.endMin,
  );
  const boxes: LayoutBox[] = [];
  // A "cluster" is a maximal set of transitively-overlapping items; column
  // count is per-cluster.
  let cluster: LayoutBox[] = [];
  let clusterEnd = -1;
  const colEnds: number[] = []; // per-column current end within the cluster

  const flush = () => {
    const cols = colEnds.length;
    for (const b of cluster) b.cols = cols;
    cluster = [];
    colEnds.length = 0;
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.startMin >= clusterEnd) flush();
    // First free column, else a new one.
    let col = colEnds.findIndex((end) => end <= item.startMin);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(0);
    }
    colEnds[col] = item.endMin;
    const box: LayoutBox = { ...item, col, cols: 1 };
    cluster.push(box);
    boxes.push(box);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  flush();
  return boxes;
}
