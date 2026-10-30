import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeKnowledgeBase } from '../src/knowledge/update';
import type { ReplacementFile } from '../src/knowledge/types';
import type { ScanReport } from '../src/types';

const report = {
  schemaVersion: '1.0.0',
  generatedAt: '2026-10-30T00:00:00.000Z',
  tool: { name: 'tool', version: '0.1.0' },
  project: { name: 'demo', path: '/tmp/demo', harmonyVersion: '6.0.0' },
  summary: {
    dependencies: 3,
    sourceFiles: 1,
    imports: 1,
    incompatibleApis: 0,
    replaceableLibs: 1,
    missingLibs: 1,
    nativeRisks: 1,
    riskLevel: 'critical',
  },
  dependencies: [
    { name: 'axios', version: '1.0.0', type: 'dependencies', status: 'replaced', risk: 'low', ohpm: { name: '@ohos/axios', status: 'available', notes: 'ok' }, usedInSource: true, isNative: false },
    { name: 'newlib', version: '2.0.0', type: 'dependencies', status: 'unknown', risk: 'medium', notes: 'manual review', usedInSource: false, isNative: false },
    { name: 'sharp', version: '0.33.0', type: 'dependencies', status: 'unsupported', risk: 'critical', notes: 'native', usedInSource: true, isNative: true },
  ],
  apiFindings: [],
  replaceableLibs: [],
  missingLibs: [],
  sourceImports: [],
  warnings: [],
} as unknown as ScanReport;

test('合并知识库时新增缺失/替代关系且不覆盖已有条目', () => {
  const base: ReplacementFile = {
    schemaVersion: '1.0.0',
    updatedAt: '2026-01-01',
    replacements: {
      axios: { ohpm: '@ohos/axios', status: 'available', risk: 'low', notes: 'existing' },
    },
  };
  const result = mergeKnowledgeBase(base, report, new Date('2026-10-30T00:00:00.000Z'));
  assert.equal(result.added, 2);
  assert.equal(result.file.replacements.axios.notes, 'existing');
  assert.equal(result.file.replacements.newlib.status, 'missing');
  assert.equal(result.file.replacements.newlib.ohpm, null);
  assert.equal(result.file.replacements.sharp.status, 'missing');
  assert.equal(result.file.replacements.sharp.risk, 'critical');
  assert.equal(result.file.updatedAt, '2026-10-30T00:00:00.000Z');
});

test('重复合并保持幂等', () => {
  const first = mergeKnowledgeBase(
    { schemaVersion: '1.0.0', updatedAt: '2026-01-01', replacements: {} },
    report,
    new Date('2026-10-30T00:00:00.000Z'),
  );
  const second = mergeKnowledgeBase(first.file, report, new Date('2026-10-31T00:00:00.000Z'));
  assert.equal(second.added, 0);
  assert.deepEqual(Object.keys(second.file.replacements).sort(), ['axios', 'newlib', 'sharp']);
});
