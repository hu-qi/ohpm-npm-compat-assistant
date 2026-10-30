import type { ApiKind, ApiMatrixEntry, ApiMatrixFile } from './types';
import type { CompatStatus, RiskLevel } from '../types';

const KINDS = new Set<ApiKind>(['node', 'browser', 'native', 'runtime']);
const STATUSES = new Set<CompatStatus>([
  'supported',
  'partial',
  'unsupported',
  'replaced',
  'missing',
  'unknown',
]);
const RISKS = new Set<RiskLevel>(['critical', 'high', 'medium', 'low', 'none']);

const STATUS_RANK: Record<CompatStatus, number> = {
  supported: 5,
  replaced: 4,
  partial: 3,
  unknown: 2,
  missing: 1,
  unsupported: 0,
};

export interface MatrixChange {
  api: string;
  type: 'added' | 'removed' | 'changed';
  before?: ApiMatrixEntry;
  after?: ApiMatrixEntry;
}

export function validateMatrix(matrix: ApiMatrixFile): string[] {
  const errors: string[] = [];
  if (!matrix || typeof matrix !== 'object') {
    return ['matrix must be an object'];
  }
  if (!matrix.schemaVersion) {
    errors.push('schemaVersion is required');
  }
  if (!matrix.harmonyVersion) {
    errors.push('harmonyVersion is required');
  }
  if (!Array.isArray(matrix.entries)) {
    return [...errors, 'entries must be an array'];
  }

  const seen = new Set<string>();
  matrix.entries.forEach((entry, index) => {
    const prefix = `entries[${index}]`;
    if (!entry.api || typeof entry.api !== 'string') {
      errors.push(`${prefix}.api is required`);
    } else if (seen.has(entry.api)) {
      errors.push(`duplicate api: ${entry.api}`);
    } else {
      seen.add(entry.api);
    }
    if (!entry.kind || !KINDS.has(entry.kind)) {
      errors.push(`${prefix}.kind must be one of ${[...KINDS].join('/')}`);
    }
    if (!entry.status || !STATUSES.has(entry.status)) {
      errors.push(`${prefix}.status must be one of ${[...STATUSES].join('/')}`);
    }
    if (!entry.harmonyVersion || !/^\d+\.\d+\.\d+\+?$/.test(entry.harmonyVersion)) {
      errors.push(`${prefix}.harmonyVersion must look like 6.0.0+`);
    }
    if (!entry.risk || !RISKS.has(entry.risk)) {
      errors.push(`${prefix}.risk must be one of ${[...RISKS].join('/')}`);
    }
  });

  return errors;
}

export function diffMatrices(base: ApiMatrixFile, current: ApiMatrixFile): MatrixChange[] {
  const baseMap = new Map(base.entries.map((entry) => [entry.api, entry]));
  const currentMap = new Map(current.entries.map((entry) => [entry.api, entry]));
  const changes: MatrixChange[] = [];

  for (const [api, before] of baseMap) {
    const after = currentMap.get(api);
    if (!after) {
      changes.push({ api, type: 'removed', before });
    } else if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes.push({ api, type: 'changed', before, after });
    }
  }

  for (const [api, after] of currentMap) {
    if (!baseMap.has(api)) {
      changes.push({ api, type: 'added', after });
    }
  }

  return changes.sort((a, b) => a.api.localeCompare(b.api));
}

export function regressionErrors(changes: MatrixChange[]): string[] {
  const errors: string[] = [];
  for (const change of changes) {
    if (change.type === 'removed') {
      errors.push(`matrix entry removed: ${change.api}`);
      continue;
    }
    if (change.type === 'changed' && change.before && change.after) {
      const beforeRank = STATUS_RANK[change.before.status];
      const afterRank = STATUS_RANK[change.after.status];
      if (afterRank < beforeRank) {
        errors.push(
          `matrix status downgraded: ${change.api} (${change.before.status} -> ${change.after.status})`,
        );
      }
    }
  }
  return errors;
}
