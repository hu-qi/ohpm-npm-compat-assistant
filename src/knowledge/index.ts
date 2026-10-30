import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiMatrixFile, KnowledgeData, ReplacementFile } from './types';

export const DEFAULT_DATA_DIR = join(__dirname, 'data');

function readJson<T>(file: string, label: string): T {
  if (!existsSync(file)) {
    throw new Error(`${label} not found: ${file}`);
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch (error) {
    throw new Error(`Cannot parse ${label} (${file}): ${(error as Error).message}`);
  }
}

export function loadApiMatrix(dataDir: string = DEFAULT_DATA_DIR): ApiMatrixFile {
  const matrix = readJson<ApiMatrixFile>(join(dataDir, 'api-matrix.json'), 'API compatibility matrix');
  if (!Array.isArray(matrix.entries)) {
    throw new Error('Invalid API compatibility matrix: "entries" must be an array');
  }
  return matrix;
}

export function loadOhpmReplacements(dataDir: string = DEFAULT_DATA_DIR): ReplacementFile {
  const replacements = readJson<ReplacementFile>(
    join(dataDir, 'ohpm-replacements.json'),
    'OHPM replacement knowledge base',
  );
  if (!replacements.replacements || typeof replacements.replacements !== 'object') {
    throw new Error('Invalid OHPM replacement knowledge base: "replacements" must be an object');
  }
  return replacements;
}

export function loadKnowledgeData(dataDir: string = DEFAULT_DATA_DIR): KnowledgeData {
  return {
    matrix: loadApiMatrix(dataDir),
    replacements: loadOhpmReplacements(dataDir),
  };
}

export type { ApiMatrixEntry, ApiMatrixFile, KnowledgeData, ReplacementEntry, ReplacementFile } from './types';
