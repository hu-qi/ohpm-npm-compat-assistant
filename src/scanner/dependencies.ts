import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DependencyInfo,
  DependencyScanResult,
  DependencyType,
  LockfileFormat,
} from '../types';

const DEPENDENCY_TYPES: DependencyType[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

export const KNOWN_NATIVE_PACKAGES = new Set([
  'bcrypt',
  'better-sqlite3',
  'canvas',
  'fsevents',
  'node-sass',
  'node-canvas',
  'sharp',
  'sqlite3',
  'sodium-native',
  'bufferutil',
  'utf-8-validate',
  'leveldown',
  'zeromq',
  'grpc',
  'node-gyp',
  'node-pre-gyp',
  'prebuild-install',
]);

interface PackageJson {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface LockParseResult {
  versions: Map<string, string>;
  format: LockfileFormat;
  warnings: string[];
}

function readPackageJson(rootDir: string): PackageJson {
  const file = join(rootDir, 'package.json');
  if (!existsSync(file)) {
    throw new Error(`Cannot scan dependencies: package.json not found in ${rootDir}`);
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as PackageJson;
  } catch (error) {
    throw new Error(`Cannot parse package.json in ${rootDir}: ${(error as Error).message}`);
  }
}

function extractNameFromNodeModulesPath(path: string): string | undefined {
  const marker = 'node_modules/';
  const index = path.lastIndexOf(marker);
  if (index === -1) {
    return undefined;
  }
  const name = path.slice(index + marker.length);
  if (!name || name.includes('/node_modules/')) {
    return undefined;
  }
  return name;
}

function collectNpmDependencies(
  dependencies: Record<string, { version?: string; dependencies?: unknown }> | undefined,
  target: Map<string, string>,
): void {
  if (!dependencies) {
    return;
  }
  for (const [name, meta] of Object.entries(dependencies)) {
    if (meta?.version) {
      target.set(name, meta.version);
    }
    if (meta?.dependencies && typeof meta.dependencies === 'object') {
      collectNpmDependencies(
        meta.dependencies as Record<string, { version?: string; dependencies?: unknown }>,
        target,
      );
    }
  }
}

function parseNpmLock(text: string, target: Map<string, string>): void {
  const lock = JSON.parse(text) as {
    packages?: Record<string, { version?: string }>;
    dependencies?: Record<string, { version?: string; dependencies?: unknown }>;
  };

  if (lock.packages) {
    for (const [key, value] of Object.entries(lock.packages)) {
      if (!key.startsWith('node_modules/')) {
        continue;
      }
      const name = extractNameFromNodeModulesPath(key);
      if (name && value.version) {
        target.set(name, value.version);
      }
    }
  }

  if (lock.dependencies) {
    collectNpmDependencies(lock.dependencies, target);
  }
}

function splitYarnSpec(header: string): string | undefined {
  const firstSpec = header.split(',')[0]?.trim().replace(/^"|"$/g, '');
  if (!firstSpec) {
    return undefined;
  }
  if (firstSpec.startsWith('@')) {
    const slash = firstSpec.indexOf('/');
    const at = firstSpec.indexOf('@', slash);
    return at === -1 ? firstSpec : firstSpec.slice(0, at);
  }
  const at = firstSpec.indexOf('@');
  return at === -1 ? firstSpec : firstSpec.slice(0, at);
}

function parseYarnLock(text: string, target: Map<string, string>): void {
  const lines = text.split(/\r?\n/);
  let currentName: string | undefined;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    if (!rawLine.startsWith(' ') && line.endsWith(':')) {
      currentName = splitYarnSpec(line.slice(0, -1));
      continue;
    }
    const versionMatch = /^version\s+"?([^"\s]+)"?$/.exec(line);
    if (currentName && versionMatch) {
      target.set(currentName, versionMatch[1]);
      currentName = undefined;
    }
  }
}

function parsePnpmLock(text: string, target: Map<string, string>): void {
  const pattern = /^\s{2}\/?((?:@[^/\s]+\/)?[^@\s:]+)@([^:\s(]+)/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const name = match[1];
    const version = match[2];
    if (name && version && !name.includes(':')) {
      target.set(name, version);
    }
  }
}

function parseLockfile(rootDir: string, warnings: string[]): LockParseResult {
  const versions = new Map<string, string>();
  const candidates: Array<{ file: string; format: LockfileFormat; parser: (text: string, target: Map<string, string>) => void }> = [
    { file: 'package-lock.json', format: 'npm', parser: parseNpmLock },
    { file: 'yarn.lock', format: 'yarn', parser: parseYarnLock },
    { file: 'pnpm-lock.yaml', format: 'pnpm', parser: parsePnpmLock },
  ];

  for (const candidate of candidates) {
    const file = join(rootDir, candidate.file);
    if (!existsSync(file)) {
      continue;
    }
    try {
      candidate.parser(readFileSync(file, 'utf8'), versions);
      return { versions, format: candidate.format, warnings };
    } catch (error) {
      warnings.push(`Failed to parse ${candidate.file}: ${(error as Error).message}`);
    }
  }

  return { versions, format: 'none', warnings };
}

function detectProjectNative(rootDir: string, pkg: PackageJson): boolean {
  const scripts = Object.values(pkg.scripts ?? {}).join(' ');
  if (/(node-gyp|node-pre-gyp|prebuild-install)/i.test(scripts)) {
    return true;
  }
  const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  return ['node-gyp', 'node-pre-gyp', 'prebuild-install', 'bindings'].some((name) => name in allDeps);
}

export function scanDependencies(rootDir: string): DependencyScanResult {
  const pkg = readPackageJson(rootDir);
  const warnings: string[] = [];
  const lock = parseLockfile(rootDir, warnings);
  if (lock.format === 'none') {
    warnings.push('No supported lockfile found; dependency versions fall back to package.json ranges.');
  }

  if (detectProjectNative(rootDir, pkg)) {
    warnings.push('Project uses native build tooling (node-gyp/prebuild); native addons cannot run on HarmonyOS.');
  }
  const dependencies: DependencyInfo[] = [];

  for (const type of DEPENDENCY_TYPES) {
    const section = pkg[type];
    if (!section) {
      continue;
    }
    for (const [name, version] of Object.entries(section)) {
      const resolvedVersion = lock.versions.get(name);
      const isNative = KNOWN_NATIVE_PACKAGES.has(name);
      dependencies.push({
        name,
        version,
        type,
        resolvedVersion,
        isNative,
        isDirect: true,
      });
    }
  }

  const directNames = new Set(dependencies.map((dependency) => dependency.name));
  const transitiveDependencies = [...lock.versions.keys()].filter((name) => !directNames.has(name)).length;

  return {
    project: {
      name: pkg.name ?? 'unknown-project',
      version: pkg.version,
      path: rootDir,
    },
    dependencies,
    transitiveDependencies,
    lockfileFormat: lock.format,
    warnings,
  };
}
