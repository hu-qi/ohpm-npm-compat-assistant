import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffMatrices, regressionErrors, validateMatrix } from '../src/knowledge/matrix';
import type { ApiMatrixFile } from '../src/knowledge/types';

function matrix(entries: ApiMatrixFile['entries']): ApiMatrixFile {
  return { schemaVersion: '1.0.0', harmonyVersion: '6.0.0+', updatedAt: '2026-10-30', entries };
}

const base = matrix([
  { api: 'fs.readFile', module: 'fs', kind: 'node', status: 'replaced', harmonyVersion: '6.0.0+', risk: 'high', replacement: '@ohos.file.fs' },
  { api: 'window.localStorage', kind: 'browser', status: 'replaced', harmonyVersion: '6.0.0+', risk: 'medium', replacement: '@ohos.data.preferences' },
]);

test('校验矩阵 schema 与重复 API', () => {
  assert.deepEqual(validateMatrix(base), []);

  const invalid = matrix([
    { api: '', kind: 'node', status: 'replaced', harmonyVersion: '6.0.0+', risk: 'high' },
    { api: 'fs.readFile', kind: 'node', status: 'replaced', harmonyVersion: '6.0.0+', risk: 'high' },
    { api: 'fs.readFile', kind: 'node', status: 'replaced', harmonyVersion: '6.0.0+', risk: 'high' },
  ]);
  const errors = validateMatrix(invalid);
  assert.ok(errors.some((error) => error.includes('api')));
  assert.ok(errors.some((error) => error.includes('duplicate')));
});

test('矩阵 diff 识别新增、删除与状态变化', () => {
  const current = matrix([
    { api: 'fs.readFile', module: 'fs', kind: 'node', status: 'partial', harmonyVersion: '6.0.0+', risk: 'high', replacement: '@ohos.file.fs' },
    { api: 'fetch', kind: 'browser', status: 'replaced', harmonyVersion: '6.0.0+', risk: 'medium', replacement: '@ohos.net.http' },
  ]);
  const changes = diffMatrices(base, current);
  assert.ok(changes.some((change) => change.type === 'removed' && change.api === 'window.localStorage'));
  assert.ok(changes.some((change) => change.type === 'added' && change.api === 'fetch'));
  assert.ok(changes.some((change) => change.type === 'changed' && change.api === 'fs.readFile'));

  const errors = regressionErrors(changes);
  assert.ok(errors.some((error) => error.includes('window.localStorage')));
  assert.ok(errors.some((error) => error.includes('fs.readFile')));
});

test('状态提升与新增不会触发回归错误', () => {
  const current = matrix([
    { api: 'fs.readFile', module: 'fs', kind: 'node', status: 'supported', harmonyVersion: '6.0.0+', risk: 'none' },
    { api: 'window.localStorage', kind: 'browser', status: 'replaced', harmonyVersion: '6.0.0+', risk: 'medium', replacement: '@ohos.data.preferences' },
    { api: 'fetch', kind: 'browser', status: 'replaced', harmonyVersion: '6.0.0+', risk: 'medium', replacement: '@ohos.net.http' },
  ]);
  const errors = regressionErrors(diffMatrices(base, current));
  assert.deepEqual(errors, []);
});
