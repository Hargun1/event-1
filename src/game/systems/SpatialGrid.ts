/** Uniform bucket grid for fast neighbour queries. Rebuilt once per tick. */
export class SpatialGrid<T extends { x: number; y: number }> {
  private readonly cells: T[][];
  private readonly cols: number;
  private readonly rows: number;
  private readonly size: number;

  constructor(width: number, height: number, size: number) {
    this.size = size;
    this.cols = Math.ceil(width / size);
    this.rows = Math.ceil(height / size);
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
  }

  clear(): void {
    for (const c of this.cells) c.length = 0;
  }

  insert(item: T): void {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(item.x / this.size)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(item.y / this.size)));
    this.cells[cy * this.cols + cx].push(item);
  }

  /** Calls fn for items in buckets overlapping the circle (caller does exact distance test). */
  query(x: number, y: number, r: number, fn: (item: T) => void): void {
    const x0 = Math.max(0, Math.floor((x - r) / this.size)), x1 = Math.min(this.cols - 1, Math.floor((x + r) / this.size));
    const y0 = Math.max(0, Math.floor((y - r) / this.size)), y1 = Math.min(this.rows - 1, Math.floor((y + r) / this.size));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this.cells[cy * this.cols + cx];
        for (let i = 0; i < cell.length; i++) fn(cell[i]);
      }
    }
  }
}
