#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { evaluateFixtures, type AccuracyResult } from '../accuracy';
import { DEFAULT_DATA_DIR, loadApiMatrix } from '../knowledge';
import { diffMatrices, regressionErrors, validateMatrix } from '../knowledge/matrix';
import type { ReplacementFile } from '../knowledge/types';
import { mergeKnowledgeBase } from '../knowledge/update';
import { buildJsonReport, writeReports } from '../report';
import { analyzeProject } from '../rules/engine';
import type { ScanReport } from '../types';

interface ParsedArgs {
  command: string;
  positionals: string[];
  options: Map<string, string | true>;
}

const VALUE_FLAGS = new Set([
  'out',
  'json',
  'md',
  'harmony-version',
  'update-kb',
  'fixtures',
  'base',
  'data',
]);

const HELP = `OHPM/NPM 三方库兼容性扫描与适配助手

用法:
  ohpm-compat scan [path] [--out dir] [--json file] [--md file] [--harmony-version 6.0.0] [--print]
  ohpm-compat suggest [path] [--json file] [--update-kb file]
  ohpm-compat accuracy [--fixtures dir] [--json file]
  ohpm-compat matrix [--check] [--base origin/main] [--data file] [--json file]

命令:
  scan       扫描项目依赖与源码，输出 JSON/Markdown 迁移报告
  suggest    输出 OHPM 替代建议，可用 --update-kb 增量更新替换关系知识库
  accuracy   用 fixture 标注集校验准确率门槛
  matrix     校验 API 兼容矩阵，并可与 base 分支做 diff 回归
`;

function parseArgs(argv: string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv;
  const positionals: string[] = [];
  const options = new Map<string, string | true>();

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    if (VALUE_FLAGS.has(name)) {
      const next = rest[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        options.set(name, next);
        index += 1;
      } else {
        options.set(name, true);
      }
    } else {
      options.set(name, true);
    }
  }

  return { command, positionals, options };
}

function optionString(args: ParsedArgs, name: string): string | undefined {
  const value = args.options.get(name);
  return typeof value === 'string' ? value : undefined;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function printSummary(report: ScanReport, jsonPath: string, mdPath: string): void {
  console.log(`扫描项目: ${report.project.name} (HarmonyOS ${report.project.harmonyVersion}+)`);
  console.log(
    `依赖 ${report.summary.dependencies} | 不兼容 API ${report.summary.incompatibleApis} | 可替代库 ${report.summary.replaceableLibs} | 缺失库 ${report.summary.missingLibs} | 风险 ${report.summary.riskLevel}`,
  );
  console.log(`JSON: ${jsonPath}`);
  console.log(`Markdown: ${mdPath}`);
}

function runScan(args: ParsedArgs): number {
  const target = args.positionals[0] ?? '.';
  const harmonyVersion = optionString(args, 'harmony-version');
  const report = analyzeProject(target, harmonyVersion ? { harmonyVersion } : {});
  const result = writeReports(report, {
    outDir: optionString(args, 'out') ?? '.',
    jsonPath: optionString(args, 'json'),
    mdPath: optionString(args, 'md'),
  });
  printSummary(report, result.jsonPath, result.mdPath);
  if (args.options.get('print')) {
    console.log(buildJsonReport(report));
  }
  return 0;
}

interface Suggestions {
  project: string;
  replaceable: Array<{ name: string; version: string; ohpm: string; notes?: string }>;
  missing: Array<{ name: string; version?: string; reason: string; priority: string }>;
}

function buildSuggestions(report: ScanReport): Suggestions {
  return {
    project: report.project.name,
    replaceable: report.replaceableLibs.map((library) => ({
      name: library.name,
      version: library.resolvedVersion ?? library.version,
      ohpm: library.ohpm?.name ?? '',
      notes: library.ohpm?.notes ?? library.notes,
    })),
    missing: report.missingLibs.map((library) => ({
      name: library.name,
      version: library.version,
      reason: library.reason,
      priority: library.priority,
    })),
  };
}

function loadReplacementFile(path: string): ReplacementFile {
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf8')) as ReplacementFile;
  }
  return {
    schemaVersion: '1.0.0',
    updatedAt: new Date(0).toISOString(),
    replacements: {},
  };
}

function runSuggest(args: ParsedArgs): number {
  const target = args.positionals[0] ?? '.';
  const report = analyzeProject(target);
  const suggestions = buildSuggestions(report);

  console.log(`项目: ${suggestions.project}`);
  if (suggestions.replaceable.length > 0) {
    console.log('可替代 OHPM 库:');
    for (const item of suggestions.replaceable) {
      console.log(`  - ${item.name}@${item.version} -> ${item.ohpm}`);
    }
  }
  if (suggestions.missing.length > 0) {
    console.log('OHPM 缺失库:');
    for (const item of suggestions.missing) {
      console.log(`  - ${item.name} [${item.priority}] ${item.reason}`);
    }
  }
  if (suggestions.replaceable.length === 0 && suggestions.missing.length === 0) {
    console.log('未发现需要迁移的三方库。');
  }

  const jsonPath = optionString(args, 'json');
  if (jsonPath) {
    writeJson(jsonPath, suggestions);
    console.log(`JSON: ${jsonPath}`);
  }

  const updateKb = optionString(args, 'update-kb');
  if (updateKb) {
    const base = loadReplacementFile(updateKb);
    const merged = mergeKnowledgeBase(base, report);
    writeJson(updateKb, merged.file);
    console.log(`知识库更新: ${updateKb} (+${merged.added} 条)`);
  }

  return 0;
}

function formatMetric(label: string, metric: { correct: number; total: number; accuracy: number }): string {
  return `${label}: ${(metric.accuracy * 100).toFixed(2)}% (${metric.correct}/${metric.total})`;
}

function printAccuracy(result: AccuracyResult): void {
  for (const item of result.cases) {
    console.log(
      `[${item.case}] 依赖 ${(item.metrics.dependency.accuracy * 100).toFixed(1)}% | 替代 ${(item.metrics.replaceable.accuracy * 100).toFixed(1)}% | API 召回 ${(item.metrics.apiRecall.accuracy * 100).toFixed(1)}% | 缺失 ${(item.metrics.missing.accuracy * 100).toFixed(1)}%`,
    );
  }
  console.log(
    [
      formatMetric('依赖扫描', result.metrics.dependency),
      formatMetric('可替代库', result.metrics.replaceable),
      formatMetric('API 召回', result.metrics.apiRecall),
      formatMetric('API 精确', result.metrics.apiPrecision),
      formatMetric('缺失识别', result.metrics.missing),
    ].join('\n'),
  );
  if (result.passed) {
    console.log('准确率门槛: PASS');
  } else {
    console.log('准确率门槛: FAIL');
    for (const failure of result.failures) {
      console.log(`  - ${failure}`);
    }
  }
}

function runAccuracy(args: ParsedArgs): number {
  const result = evaluateFixtures(optionString(args, 'fixtures') ?? 'fixtures');
  printAccuracy(result);
  const jsonPath = optionString(args, 'json');
  if (jsonPath) {
    writeJson(jsonPath, result);
    console.log(`JSON: ${jsonPath}`);
  }
  return result.passed ? 0 : 1;
}

function resolveMatrixPath(explicit?: string): string {
  if (!explicit) {
    const sourcePath = join(process.cwd(), 'src', 'knowledge', 'data', 'api-matrix.json');
    return existsSync(sourcePath) ? sourcePath : join(DEFAULT_DATA_DIR, 'api-matrix.json');
  }
  return explicit.endsWith('.json') ? explicit : join(explicit, 'api-matrix.json');
}

function gitShow(ref: string, matrixPath: string): string {
  const repoPath = isAbsolute(matrixPath) ? relative(process.cwd(), matrixPath) : matrixPath;
  const normalized = repoPath.split('\\').join('/');
  return execFileSync('git', ['show', `${ref}:${normalized}`], { encoding: 'utf8' });
}

function runMatrix(args: ParsedArgs): number {
  const matrixPath = resolveMatrixPath(optionString(args, 'data'));
  const matrix = loadApiMatrix(dirname(matrixPath));
  const errors = validateMatrix(matrix);
  const result: {
    matrix: string;
    valid: boolean;
    errors: string[];
    changes?: ReturnType<typeof diffMatrices>;
    regressions?: string[];
  } = {
    matrix: matrixPath,
    valid: errors.length === 0,
    errors,
  };

  if (errors.length > 0) {
    console.error('矩阵校验失败:');
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
  } else {
    console.log(`矩阵校验通过: ${matrix.entries.length} 条 (${matrix.harmonyVersion})`);
  }

  const base = optionString(args, 'base');
  let exitCode = errors.length === 0 ? 0 : 1;
  if (base) {
    try {
      const baseMatrix = JSON.parse(gitShow(base, matrixPath)) as ReturnType<typeof loadApiMatrix>;
      const changes = diffMatrices(baseMatrix, matrix);
      const regressions = regressionErrors(changes);
      result.changes = changes;
      result.regressions = regressions;
      console.log(`矩阵 diff(${base} -> HEAD): ${changes.length} 处变更`);
      for (const change of changes) {
        console.log(`  - ${change.type}: ${change.api}`);
      }
      if (regressions.length > 0) {
        console.error('矩阵回归:');
        for (const regression of regressions) {
          console.error(`  - ${regression}`);
        }
        exitCode = 1;
      }
    } catch (error) {
      console.error(`无法读取 base 矩阵 ${base}: ${(error as Error).message}`);
      exitCode = 1;
    }
  }

  const jsonPath = optionString(args, 'json');
  if (jsonPath) {
    writeJson(jsonPath, result);
    console.log(`JSON: ${jsonPath}`);
  }

  return exitCode;
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const args = parseArgs(argv);
  switch (args.command) {
    case 'scan':
      return runScan(args);
    case 'suggest':
      return runSuggest(args);
    case 'accuracy':
      return runAccuracy(args);
    case 'matrix':
      return runMatrix(args);
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return 0;
    default:
      console.error(`未知命令: ${args.command}`);
      console.error(HELP);
      return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}
