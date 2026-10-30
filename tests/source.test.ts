import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { scanSource } from '../src/scanner/source';

function withSource(files: Record<string, string>, run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'ohpm-compat-src-'));
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

test('识别 import/require/动态 import 与常见 API 调用', () => {
  withSource(
    {
      'src/index.ts': `
import fs from 'fs';
import { readFile } from 'node:fs';
import * as path from 'path';
import dayjs from 'dayjs';
const crypto = require('crypto');
const { exec } = require('child_process');

fs.readFile('a.txt', () => {});
fs.promises.writeFile('b.txt', 'x');
readFile('c.txt', () => {});
path.join('a', 'b');
crypto.createHash('sha256');
exec('ls');
window.localStorage.getItem('token');
document.querySelector('#app');
fetch('/api');
new XMLHttpRequest();
Buffer.from('a');
process.env.NODE_ENV;
dayjs().format();
const lazy = import('./lazy');
`,
    },
    (dir) => {
      const result = scanSource(dir);
      const modules = result.imports.map((item) => item.module);
      assert.ok(modules.includes('fs'));
      assert.ok(modules.includes('node:fs'));
      assert.ok(modules.includes('path'));
      assert.ok(modules.includes('crypto'));
      assert.ok(modules.includes('child_process'));
      assert.ok(modules.includes('dayjs'));
      assert.ok(modules.includes('./lazy'));

      const dynamic = result.imports.find((item) => item.module === './lazy');
      assert.equal(dynamic?.kind, 'dynamic-import');

      const apis = result.apiUsages.map((usage) => usage.api);
      for (const expected of [
        'fs.readFile',
        'fs.promises.writeFile',
        'fs.readFile',
        'path.join',
        'crypto.createHash',
        'child_process.exec',
        'window.localStorage',
        'document.querySelector',
        'fetch',
        'XMLHttpRequest',
        'Buffer.from',
        'process.env',
      ]) {
        assert.ok(apis.includes(expected), `missing API usage: ${expected}`);
      }

      const fsRead = result.apiUsages.find((usage) => usage.api === 'fs.readFile' && usage.file === 'src/index.ts');
      assert.equal(fsRead?.line, 9);
    },
  );
});

test('支持解构别名与最长成员链', () => {
  withSource(
    {
      'app/main.js': `
const { promises: fsp } = require('fs');
const { readFile: read } = require('node:fs');
fsp.readFile('a');
read('b');
localStorage.setItem('k', 'v');
`,
    },
    (dir) => {
      const result = scanSource(dir);
      const apis = result.apiUsages.map((usage) => usage.api);
      assert.ok(apis.includes('fs.promises.readFile'));
      assert.ok(apis.includes('fs.readFile'));
      assert.ok(apis.includes('localStorage'));
    },
  );
});

test('跳过 node_modules 与 dist 目录', () => {
  withSource(
    {
      'src/ok.ts': "import fs from 'fs';\nfs.readFile('ok');\n",
      'node_modules/pkg/index.js': "require('fs').readFileSync('x');\n",
      'dist/old.js': "require('child_process').exec('ls');\n",
    },
    (dir) => {
      const result = scanSource(dir);
      assert.equal(result.sourceFiles, 1);
      assert.equal(result.imports.length, 1);
      assert.ok(result.apiUsages.every((usage) => usage.file === 'src/ok.ts'));
    },
  );
});
