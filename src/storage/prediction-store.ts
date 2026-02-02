import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { getDatabase } from './sqlite.js';
import type { Prediction, PredictionItem, PredictionOutcome } from '../types.js';

export class PredictionStore {
  private get db() {
    return getDatabase();
  }

  create(predictions: PredictionItem[], context: Record<string, unknown>): Prediction {
    const id = uuidv4();
    const contextHash = this.hashContext(context);

    const prediction: Prediction = {
      id,
      generated_at: Date.now(),
      context_hash: contextHash,
      predictions,
    };

    const stmt = this.db.prepare(`
      INSERT INTO predictions (id, generated_at, context_hash, predictions)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(id, prediction.generated_at, contextHash, JSON.stringify(predictions));

    return prediction;
  }

  getById(id: string): Prediction | null {
    const stmt = this.db.prepare('SELECT * FROM predictions WHERE id = ?');
    const row = stmt.get(id) as PredictionRow | null;

    if (!row) return null;
    return this.rowToPrediction(row);
  }

  getUnevaluated(limit: number = 50): Prediction[] {
    const stmt = this.db.prepare(`
      SELECT * FROM predictions
      WHERE outcome IS NULL
      ORDER BY generated_at ASC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as PredictionRow[];
    return rows.map((row) => this.rowToPrediction(row));
  }

  getRecent(limit: number = 20): Prediction[] {
    const stmt = this.db.prepare(`
      SELECT * FROM predictions
      ORDER BY generated_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as PredictionRow[];
    return rows.map((row) => this.rowToPrediction(row));
  }

  recordOutcome(id: string, outcome: PredictionOutcome): boolean {
    const stmt = this.db.prepare(`
      UPDATE predictions
      SET outcome = ?
      WHERE id = ?
    `);

    const result = stmt.run(JSON.stringify(outcome), id);
    return result.changes > 0;
  }

  getAccuracyStats(): { total: number; evaluated: number; correct: number; accuracy: number } {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN outcome IS NOT NULL THEN 1 ELSE 0 END) as evaluated,
        SUM(CASE WHEN json_extract(outcome, '$.correct') = true THEN 1 ELSE 0 END) as correct
      FROM predictions
    `);

    const result = stmt.get() as { total: number; evaluated: number; correct: number };

    return {
      total: result.total,
      evaluated: result.evaluated || 0,
      correct: result.correct || 0,
      accuracy: result.evaluated > 0 ? (result.correct || 0) / result.evaluated : 0,
    };
  }

  private hashContext(context: Record<string, unknown>): string {
    const str = JSON.stringify(context, Object.keys(context).sort());
    return createHash('sha256').update(str).digest('hex').slice(0, 16);
  }

  private rowToPrediction(row: PredictionRow): Prediction {
    return {
      id: row.id,
      generated_at: row.generated_at,
      context_hash: row.context_hash,
      predictions: JSON.parse(row.predictions),
      outcome: row.outcome ? JSON.parse(row.outcome) : undefined,
    };
  }
}

interface PredictionRow {
  id: string;
  generated_at: number;
  context_hash: string;
  predictions: string;
  outcome: string | null;
  created_at: number;
}

// Singleton instance
let predictionStore: PredictionStore | null = null;

export function getPredictionStore(): PredictionStore {
  if (!predictionStore) {
    predictionStore = new PredictionStore();
  }
  return predictionStore;
}

export function resetPredictionStore(): void {
  predictionStore = null;
}
