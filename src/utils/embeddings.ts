// Simple hash-based embedding for similarity search
// This is a lightweight alternative that doesn't require external models

export function generateEmbedding(text: string, dims: number = 384): number[] {
  const embedding = new Array(dims).fill(0);
  const normalized = text.toLowerCase();

  // Use multiple hash functions for better distribution
  for (let i = 0; i < normalized.length; i++) {
    const charCode = normalized.charCodeAt(i);

    // Primary hash
    const idx1 = (charCode * (i + 1)) % dims;
    embedding[idx1] += 1 / (i + 1);

    // Secondary hash for bigrams
    if (i > 0) {
      const prevCode = normalized.charCodeAt(i - 1);
      const idx2 = ((prevCode * 31) + charCode) % dims;
      embedding[idx2] += 0.5 / (i + 1);
    }

    // Tertiary hash for word boundaries
    if (normalized[i] === ' ' && i < normalized.length - 1) {
      const nextCode = normalized.charCodeAt(i + 1);
      const idx3 = (nextCode * 17 + i) % dims;
      embedding[idx3] += 0.3;
    }
  }

  // Normalize to unit vector
  const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < dims; i++) {
      embedding[i] /= magnitude;
    }
  }

  return embedding;
}

export function generateEmbeddings(texts: string[]): number[][] {
  return texts.map((t) => generateEmbedding(t));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

export function findSimilar(
  query: string,
  candidates: { id: string; text: string; embedding?: number[] }[],
  topK: number = 10
): { id: string; score: number }[] {
  const queryEmbedding = generateEmbedding(query);

  // Generate embeddings for candidates that don't have them
  for (const c of candidates) {
    if (!c.embedding) {
      c.embedding = generateEmbedding(c.text);
    }
  }

  // Calculate similarities
  const scored = candidates.map((c) => ({
    id: c.id,
    score: cosineSimilarity(queryEmbedding, c.embedding!),
  }));

  // Sort by score descending and return top K
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}
