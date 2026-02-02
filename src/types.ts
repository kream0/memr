// Event Types - Raw, Immutable storage

export type EventType =
  | 'tool_call'
  | 'user_message'
  | 'assistant_message'
  | 'observation'
  | 'file_change'
  | 'error'
  | 'session_start'
  | 'session_end';

export interface EventPayload {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: string;
  message_role?: 'user' | 'assistant';
  message_content?: string;
  file_path?: string;
  change_type?: 'create' | 'edit' | 'delete';
  error_message?: string;
}

export interface EventContext {
  active_file?: string;
  recent_files?: string[];
  git_branch?: string;
  working_directory?: string;
}

export interface Event {
  id: string;
  type: EventType;
  session_id: string;
  timestamp: number;
  payload: EventPayload;
  context: EventContext;
  searchable_text: string;
  processed?: boolean;
}

// Belief Types - Derived, Mutable

export type BeliefDomain =
  | 'code_pattern'
  | 'user_preference'
  | 'project_structure'
  | 'workflow'
  | 'decision'
  | 'constraint';

export interface Belief {
  id: string;
  text: string;
  domain: BeliefDomain;
  confidence: number;
  evidence_ids: string[];
  supporting_count: number;
  contradicting_count: number;
  derived_at: number;
  last_evaluated: number;
  supersedes_id?: string;
  invalidated_at?: number;
  invalidation_reason?: string;
  embedding?: number[];
  importance: number;
  tags: string[];
}

// Prediction Types - Ephemeral

export interface PredictionItem {
  action: string;
  confidence: number;
  reasoning: string;
  supporting_beliefs: string[];
}

export interface PredictionOutcome {
  correct: boolean;
  actual_action?: string;
  evaluated_at: number;
}

export interface Prediction {
  id: string;
  generated_at: number;
  context_hash: string;
  predictions: PredictionItem[];
  outcome?: PredictionOutcome;
}

// Session Types

export interface Session {
  id: string;
  started_at: number;
  ended_at?: number;
  summary?: string;
  event_count: number;
}

// Reasoning Types

export type ContradictionLevel = 'SUPPORTS' | 'NEUTRAL' | 'WEAKLY_CONTRADICTS' | 'STRONGLY_CONTRADICTS';

export interface ContradictionResult {
  belief_id: string;
  level: ContradictionLevel;
  explanation?: string;
}

export interface InferenceResult {
  newBeliefs: Omit<Belief, 'id'>[];
  updates: { id: string; changes: Partial<Belief> }[];
  invalidations: { id: string; reason: string }[];
}

// Search/Query Types

export interface SearchOptions {
  limit?: number;
  minConfidence?: number;
  domain?: BeliefDomain;
  timeRange?: { start: number; end: number };
  activeOnly?: boolean;
}

export interface BeliefSearchResult {
  belief: Belief;
  score: number;
  matchType: 'semantic' | 'keyword' | 'hybrid';
}

export interface EventSearchResult {
  event: Event;
  score: number;
}

// Configuration

export interface Config {
  dataDir: string;
  anthropicApiKey?: string;
  embeddingModel: string;
  contradictionThreshold: number;
  confidenceDecayPerDay: number;
  minConfidenceFloor: number;
  consolidationEventThreshold: number;
  consolidationIntervalMinutes: number;
}

export const DEFAULT_CONFIG: Config = {
  dataDir: '.memorai',
  embeddingModel: 'bge-large-en-v1.5',
  contradictionThreshold: 3,
  confidenceDecayPerDay: 0.01,
  minConfidenceFloor: 0.3,
  consolidationEventThreshold: 50,
  consolidationIntervalMinutes: 30,
};
