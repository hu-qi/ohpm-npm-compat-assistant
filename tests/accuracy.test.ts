import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { evaluateCase, evaluateFixtures } from '../src/accuracy';
import type { ApiMatrixFile, KnowledgeData, ReplacementFile } from '../src/knowledge/types';

const matrix: ApiMatrixFile = {
  schemaVersion: '1.0.0',
  harmonyVersion: '6.0.0+',
  updatedAt: '2026-10-30',
  entries: [
    { api: 'fs', module: 'fs', kind: 'node', status: 'replaced', harmonyVersion: '6.0.0+', replacement: '@ohos.file.fs', risk: 'high', notes: 'fs' },
    { api: 'fs.readFile', module: 'fs', kind: 'node', status: 'replaced', harmonyVersion: '6.0.0+', replacement: '@ohos.file.fs', risk: 'high', notes: 'read' },
    { api: 'window.localStorage', kind: 'browser', status: 'replaced', harmonyVersion: '6.0.0+', replacement: '@ohos.data.preferences', risk: 'medium', notes: 'prefs' },
  ],
};

const replacements: ReplacementFile = {
  schemaVersion: '1.0.0',
  updatedAt: '2026-10-30',
  replacements: {
    axios: { ohpm: '@ohos/axios', status: 'available', risk: 'low', notes: 'ok' },
    react: { ohpm: null, status: 'missing', risk: 'critical', notes: 'missing' },
  },
};

const knowledge: KnowledgeData = { matrix, replacements };

function withProject(files: Record<string, string>, run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'ohpm-compat-acc-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const full = join(dir, name);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content);
    }
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('evaluateCase 计算四项指标', () => {
  withProject(
    {
      'package.json': JSON.stringify({ name: 'acc-demo', dependencies: { axios: '^1.0.0', react: '^18.0.0' } }),
      'src/index.ts': "import axios from 'axios';\nimport fs from 'fs';\nfs.readFile('a');\nwindow.localStorage.getItem('k');\n",
    },
    (dir) => {
      const result = evaluateCase(
        dir,
        {
          case: 'acc-demo',
          project: '.',
          expected: {
            dependencies: [
              { name: 'axios', status: 'replaced', ohpm: '@ohos/axios' },
              { name: 'react', status: 'missing' },
            ],
            replaceableLibs: [{ name: 'axios', ohpm: '@ohos/axios' }],
            incompatibleApis: [
              { api: 'fs', file: 'src/index.ts' },
              { api: 'fs.readFile', file: 'src/index.ts' },
              { api: 'window.localStorage.getItem', file: 'src/index.ts' },
            ],
            missingLibs: ['react'],
          },
        },
        knowledge,
      );
      assert.equal(result.metrics.dependency.accuracy, 1);
      assert.equal(result.metrics.replaceable.accuracy, 1);
      assert.equal(result.metrics.apiRecall.accuracy, 1);
      assert.equal(result.metrics.apiPrecision.accuracy, 1);
      assert.equal(result.metrics.missing.accuracy, 1);
    },
  );
});

test('evaluateFixtures 读取标注集并按门槛判定', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ohpm-compat-fixtures-'));
  try {
    mkdirSync(join(dir, 'demo', 'src'), { recursive: true });
    mkdirSync(join(dir, 'annotations'), { recursive: true });
    writeFileSync(join(dir, 'demo', 'package.json'), JSON.stringify({ name: 'demo', dependencies: { axios: '^1.0.0' } }));
    writeFileSync(join(dir, 'demo', 'src', 'index.ts'), "import axios from 'axios';\nimport fs from 'fs';\nfs.readFile('a');\n");
    writeFileSync(
      join(dir, 'annotations', 'demo.expected.json'),
      JSON.stringify({
        case: 'demo',
        project: 'demo',
        expected: {
          dependencies: [{ name: 'axios', status: 'replaced', ohpm: '@ohos/axios' }],
          replaceableLibs: [{ name: 'axios', ohpm: '@ohos/axios' }],
          incompatibleApis: [
            { api: 'fs', file: 'src/index.ts' },
            { api: 'fs.readFile', file: 'src/index.ts' },
          ],
          missingLibs: [],
        },
      }),
    );

    const result = evaluateFixtures(dir, undefined, knowledge);
    assert.equal(result.passed, true);
    assert.equal(result.cases.length, 1);
    assert.ok(result.metrics.dependency.accuracy >= 0.8);
    assert.equal(result.metrics.replaceable.accuracy, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('低于门槛时 passed=false 并给出失败项', () => {
  withProject(
    {
      'package.json': JSON.stringify({ name: 'bad-demo', dependencies: { lodash: '^4.0.0' } }),
      'src/index.ts': "import fs from 'fs';\n",
    },
    (dir) => {
      const result = evaluateCase(
        dir,
        {
          case: 'bad-demo',
          project: '.',
          expected: {
            dependencies: [{ name: 'axios', status: 'replaced', ohpm: '@ohos/axios' }],
            replaceableLibs: [{ name: 'axios', ohpm: '@ohos/axios' }],
            incompatibleApis: [{ api: 'fs', file: 'src/index.ts' }],
            missingLibs: ['react'],
          },
        },
        knowledge,
      );
      assert.ok(result.metrics.dependency.accuracy < 0.8);
      assert.ok(result.metrics.replaceable.accuracy < 1);
      assert.ok(result.metrics.missing.accuracy < 0.8);
    },
  );
});
