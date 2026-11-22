export interface SearchHit {
  id: number;
  score: number;
}

/** Brute-force cosine search over unit vectors. Fine for a catalogue of a few thousand products. */
export class VectorIndex {
  private readonly vectors = new Map<number, Float32Array>();

  get size(): number {
    return this.vectors.size;
  }

  ids(): number[] {
    return [...this.vectors.keys()];
  }

  has(id: number): boolean {
    return this.vectors.has(id);
  }

  set(id: number, vector: ArrayLike<number>): void {
    this.vectors.set(id, Float32Array.from(vector));
  }

  delete(id: number): void {
    this.vectors.delete(id);
  }

  get(id: number): Float32Array | undefined {
    return this.vectors.get(id);
  }

  search(query: ArrayLike<number>, k: number, minScore = 0): SearchHit[] {
    const hits: SearchHit[] = [];
    for (const [id, vec] of this.vectors) {
      if (vec.length !== query.length) continue;
      let dot = 0;
      for (let i = 0; i < vec.length; i++) dot += vec[i] * query[i];
      if (dot >= minScore) hits.push({ id, score: dot });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }
}
