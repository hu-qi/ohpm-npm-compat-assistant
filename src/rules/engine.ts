import { loadKnowledgeData } from '../knowledge';
import type { ApiMatrixEntry, KnowledgeData, ReplacementEntry } from '../knowledge/types';
import { scanDependencies } from '../scanner/dependencies';
import { scanSource } from '../scanner/source';
import type {
  AnalyzeOptions,
  ApiFinding,
  CompatStatus,
  DependencyFinding,
  MissingLibrary,
  OhpmSuggestion,
  RiskLevel,
  ScanReport,
} from '../types';

const RISK_ORDER: Record<RiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const INCOMPATIBLE_STATUSES = new Set<CompatStatus>(['unsupported', 'partial', 'replaced']);

function maxRisk(risks: RiskLevel[]): RiskLevel {
  let result: RiskLevel = 'none';
  for (const risk of risks) {
    if (RISK_ORDER[risk] > RISK_ORDER[result]) {
      result = risk;
    }
  }
  return result;
}

function normalizeModuleName(module: string): string {
  let name = module.startsWith('node:') ? module.slice('node:'.length) : module;
  if (name.endsWith('/promises')) {
    name = name.slice(0, -'/promises'.length);
  }
  return name;
}

function isSamePackage(module: string, packageName: string): boolean {
  const normalized = normalizeModuleName(module);
  return normalized === packageName || normalized.startsWith(`${packageName}/`);
}

function findModuleEntry(module: string, matrix: ApiMatrixEntry[]): ApiMatrixEntry | undefined {
  const normalized = normalizeModuleName(module);
  if (normalized.endsWith('.node')) {
    return matrix.find((entry) => entry.api === '*.node');
  }
  return matrix.find(
    (entry) => entry.api === normalized && INCOMPATIBLE_STATUSES.has(entry.status),
  );
}

function findApiEntry(api: string, matrix: ApiMatrixEntry[]): ApiMatrixEntry | undefined {
  let best: ApiMatrixEntry | undefined;
  for (const entry of matrix) {
    if (!INCOMPATIBLE_STATUSES.has(entry.status)) {
      continue;
    }
    const matches =
      entry.api === '*.node'
        ? api.endsWith('.node')
        : api === entry.api || api.startsWith(`${entry.api}.`);
    if (!matches) {
      continue;
    }
    if (!best || entry.api.length > best.api.length) {
      best = entry;
    }
  }
  return best;
}

function toApiFinding(entry: ApiMatrixEntry, api: string, file: string, line: number, module?: string): ApiFinding {
  return {
    api,
    module: module ?? entry.module,
    file,
    line,
    status: entry.status as ApiFinding['status'],
    harmonyVersion: entry.harmonyVersion,
    risk: entry.risk,
    replacement: entry.replacement,
    notes: entry.notes,
  };
}

function mappingToSuggestion(name: string, mapping: ReplacementEntry): OhpmSuggestion | undefined {
  if (!mapping.ohpm) {
    return undefined;
  }
  return {
    name: mapping.ohpm,
    status: mapping.status,
    notes: mapping.notes,
  };
}

function evaluateDependency(
  name: string,
  version: string,
  resolvedVersion: string | undefined,
  type: DependencyFinding['type'],
  isNative: boolean,
  usedInSource: boolean,
  importCount: number,
  replacements: Record<string, ReplacementEntry>,
): DependencyFinding {
  const mapping = replacements[name];
  if (mapping) {
    let status: CompatStatus;
    if (mapping.status === 'available') {
      status = 'replaced';
    } else if (mapping.status === 'partial') {
      status = 'partial';
    } else {
      status = 'missing';
    }
    return {
      name,
      version,
      resolvedVersion,
      type,
      status,
      risk: mapping.risk,
      ohpm: mappingToSuggestion(name, mapping),
      notes: mapping.notes,
      usedInSource,
      isNative,
    };
  }

  if (isNative) {
    return {
      name,
      version,
      resolvedVersion,
      type,
      status: 'unsupported',
      risk: 'critical',
      notes: 'Native addon / Node binding cannot run in the HarmonyOS application sandbox.',
      usedInSource,
      isNative,
    };
  }

  return {
    name,
    version,
    resolvedVersion,
    type,
    status: 'unknown',
    risk: importCount > 0 ? 'medium' : 'low',
    notes: 'No OHPM replacement mapping in the knowledge base; manual verification required.',
    usedInSource,
    isNative,
  };
}

export function analyzeProject(
  rootDir: string,
  options: AnalyzeOptions = {},
  knowledge?: KnowledgeData,
): ScanReport {
  const data = knowledge ?? loadKnowledgeData();
  const dependencies = scanDependencies(rootDir);
  const source = scanSource(rootDir);
  const warnings = [...dependencies.warnings, ...source.warnings];
  const harmonyVersion = options.harmonyVersion ?? '6.0.0';

  const dependencyFindings: DependencyFinding[] = dependencies.dependencies.map((dependency) => {
    const importCount = source.imports.filter((item) => isSamePackage(item.module, dependency.name)).length;
    const finding = evaluateDependency(
      dependency.name,
      dependency.version,
      dependency.resolvedVersion,
      dependency.type,
      dependency.isNative,
      importCount > 0,
      importCount,
      data.replacements.replacements,
    );
    if (finding.status === 'unknown') {
      warnings.push(`No OHPM mapping for dependency "${dependency.name}"; manual review required.`);
    }
    return finding;
  });

  const apiFindings: ApiFinding[] = [];
  const apiKeys = new Set<string>();
  const addApiFinding = (finding: ApiFinding): void => {
    const key = `${finding.file}:${finding.line}:${finding.api}`;
    if (apiKeys.has(key)) {
      return;
    }
    apiKeys.add(key);
    apiFindings.push(finding);
  };

  for (const item of source.imports) {
    const entry = findModuleEntry(item.module, data.matrix.entries);
    if (entry) {
      addApiFinding(toApiFinding(entry, entry.api, item.file, item.line, entry.module));
    }
  }

  for (const usage of source.apiUsages) {
    const entry = findApiEntry(usage.api, data.matrix.entries);
    if (entry) {
      addApiFinding(toApiFinding(entry, usage.api, usage.file, usage.line, usage.module));
    }
  }

  const replaceableLibs = dependencyFindings.filter(
    (dependency) => Boolean(dependency.ohpm) && (dependency.status === 'replaced' || dependency.status === 'partial'),
  );

  const missingLibs: MissingLibrary[] = dependencyFindings
    .filter((dependency) => dependency.status === 'missing' || dependency.status === 'unsupported')
    .map((dependency) => {
      const mapping = data.replacements.replacements[dependency.name];
      return {
        name: dependency.name,
        version: dependency.resolvedVersion ?? dependency.version,
        reason: dependency.notes ?? 'No HarmonyOS compatible version found.',
        category: mapping?.category,
        priority: dependency.risk,
        usageCount: dependency.usedInSource ? 1 : 0,
      };
    });

  const allRisks: RiskLevel[] = [
    ...dependencyFindings.map((dependency) => dependency.risk),
    ...apiFindings.map((finding) => finding.risk),
  ];
  const riskLevel = maxRisk(allRisks);

  return {
    schemaVersion: '1.0.0',
    generatedAt: (options.now ?? new Date()).toISOString(),
    tool: {
      name: 'ohpm-npm-compat-assistant',
      version: '0.1.0',
    },
    project: {
      name: dependencies.project.name,
      version: dependencies.project.version,
      path: dependencies.project.path,
      harmonyVersion,
    },
    summary: {
      dependencies: dependencyFindings.length,
      sourceFiles: source.sourceFiles,
      imports: source.imports.length,
      incompatibleApis: apiFindings.length,
      replaceableLibs: replaceableLibs.length,
      missingLibs: missingLibs.length,
      nativeRisks: dependencyFindings.filter((dependency) => dependency.isNative).length,
      riskLevel,
    },
    dependencies: dependencyFindings,
    apiFindings,
    replaceableLibs,
    missingLibs,
    sourceImports: source.imports,
    warnings,
  };
}
