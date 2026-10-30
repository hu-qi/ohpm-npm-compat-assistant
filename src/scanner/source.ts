import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, posix } from 'node:path';
import ts from 'typescript';
import type { ApiUsage, ImportKind, SourceImport, SourceScanResult } from '../types';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', '.next', 'build', 'out']);

const GLOBAL_ROOTS = new Set([
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'navigator',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Buffer',
  'process',
  'global',
  'globalThis',
  'FileReader',
  'Blob',
  'alert',
  'requestAnimationFrame',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'console',
  'JSON',
  'Math',
  'Date',
  'Promise',
  '__dirname',
  '__filename',
]);

interface Binding {
  module: string;
  member?: string;
}

interface ImportTarget {
  module: string;
  prefix?: string;
}

function normalizeImport(specifier: string): ImportTarget {
  let module = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
  if (module.endsWith('/promises')) {
    module = module.slice(0, -'/promises'.length);
    return { module, prefix: 'promises' };
  }
  return { module };
}

function joinMember(module: string, prefix: string | undefined, member: string | undefined): string {
  return [module, prefix, member].filter((part) => Boolean(part)).join('.');
}

function collectFiles(rootDir: string, warnings: string[]): string[] {
  const files: string[] = [];

  function walk(current: string): void {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      warnings.push(`Cannot read directory ${current}: ${(error as Error).message}`);
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        walk(join(current, entry.name));
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        files.push(join(current, entry.name));
      }
    }
  }

  walk(rootDir);
  return files.sort();
}

function relativeFile(rootDir: string, file: string): string {
  return posix.join(...file.slice(rootDir.length + 1).split(/[\\/]/));
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function stringLiteralValue(node: ts.Node | undefined): string | undefined {
  if (!node) {
    return undefined;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function buildChain(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  if (ts.isPropertyAccessExpression(node)) {
    const base = buildChain(node.expression);
    return base ? `${base}.${node.name.text}` : undefined;
  }
  if (ts.isElementAccessExpression(node)) {
    const base = buildChain(node.expression);
    const key = stringLiteralValue(node.argumentExpression);
    return base && key ? `${base}.${key}` : undefined;
  }
  return undefined;
}

function isInnerMember(node: ts.Node): boolean {
  const parent = node.parent;
  return Boolean(
    parent && (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)),
  );
}

function collectBindings(
  sourceFile: ts.SourceFile,
  fileName: string,
  imports: SourceImport[],
  bindings: Map<string, Binding>,
): void {
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const module = node.moduleSpecifier.text;
      imports.push({ module, file: fileName, line: lineOf(sourceFile, node), kind: 'import' });
      const target = normalizeImport(module);
      const clause = node.importClause;
      if (clause) {
        if (clause.name) {
          bindings.set(clause.name.text, { module: target.module, member: target.prefix });
        }
        const named = clause.namedBindings;
        if (named && ts.isNamespaceImport(named)) {
          bindings.set(named.name.text, { module: target.module, member: target.prefix });
        } else if (named && ts.isNamedImports(named)) {
          for (const element of named.elements) {
            const imported = element.propertyName?.text ?? element.name.text;
            const member = imported === 'default' ? target.prefix : joinMember('', target.prefix, imported);
            bindings.set(element.name.text, {
              module: target.module,
              member: member || undefined,
            });
          }
        }
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push({
        module: node.moduleSpecifier.text,
        file: fileName,
        line: lineOf(sourceFile, node),
        kind: 'import',
      });
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      const module = stringLiteralValue(node.arguments[0]);
      if (module) {
        imports.push({ module, file: fileName, line: lineOf(sourceFile, node), kind: 'require' });
        const target = normalizeImport(module);
        const parent = node.parent;
        if (parent && ts.isVariableDeclaration(parent)) {
          if (ts.isIdentifier(parent.name)) {
            bindings.set(parent.name.text, { module: target.module, member: target.prefix });
          } else if (ts.isObjectBindingPattern(parent.name)) {
            for (const element of parent.name.elements) {
              if (!ts.isIdentifier(element.name)) {
                continue;
              }
              const imported = element.propertyName && ts.isIdentifier(element.propertyName)
                ? element.propertyName.text
                : element.name.text;
              bindings.set(element.name.text, {
                module: target.module,
                member: joinMember('', target.prefix, imported) || undefined,
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function collectUsages(
  sourceFile: ts.SourceFile,
  fileName: string,
  bindings: Map<string, Binding>,
  usages: ApiUsage[],
): void {
  function add(api: string, module: string | undefined, node: ts.Node): void {
    usages.push({
      api,
      module,
      file: fileName,
      line: lineOf(sourceFile, node),
      snippet: node.getText(sourceFile).slice(0, 160),
    });
  }

  function resolveMemberChain(chain: string): { api: string; module?: string } | undefined {
    const parts = chain.split('.');
    const root = parts[0];
    const rest = parts.slice(1);
    const binding = bindings.get(root);
    if (binding) {
      const member = [binding.member, ...rest].filter(Boolean).join('.');
      return {
        api: joinMember(binding.module, undefined, member) || binding.module,
        module: binding.module,
      };
    }
    if (GLOBAL_ROOTS.has(root)) {
      return { api: chain };
    }
    return undefined;
  }

  function visit(node: ts.Node): void {
    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      !isInnerMember(node)
    ) {
      const chain = buildChain(node);
      if (chain) {
        const resolved = resolveMemberChain(chain);
        if (resolved) {
          add(resolved.api, resolved.module, node);
        }
      }
    } else if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (name !== 'require' && name !== 'import') {
          const binding = bindings.get(name);
          if (binding) {
            add(joinMember(binding.module, undefined, binding.member) || binding.module, binding.module, node);
          } else if (GLOBAL_ROOTS.has(name)) {
            add(name, undefined, node);
          }
        }
      }
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        // dynamic import is recorded by collectBindings only when it is a require-like call;
        // handled in collectImports below.
      }
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      const binding = bindings.get(name);
      if (binding) {
        add(joinMember(binding.module, undefined, binding.member) || binding.module, binding.module, node);
      } else if (GLOBAL_ROOTS.has(name)) {
        add(name, undefined, node);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function collectDynamicImports(
  sourceFile: ts.SourceFile,
  fileName: string,
  imports: SourceImport[],
): void {
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const module = stringLiteralValue(node.arguments[0]);
      if (module) {
        imports.push({
          module,
          file: fileName,
          line: lineOf(sourceFile, node),
          kind: 'dynamic-import' as ImportKind,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

export function scanSource(rootDir: string): SourceScanResult {
  const warnings: string[] = [];
  const files = collectFiles(rootDir, warnings);
  const imports: SourceImport[] = [];
  const apiUsages: ApiUsage[] = [];

  for (const file of files) {
    const fileName = relativeFile(rootDir, file);
    const content = readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(
      fileName,
      content,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const bindings = new Map<string, Binding>();
    collectBindings(sourceFile, fileName, imports, bindings);
    collectDynamicImports(sourceFile, fileName, imports);
    collectUsages(sourceFile, fileName, bindings, apiUsages);
  }

  const seen = new Set<string>();
  const deduped = apiUsages.filter((usage) => {
    const key = `${usage.file}:${usage.line}:${usage.api}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return {
    sourceFiles: files.length,
    imports,
    apiUsages: deduped,
    warnings,
  };
}
