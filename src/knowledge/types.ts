import type { CompatStatus, OhpmSuggestion, RiskLevel } from '../types';

export type ApiKind = 'node' | 'browser' | 'native' | 'runtime';

export interface ApiMatrixEntry {
  api: string;
  module?: string;
  kind: ApiKind;
  status: CompatStatus;
  harmonyVersion: string;
  replacement?: string;
  risk: RiskLevel;
  notes?: string;
}

export interface ApiMatrixFile {
  schemaVersion: string;
  harmonyVersion: string;
  updatedAt: string;
  entries: ApiMatrixEntry[];
}

export interface ReplacementEntry {
  ohpm: string | null;
  status: OhpmSuggestion['status'];
  risk: RiskLevel;
  category?: string;
  notes?: string;
  updatedAt?: string;
  source?: string;
}

export interface ReplacementFile {
  schemaVersion: string;
  updatedAt: string;
  replacements: Record<string, ReplacementEntry>;
}

export interface KnowledgeData {
  matrix: ApiMatrixFile;
  replacements: ReplacementFile;
}
