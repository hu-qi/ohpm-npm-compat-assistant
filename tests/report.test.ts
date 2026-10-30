import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildJsonReport, buildMarkdownReport, writeReports } from '../src/report';
import type { ScanReport } from '../src/types';

const report: ScanReport = {
  schemaVersion: '1.0.0',
  generatedAt: '2026-10-30T00:00:00.000Z',
  tool: { name: 'ohpm-npm-compat-assistant', version: '0.1.0' },
  project: { name: 'demo', version: '1.0.0', path: '/tmp/demo', harmonyVersion: '6.0.0' },
  summary: {
    dependencies: 2,
    sourceFiles: 1,
    imports: 2,
    incompatibleApis: 1,
    replaceableLibs: 1,
    missingLibs: 1,
    nativeRisks: 0,
    riskLevel: 'critical',
  },
  dependencies: [
    {
      name: 'axios',
      version: '^1.6.0',
      resolvedVersion: '1.6.8',
      type: 'dependencies',
      status: 'replaced',
      risk: 'low',
      ohpm: { name: '@ohos/axios', status: 'available', notes: 'use it' },
      usedInSource: true,
      isNative: false,
    },
    {
      name: 'react',
      version: '^18.0.0',
      type: 'dependencies',
      status: 'missing',
      risk: 'critical',
      notes: 'no runtime',
      usedInSource: true,
      isNative: false,
    },
  ],
  apiFindings: [
    {
      api: 'window.localStorage.getItem',
      file: 'src/index.ts',
      line: 3,
      status: 'replaced',
      harmonyVersion: '6.0.0+',
      risk: 'medium',
      replacement: '@ohos.data.preferences',
      notes: 'use preferences',
    },
  ],
  replaceableLibs: [],
  missingLibs: [
    { name: 'react', version: '18.3.1', reason: 'no runtime', priority: 'critical', usageCount: 1 },
  ],
  sourceImports: [{ module: 'axios', file: 'src/index.ts', line: 1, kind: 'import' }],
  warnings: ['No OHPM mapping for dependency "left-pad"'],
};
report.replaceableLibs = [report.dependencies[0]];

test('JSON 报告稳定且可解析', () => {
  const json = buildJsonReport(report);
  const parsed = JSON.parse(json) as ScanReport;
  assert.equal(parsed.schemaVersion, '1.0.0');
  assert.equal(parsed.summary.riskLevel, 'critical');
  assert.equal(parsed.dependencies[0].name, 'axios');
});

test('Markdown 报告包含关键区块和内容', () => {
  const markdown = buildMarkdownReport(report);
  assert.match(markdown, /# OHPM\/NPM 兼容性迁移报告/);
  assert.match(markdown, /## 概览/);
  assert.match(markdown, /## 依赖清单/);
  assert.match(markdown, /## 不兼容 API/);
  assert.match(markdown, /## 可替代 OHPM 库/);
  assert.match(markdown, /## 缺失库/);
  assert.match(markdown, /@ohos\/axios/);
  assert.match(markdown, /window\.localStorage\.getItem/);
  assert.match(markdown, /src\/index\.ts:3/);
});

test('writeReports 写出 JSON 与 Markdown 文件', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ohpm-compat-report-'));
  try {
    const result = writeReports(report, { outDir: dir });
    assert.ok(result.jsonPath);
    assert.ok(result.mdPath);
    assert.ok(existsSync(result.jsonPath));
    assert.ok(existsSync(result.mdPath));
    assert.equal(JSON.parse(readFileSync(result.jsonPath, 'utf8')).project.name, 'demo');
    assert.match(readFileSync(result.mdPath, 'utf8'), /@ohos\/axios/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
