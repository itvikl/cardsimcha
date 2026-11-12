type Point = [number, number];

/** solves A·x = b in place (Gaussian elimination with partial pivoting); A is n×n */
function solve(A: number[][], b: number[]) {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    for (let r = col + 1; r < n; r++) {
      const k = A[r][col] / A[col][col];
      for (let c = col; c < n; c++) A[r][c] -= k * A[col][c];
      b[r] -= k * b[col];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r];
    for (let c = r + 1; c < n; c++) sum -= A[r][c] * x[c];
    x[r] = sum / A[r][r];
  }
  return x;
}

/**
 * The CSS matrix3d that lays a w×h box (transform-origin 0 0) onto a quadrilateral, as a flat thing lying in a photograph:
 * `to` is the box's top-left, top-right, bottom-right and bottom-left corners where they land, in px.
 */
export function quadTransform(w: number, h: number, to: [Point, Point, Point, Point]) {
  const from: Point[] = [[0, 0], [w, 0], [w, h], [0, h]];
  const A: number[][] = [];
  const b: number[] = [];
  from.forEach(([x, y], i) => {
    const [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  });
  const [a, bb, c, d, e, f, g, hh] = solve(A, b);
  return `matrix3d(${[a, d, 0, g, bb, e, 0, hh, 0, 0, 1, 0, c, f, 0, 1].join(',')})`;
}
