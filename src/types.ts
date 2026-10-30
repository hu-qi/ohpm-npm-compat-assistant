export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'none';

export type CompatStatus = 'supported' | 'partial' | 'unsupported' | 'replaced' | 'missing' | 'unknown';

export type DependencyType =
  | 'dependencies'
  | 'devDependencies'
  | 'peerDependencies'
  | 'optionalDependencies';

export type LockfileFormat = 'npm' | 'yarn' | 'pnpm' | 'none';

export interface DependencyInfo {
  name: string;
  version: string;
  type: DependencyType;
  resolvedVersion?: string;
  isNative: boolean;
  isDirect: true;
}

export interface DependencyScanResult {
  project: {
    name: string;
    version?: string;
    path: string;
  };
  dependencies: DependencyInfo[];
  transitiveDependencies: number;
  lockfileFormat: LockfileFormat;
  warnings: string[];
}

export type ImportKind = 'import' | 'require' | 'dynamic-import';

export interface SourceImport {
  module: string;
  file: string;
  line: number;
  kind: ImportKind;
}

export interface ApiUsage {
  api: string;
  module?: string;
  file: string;
  line: number;
  snippet?: string;
}

export interface SourceScanResult {
  sourceFiles: number;
  imports: SourceImport[];
  apiUsages: ApiUsage[];
  warnings: string[];
}

export interface OhpmSuggestion {
  name: string;
  status: 'available' | 'partial' | 'missing';
  version?: string;
  url?: string;
  notes?: string;
}

export interface DependencyFinding {
  name: string;
  version: string;
  resolvedVersion?: string;
  type: DependencyType;
  status: CompatStatus;
  risk: RiskLevel;
  ohpm?: OhpmSuggestion;
  notes?: string;
  usedInSource: boolean;
  isNative: boolean;
}

export interface ApiFinding {
  api: string;
  module?: string;
  file: string;
  line: number;
  status: Exclude<CompatStatus, 'supported' | 'unknown' | 'missing'>;
  harmonyVersion: string;
  risk: RiskLevel;
  replacement?: string;
  notes?: string;
}

export interface MissingLibrary {
  name: string;
  version?: string;
  reason: string;
  category?: string;
  priority: RiskLevel;
  usageCount: number;
}

export interface ScanSummary {
  dependencies: number;
  sourceFiles: number;
  imports: number;
  incompatibleApis: number;
  replaceableLibs: number;
  missingLibs: number;
  nativeRisks: number;
  riskLevel: RiskLevel;
}

export interface ScanReport {
  schemaVersion: string;
  generatedAt: string;
  tool: {
    name: string;
    version: string;
  };
  project: {
    name: string;
    version?: string;
    path: string;
    harmonyVersion: string;
  };
  summary: ScanSummary;
  dependencies: DependencyFinding[];
  apiFindings: ApiFinding[];
  replaceableLibs: DependencyFinding[];
  missingLibs: MissingLibrary[];
  sourceImports: SourceImport[];
  warnings: string[];
}

export interface AnalyzeOptions {
  harmonyVersion?: string;
  now?: Date;
}
