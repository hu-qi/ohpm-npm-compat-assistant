import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DependencyFinding, ScanReport } from '../types';

export interface WriteReportOptions {
  outDir?: string;
  jsonPath?: string;
  mdPath?: string;
}

export interface WriteReportResult {
  jsonPath: string;
  mdPath: string;
}

function cell(value: unknown): string {
  return String(value ?? '-')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    replaced: '可替代',
    supported: '兼容',
    partial: '部分兼容',
    unsupported: '不兼容',
    missing: '缺失',
    unknown: '未知',
  };
  return labels[status] ?? status;
}

function dependencyRows(dependencies: DependencyFinding[]): string {
  if (dependencies.length === 0) {
    return '| - | - | - | - | - |\n';
  }
  return dependencies
    .map((dependency) => {
      const ohpm = dependency.ohpm ? `${dependency.ohpm.name} (${dependency.ohpm.status})` : '-';
      return `| ${cell(dependency.name)} | ${cell(dependency.resolvedVersion ?? dependency.version)} | ${cell(statusLabel(dependency.status))} | ${cell(ohpm)} | ${cell(dependency.risk)} |`;
    })
    .join('\n');
}

export function buildJsonReport(report: ScanReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function buildMarkdownReport(report: ScanReport): string {
  const lines: string[] = [];
  lines.push('# OHPM/NPM 兼容性迁移报告');
  lines.push('');
  lines.push(`- 项目：**${report.project.name}**${report.project.version ? `@${report.project.version}` : ''}`);
  lines.push(`- 扫描路径：\`${report.project.path}\``);
  lines.push(`- 目标 HarmonyOS 版本：${report.project.harmonyVersion}+`);
  lines.push(`- 生成时间：${report.generatedAt}`);
  lines.push(`- 工具：${report.tool.name}@${report.tool.version}`);
  lines.push(`- 总体风险：**${report.summary.riskLevel}**`);
  lines.push('');

  lines.push('## 概览');
  lines.push('');
  lines.push('| 指标 | 数值 |');
  lines.push('|------|------|');
  lines.push(`| 依赖数量 | ${report.summary.dependencies} |`);
  lines.push(`| 源码文件 | ${report.summary.sourceFiles} |`);
  lines.push(`| import/require | ${report.summary.imports} |`);
  lines.push(`| 不兼容 API | ${report.summary.incompatibleApis} |`);
  lines.push(`| 可替代 OHPM 库 | ${report.summary.replaceableLibs} |`);
  lines.push(`| OHPM 缺失库 | ${report.summary.missingLibs} |`);
  lines.push(`| 原生模块风险 | ${report.summary.nativeRisks} |`);
  lines.push('');

  lines.push('## 依赖清单');
  lines.push('');
  lines.push('| 依赖 | 版本 | 状态 | OHPM 替代 | 风险 |');
  lines.push('|------|------|------|-----------|------|');
  lines.push(dependencyRows(report.dependencies));
  lines.push('');

  lines.push('## 不兼容 API');
  lines.push('');
  if (report.apiFindings.length === 0) {
    lines.push('未发现命中的不兼容 API。');
  } else {
    lines.push('| API | 位置 | 状态 | 替代方案 | 风险 | 说明 |');
    lines.push('|-----|------|------|----------|------|------|');
    for (const finding of report.apiFindings) {
      lines.push(
        `| \`${cell(finding.api)}\` | \`${cell(finding.file)}:${finding.line}\` | ${cell(statusLabel(finding.status))} | ${cell(finding.replacement ?? '-')} | ${cell(finding.risk)} | ${cell(finding.notes ?? '-')} |`,
      );
    }
  }
  lines.push('');

  lines.push('## 可替代 OHPM 库');
  lines.push('');
  if (report.replaceableLibs.length === 0) {
    lines.push('暂无识别到可替代库。');
  } else {
    lines.push('| NPM 包 | 版本 | OHPM 库 | 状态 | 风险 | 备注 |');
    lines.push('|--------|------|---------|------|------|------|');
    for (const dependency of report.replaceableLibs) {
      lines.push(
        `| ${cell(dependency.name)} | ${cell(dependency.resolvedVersion ?? dependency.version)} | ${cell(dependency.ohpm?.name ?? '-')} | ${cell(dependency.ohpm?.status ?? '-')} | ${cell(dependency.risk)} | ${cell(dependency.ohpm?.notes ?? dependency.notes ?? '-')} |`,
      );
    }
  }
  lines.push('');

  lines.push('## 缺失库');
  lines.push('');
  if (report.missingLibs.length === 0) {
    lines.push('暂无识别到 OHPM 缺失库。');
  } else {
    lines.push('| 库 | 版本 | 类别 | 优先级 | 源码引用 | 原因 |');
    lines.push('|----|------|------|--------|----------|------|');
    for (const library of report.missingLibs) {
      lines.push(
        `| ${cell(library.name)} | ${cell(library.version ?? '-')} | ${cell(library.category ?? '-')} | ${cell(library.priority)} | ${library.usageCount > 0 ? '是' : '否'} | ${cell(library.reason)} |`,
      );
    }
  }
  lines.push('');

  if (report.warnings.length > 0) {
    lines.push('## 警告');
    lines.push('');
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function writeReports(report: ScanReport, options: WriteReportOptions = {}): WriteReportResult {
  const outDir = options.outDir ?? process.cwd();
  const jsonPath = options.jsonPath ?? join(outDir, 'report.json');
  const mdPath = options.mdPath ?? join(outDir, 'report.md');

  mkdirSync(dirname(jsonPath), { recursive: true });
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(jsonPath, buildJsonReport(report), 'utf8');
  writeFileSync(mdPath, buildMarkdownReport(report), 'utf8');

  return { jsonPath, mdPath };
}
