import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { analyzeProject } from '../src/rules/engine';
import type { ApiMatrixFile, ReplacementFile } from '../src/knowledge/types';

const matrix: ApiMatrixFile = {
  schemaVersion: '1.0.0',
  harmonyVersion: '6.0.0+',
  updatedAt: '2026-10-30',
  entries: [
    { api: 'fs', module: 'fs', kind: 'node', status: 'replaced', harmonyVersion: '6.0.0+', replacement: '@ohos.file.fs', risk: 'high', notes: 'fs replacement' },
    { api: 'fs.readFile', module: 'fs', kind: 'node', status: 'replaced', harmonyVersion: '6.0.0+', replacement: '@ohos.file.fs', risk: 'high', notes: 'read replacement' },
    { api: 'window.localStorage', kind: 'browser', status: 'replaced', harmonyVersion: '6.0.0+', replacement: '@ohos.data.preferences', risk: 'medium', notes: 'preferences' },
    { api: 'setTimeout', kind: 'runtime', status: 'supported', harmonyVersion: '6.0.0+', risk: 'none', notes: 'ok' },
  ],
};

const replacements: ReplacementFile = {
  schemaVersion: '1.0.0',
  updatedAt: '2026-10-30',
  replacements: {
    axios: { ohpm: '@ohos/axios', status: 'available', risk: 'low', category: 'network', notes: 'use @ohos/axios' },
    react: { ohpm: null, status: 'missing', risk: 'critical', category: 'framework', notes: 'no React runtime' },
    sharp: { ohpm: null, status: 'missing', risk: 'critical', category: 'native', notes: 'native addon' },
  },
};

function withProject(files: Record<string, string>, run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'ohpm-compat-engine-'));
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

test('规则引擎汇总依赖、API、替代库与缺失库', () => {
  withProject(
    {
      'package.json': JSON.stringify({
        name: 'engine-demo',
        version: '2.0.0',
        dependencies: { axios: '^1.6.0', react: '^18.0.0', sharp: '^0.33.0', unknownpkg: '^1.0.0' },
      }),
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/axios': { version: '1.6.8' },
          'node_modules/react': { version: '18.3.1' },
          'node_modules/sharp': { version: '0.33.5' },
          'node_modules/unknownpkg': { version: '1.0.1' },
        },
      }),
      'src/index.ts': `
import axios from 'axios';
import fs from 'fs';
import react from 'react';
setTimeout(() => {}, 0);
fs.readFile('a.txt', () => {});
fs.promises.writeFile('b.txt', 'x');
window.localStorage.getItem('token');
`,
    },
    (dir) => {
      const report = analyzeProject(dir, { now: new Date('2026-10-30T00:00:00.000Z') }, { matrix, replacements });

      assert.equal(report.project.name, 'engine-demo');
      assert.equal(report.project.harmonyVersion, '6.0.0');
      assert.equal(report.generatedAt, '2026-10-30T00:00:00.000Z');

      const axios = report.dependencies.find((dep) => dep.name === 'axios');
      assert.equal(axios?.status, 'replaced');
      assert.equal(axios?.ohpm?.name, '@ohos/axios');
      assert.equal(axios?.usedInSource, true);

      const react = report.dependencies.find((dep) => dep.name === 'react');
      assert.equal(react?.status, 'missing');
      assert.equal(react?.risk, 'critical');

      const sharp = report.dependencies.find((dep) => dep.name === 'sharp');
      assert.equal(sharp?.status, 'missing');
      assert.equal(sharp?.isNative, true);

      const unknown = report.dependencies.find((dep) => dep.name === 'unknownpkg');
      assert.equal(unknown?.status, 'unknown');
      assert.ok(report.warnings.some((warning) => warning.includes('unknownpkg')));

      const apiNames = report.apiFindings.map((finding) => finding.api);
      assert.ok(apiNames.includes('fs'));
      assert.ok(apiNames.includes('fs.readFile'));
      assert.ok(apiNames.includes('fs.promises.writeFile'));
      assert.ok(apiNames.includes('window.localStorage.getItem'));
      assert.ok(!apiNames.includes('setTimeout'));

      assert.deepEqual(
        report.replaceableLibs.map((lib) => lib.name),
        ['axios'],
      );
      assert.deepEqual(
        report.missingLibs.map((lib) => lib.name).sort(),
        ['react', 'sharp'],
      );
      assert.equal(report.summary.incompatibleApis, report.apiFindings.length);
      assert.equal(report.summary.riskLevel, 'critical');
    },
  );
});

test('没有风险时 riskLevel 为 none', () => {
  withProject(
    {
      'package.json': JSON.stringify({ name: 'clean-demo', dependencies: { axios: '^1.0.0' } }),
      'src/index.ts': "import axios from 'axios';\nsetTimeout(() => {}, 0);\n",
    },
    (dir) => {
      const report = analyzeProject(
        dir,
        { now: new Date('2026-10-30T00:00:00.000Z') },
        {
          matrix,
          replacements: {
            schemaVersion: '1.0.0',
            updatedAt: '2026-10-30',
            replacements: {
              axios: { ohpm: '@ohos/axios', status: 'available', risk: 'low', notes: 'ok' },
            },
          },
        },
      );
      assert.equal(report.apiFindings.length, 0);
      assert.equal(report.missingLibs.length, 0);
      assert.equal(report.summary.riskLevel, 'low');
    },
  );
});
