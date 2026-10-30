import type { ScanReport } from '../types';
import type { ReplacementEntry, ReplacementFile } from './types';

export interface MergeKnowledgeResult {
  file: ReplacementFile;
  added: number;
}

export function mergeKnowledgeBase(
  base: ReplacementFile,
  report: ScanReport,
  now: Date = new Date(),
): MergeKnowledgeResult {
  const replacements: Record<string, ReplacementEntry> = { ...base.replacements };
  let added = 0;

  for (const dependency of report.dependencies) {
    if (replacements[dependency.name]) {
      continue;
    }

    if (dependency.ohpm) {
      replacements[dependency.name] = {
        ohpm: dependency.ohpm.name,
        status: dependency.ohpm.status,
        risk: dependency.risk,
        notes: dependency.ohpm.notes ?? dependency.notes,
        updatedAt: now.toISOString(),
        source: 'scan',
      };
      added += 1;
      continue;
    }

    if (
      dependency.status === 'missing' ||
      dependency.status === 'unsupported' ||
      dependency.status === 'unknown'
    ) {
      replacements[dependency.name] = {
        ohpm: null,
        status: 'missing',
        risk: dependency.isNative ? 'critical' : dependency.risk,
        notes: dependency.notes,
        updatedAt: now.toISOString(),
        source: 'scan',
      };
      added += 1;
    }
  }

  if (added === 0) {
    return { file: base, added: 0 };
  }

  return {
    file: {
      ...base,
      updatedAt: now.toISOString(),
      replacements,
    },
    added,
  };
}
