import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { scanDependencies } from '../src/scanner/dependencies';

function withProject(files: Record<string, string>, run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'ohpm-compat-deps-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('解析 package.json 四类依赖并使用 npm lockfile 补全版本', () => {
  withProject(
    {
      'package.json': JSON.stringify({
        name: 'demo-app',
        version: '1.0.0',
        dependencies: { axios: '^1.6.0', lodash: '~4.17.21' },
        devDependencies: { typescript: '^5.7.0' },
        peerDependencies: { react: '>=18' },
        optionalDependencies: { fsevents: '^2.3.3' },
      }),
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { name: 'demo-app', version: '1.0.0' },
          'node_modules/axios': { version: '1.6.8' },
          'node_modules/lodash': { version: '4.17.21' },
          'node_modules/typescript': { version: '5.7.2' },
          'node_modules/react': { version: '18.3.1' },
          'node_modules/fsevents': { version: '2.3.3' },
          'node_modules/delayed-stream': { version: '1.0.0' },
        },
      }),
    },
    (dir) => {
      const result = scanDependencies(dir);
      assert.equal(result.project.name, 'demo-app');
      assert.equal(result.dependencies.length, 5);

      const axios = result.dependencies.find((d) => d.name === 'axios');
      assert.ok(axios);
      assert.equal(axios.type, 'dependencies');
      assert.equal(axios.resolvedVersion, '1.6.8');
      assert.equal(axios.isNative, false);

      const react = result.dependencies.find((d) => d.name === 'react');
      assert.equal(react?.type, 'peerDependencies');

      const fsevents = result.dependencies.find((d) => d.name === 'fsevents');
      assert.equal(fsevents?.isNative, true);
      assert.equal(result.transitiveDependencies, 1);
    },
  );
});

test('支持 yarn.lock 与 pnpm-lock.yaml 解析', () => {
  withProject(
    {
      'package.json': JSON.stringify({ name: 'lock-demo', dependencies: { dayjs: '^1.11.0', ws: '^8.0.0' } }),
      'yarn.lock': 'dayjs@^1.11.0:\n  version "1.11.13"\n\nws@^8.0.0:\n  version "8.18.0"\n',
    },
    (dir) => {
      const result = scanDependencies(dir);
      assert.equal(result.dependencies.find((d) => d.name === 'dayjs')?.resolvedVersion, '1.11.13');
      assert.equal(result.dependencies.find((d) => d.name === 'ws')?.resolvedVersion, '8.18.0');
    },
  );

  withProject(
    {
      'package.json': JSON.stringify({ name: 'pnpm-demo', dependencies: { axios: '1.6.0' } }),
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n\npackages:\n\n  axios@1.6.8:\n    resolution: {integrity: sha512-demo}\n",
    },
    (dir) => {
      const result = scanDependencies(dir);
      assert.equal(result.dependencies.find((d) => d.name === 'axios')?.resolvedVersion, '1.6.8');
    },
  );
});

test('缺少 package.json 时抛出可读错误', () => {
  withProject({}, (dir) => {
    assert.throws(() => scanDependencies(dir), /package\.json/i);
  });
});
