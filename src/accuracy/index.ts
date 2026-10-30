import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadKnowledgeData } from '../knowledge';
import type { KnowledgeData } from '../knowledge/types';
import { analyzeProject } from '../rules/engine';
import type { CompatStatus, DependencyType } from '../types';

export interface ExpectedDependency {
  name: string;
  status?: CompatStatus;
  ohpm?: string;
  type?: DependencyType;
}

export interface ExpectedReplaceable {
  name: string;
  ohpm?: string;
}

export interface ExpectedApi {
  api: string;
  file?: string;
}

export interface ExpectedAnnotation {
  dependencies?: ExpectedDependency[];
  replaceableLibs?: ExpectedReplaceable[];
  incompatibleApis?: ExpectedApi[];
  missingLibs?: string[];
}

export interface AnnotationFile {
  case: string;
  project: string;
  expected: ExpectedAnnotation;
}

export interface Metric {
  correct: number;
  total: number;
  accuracy: number;
}

export interface CaseMetrics {
  dependency: Metric;
  replaceable: Metric;
  apiRecall: Metric;
  apiPrecision: Metric;
  missing: Metric;
}

export interface CaseResult {
  case: string;
  metrics: CaseMetrics;
  failures: string[];
}

export interface AccuracyThresholds {
  dependency: number;
  replaceable: number;
  apiRecall: number;
  apiPrecision: number;
  missing: number;
}

export interface AccuracyResult {
  cases: CaseResult[];
  metrics: CaseMetrics;
  thresholds: AccuracyThresholds;
  passed: boolean;
  failures: string[];
}

export const DEFAULT_THRESHOLDS: AccuracyThresholds = {
  dependency: 0.8,
  replaceable: 1,
  apiRecall: 0.8,
  apiPrecision: 0.8,
  missing: 0.8,
};

function metric(correct: number, total: number): Metric {
  return {
    correct,
    total,
    accuracy: total === 0 ? 1 : correct / total,
  };
}

function evaluateDependency(
  rootDir: string,
  annotation: AnnotationFile,
  knowledge?: KnowledgeData,
): { metric: Metric; report: ReturnType<typeof analyzeProject> } {
  const report = analyzeProject(rootDir, {}, knowledge);
  const expected = annotation.expected.dependencies ?? [];
  let correct = 0;
  for (const item of expected) {
    const finding = report.dependencies.find((dependency) => dependency.name === item.name);
    if (!finding) {
      continue;
    }
    if (item.status && finding.status !== item.status) {
      continue;
    }
    if (item.ohpm && finding.ohpm?.name !== item.ohpm) {
      continue;
    }
    if (item.type && finding.type !== item.type) {
      continue;
    }
    correct += 1;
  }
  return { metric: metric(correct, expected.length), report };
}

function evaluateReplaceable(report: ReturnType<typeof analyzeProject>, annotation: AnnotationFile): Metric {
  const expected = annotation.expected.replaceableLibs ?? [];
  let correct = 0;
  for (const item of expected) {
    const finding = report.replaceableLibs.find((library) => library.name === item.name);
    if (finding && (!item.ohpm || finding.ohpm?.name === item.ohpm)) {
      correct += 1;
    }
  }
  return metric(correct, expected.length);
}

function evaluateApis(
  report: ReturnType<typeof analyzeProject>,
  annotation: AnnotationFile,
): { recall: Metric; precision: Metric } {
  const expected = annotation.expected.incompatibleApis ?? [];
  const used = new Set<number>();
  let matched = 0;

  for (const item of expected) {
    const index = report.apiFindings.findIndex((finding, candidateIndex) => {
      if (used.has(candidateIndex)) {
        return false;
      }
      if (finding.api !== item.api) {
        return false;
      }
      return !item.file || finding.file === item.file;
    });
    if (index !== -1) {
      used.add(index);
      matched += 1;
    }
  }

  return {
    recall: metric(matched, expected.length),
    precision: metric(matched, report.apiFindings.length),
  };
}

function evaluateMissing(report: ReturnType<typeof analyzeProject>, annotation: AnnotationFile): Metric {
  const expected = annotation.expected.missingLibs ?? [];
  const detected = new Set(report.missingLibs.map((library) => library.name));
  const correct = expected.filter((name) => detected.has(name)).length;
  return metric(correct, expected.length);
}

function caseFailures(caseName: string, metrics: CaseMetrics, thresholds: AccuracyThresholds): string[] {
  const failures: string[] = [];
  const checks: Array<[keyof CaseMetrics, number, string]> = [
    ['dependency', thresholds.dependency, 'dependency accuracy'],
    ['replaceable', thresholds.replaceable, 'replaceable accuracy'],
    ['apiRecall', thresholds.apiRecall, 'API recall'],
    ['apiPrecision', thresholds.apiPrecision, 'API precision'],
    ['missing', thresholds.missing, 'missing library accuracy'],
  ];
  for (const [key, threshold, label] of checks) {
    if (metrics[key].accuracy < threshold) {
      failures.push(
        `${caseName}: ${label} ${metrics[key].accuracy.toFixed(3)} < ${threshold.toFixed(3)}`,
      );
    }
  }
  return failures;
}

export function evaluateCase(
  rootDir: string,
  annotation: AnnotationFile,
  knowledge?: KnowledgeData,
  thresholds: AccuracyThresholds = DEFAULT_THRESHOLDS,
): CaseResult {
  const { metric: dependency, report } = evaluateDependency(rootDir, annotation, knowledge);
  const replaceable = evaluateReplaceable(report, annotation);
  const apis = evaluateApis(report, annotation);
  const missing = evaluateMissing(report, annotation);
  const metrics: CaseMetrics = {
    dependency,
    replaceable,
    apiRecall: apis.recall,
    apiPrecision: apis.precision,
    missing,
  };
  return {
    case: annotation.case,
    metrics,
    failures: caseFailures(annotation.case, metrics, thresholds),
  };
}

function aggregate(cases: CaseResult[]): CaseMetrics {
  const sum = (pick: (metrics: CaseMetrics) => Metric): Metric => {
    let correct = 0;
    let total = 0;
    for (const item of cases) {
      const value = pick(item.metrics);
      correct += value.correct;
      total += value.total;
    }
    return metric(correct, total);
  };
  return {
    dependency: sum((metrics) => metrics.dependency),
    replaceable: sum((metrics) => metrics.replaceable),
    apiRecall: sum((metrics) => metrics.apiRecall),
    apiPrecision: sum((metrics) => metrics.apiPrecision),
    missing: sum((metrics) => metrics.missing),
  };
}

export function evaluateFixtures(
  fixturesDir: string = 'fixtures',
  thresholds: AccuracyThresholds = DEFAULT_THRESHOLDS,
  knowledge?: KnowledgeData,
): AccuracyResult {
  const root = resolve(fixturesDir);
  const annotationsDir = join(root, 'annotations');
  if (!existsSync(annotationsDir)) {
    throw new Error(`Annotations directory not found: ${annotationsDir}`);
  }

  const data = knowledge ?? loadKnowledgeData();
  const files = readdirSync(annotationsDir)
    .filter((name) => name.endsWith('.expected.json'))
    .sort();
  if (files.length === 0) {
    throw new Error(`No annotation files (*.expected.json) found in ${annotationsDir}`);
  }

  const cases: CaseResult[] = files.map((file) => {
    const annotation = JSON.parse(readFileSync(join(annotationsDir, file), 'utf8')) as AnnotationFile;
    const projectDir = resolve(root, annotation.project);
    return evaluateCase(projectDir, annotation, data, thresholds);
  });

  const metrics = aggregate(cases);
  const failures = cases.flatMap((item) => item.failures);
  return {
    cases,
    metrics,
    thresholds,
    passed: failures.length === 0,
    failures,
  };
}
