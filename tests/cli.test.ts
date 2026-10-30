import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { main } from '../src/cli';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ohpm-compat-'));
  tempDirs.push(dir);
  return dir;
}

function quiet<T>(fn: () => T): T {
  const log = console.log;
  const error = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.error = error;
  }
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scan 命令输出 JSON/Markdown 报告', () => {
  const dir = tempDir();
  const jsonPath = join(dir, 'report.json');
  const mdPath = join(dir, 'report.md');
  const code = quiet(() =>
    main(['scan', 'fixtures/sample-project', '--out', dir, '--json', jsonPath, '--md', mdPath]),
  );

  assert.equal(code, 0);
  assert.ok(existsSync(jsonPath));
  assert.ok(existsSync(mdPath));
  const report = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
    summary: { incompatibleApis: number; missingLibs: number; replaceableLibs: number };
  };
  assert.equal(report.summary.incompatibleApis, 25);
  assert.equal(report.summary.missingLibs, 4);
  assert.equal(report.summary.replaceableLibs, 6);
});

test('accuracy 命令用标注集通过门槛', () => {
  const dir = tempDir();
  const jsonPath = join(dir, 'accuracy.json');
  const code = quiet(() => main(['accuracy', '--fixtures', 'fixtures', '--json', jsonPath]));

  assert.equal(code, 0);
  const result = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
    passed: boolean;
    metrics: { dependency: { accuracy: number }; apiPrecision: { accuracy: number } };
  };
  assert.equal(result.passed, true);
  assert.ok(result.metrics.dependency.accuracy >= 0.8);
  assert.ok(result.metrics.apiPrecision.accuracy >= 0.8);
});

test('suggest --update-kb 增量写入知识库', () => {
  const dir = tempDir();
  const kbPath = join(dir, 'ohpm-replacements.json');
  const code = quiet(() =>
    main(['suggest', 'fixtures/sample-project', '--update-kb', kbPath]),
  );

  assert.equal(code, 0);
  const file = JSON.parse(readFileSync(kbPath, 'utf8')) as {
    replacements: Record<string, { status: string }>;
  };
  assert.equal(file.replacements.react?.status, 'missing');
  assert.equal(file.replacements.axios?.status, 'available');
});

test('matrix --check 校验通过并支持 base diff', () => {
  const dir = tempDir();
  const jsonPath = join(dir, 'matrix.json');
  const code = quiet(() => main(['matrix', '--check', '--base', 'HEAD', '--json', jsonPath]));

  assert.equal(code, 0);
  const result = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
    valid: boolean;
    changes: unknown[];
    regressions: unknown[];
  };
  assert.equal(result.valid, true);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.regressions, []);
});

test('未知命令返回非零退出码', () => {
  assert.equal(quiet(() => main(['unknown-command'])), 1);
});
