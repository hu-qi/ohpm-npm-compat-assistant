# Issue #1 方案设计

## 1. 总体架构

```
CLI (src/cli)
  -> analyzer orchestration
     -> scanner/dependencies  (package.json + lockfile)
     -> scanner/source        (TypeScript AST)
     -> rules/engine          (兼容矩阵 + 替换映射 + 风险分级)
        -> knowledge          (JSON 数据文件加载/更新)
     -> report                (JSON + Markdown)
  -> accuracy                 (fixture 标注集校验)
```

依赖方向单向：`cli → scanner → rules → knowledge → report`，避免循环依赖。

## 2. 模块设计

### 2.1 scanner/dependencies

- 读取目标工程 `package.json`，四类依赖（dependencies/devDependencies/peerDependencies/optionalDependencies）。
- 读取 lockfile 解析 `name -> resolvedVersion`：
  - npm v2/v3：`packages["node_modules/x"].version`，v1：`dependencies[x].version`。
  - yarn v1：`name@range` + `version "x"`。
  - pnpm：`/name@version` 键。
- 原生模块识别：内建高风险原生包清单 + `node-gyp` / `prebuild` / `node-pre-gyp` 安装脚本标记。
- 输出 `DependencyScanResult`（含 warning，未知格式不阻塞）。

### 2.2 scanner/source

- 使用 `typescript.createSourceFile` 解析 `.ts/.tsx/.js/.jsx/.mjs/.cjs`，跳过 `node_modules/dist/.git/coverage`。
- 建立模块绑定表：
  - `import fs from 'fs'`、`import * as fs from 'fs'`、`import { readFile } from 'fs'`。
  - `const fs = require('fs')`、解构 `const { promises: fsp } = require('fs')`。
- 遍历 AST 收集：
  - import/require/动态 import → `SourceImport`。
  - 成员链 `fs.promises.readFile` → `fs.promises.readFile`；全局 `window.localStorage.getItem` → 尝试最长前缀匹配矩阵。
  - 直接调用 `fetch(...)`、`new XMLHttpRequest()`。
- 模块级内置模块导入（`fs`、`crypto` 等）生成模块级 API 使用记录，由矩阵匹配。

### 2.3 rules/engine

- 加载 `api-matrix.json` 与 `ohpm-replacements.json`。
- 依赖规则：映射存在则取 OHPM 状态；原生模块无映射 → unsupported/high；未知包 → unknown 并进入 warning。
- API 规则：矩阵中仅 `unsupported/partial/replaced` 进入 `apiFindings`；按最长 API 前缀匹配。
- 风险分级：critical/high/medium/low/none；汇总取最高风险。
- 输出 `ScanReport`（依赖、API、可替代库、缺失库、摘要）。

### 2.4 knowledge

- `loadApiMatrix()` / `loadOhpmReplacements()`：从 `dist/src/knowledge/data` 读取，编译时由脚本复制。
- `mergeKnowledgeBase()`：`suggest --update-kb` 将扫描发现的缺失/替代关系合并进知识库，保留已有条目。
- 数据结构带 `schemaVersion`、`updatedAt`，可直接 PR diff。

### 2.5 report

- `buildJsonReport(report)`：稳定字段、2 空格缩进。
- `buildMarkdownReport(report)`：摘要表、依赖表、不兼容 API 表、可替代库、缺失库、警告。
- `writeReports()`：按 `--out` / `--json` / `--md` 写文件。

### 2.6 accuracy

- 读取 `fixtures/annotations/*.expected.json`，对每个 case 运行分析器。
- 指标：
  - dependency：期望依赖按 name（及标注的 status）匹配。
  - replaceable：期望可替代库的 OHPM 名称必须完全一致。
  - api：按 `api + file` 匹配，计算 precision/recall。
  - missing：按库名匹配。
- 聚合为 micro 指标；任一门槛未达 → 退出码 1。

### 2.7 CLI

- `scan <path> [--out dir] [--json file] [--md file] [--harmony-version 6.0.0] [--print]`
- `suggest [path] [--json file] [--md file] [--update-kb file]`
- `accuracy [--fixtures dir] [--json file]`
- `matrix [--check] [--base ref]`

## 3. 数据设计

`api-matrix.json` 条目：

```json
{
  "api": "fs.readFile",
  "module": "fs",
  "kind": "node",
  "status": "replaced",
  "harmonyVersion": "6.0.0+",
  "replacement": "@ohos.file.fs",
  "risk": "high",
  "notes": "使用 @ohos.file.fs 的同步/异步文件接口"
}
```

`ohpm-replacements.json` 条目：`ohpm`、`status`（available/partial/missing）、`risk`、`notes`、`category`。

## 4. 测试策略

- 单元测试：依赖解析、源码 AST、规则引擎、报告、知识库合并、准确率评估、矩阵 diff。
- fixture 集成测试：样例工程扫描输出 JSON/MD，断言关键字段。
- 准确率门槛测试：`accuracy` 在标注集上通过默认门槛。

## 5. CI 设计

- `compat-scan`：push/PR/手动，构建并扫描 fixture，上传报告 artifact。
- `api-matrix`：PR 变更矩阵时校验 schema 并对比 base 分支矩阵，阻断非法删除/降级。
- `ohpm-suggest`：手动/定时扫描并更新替换知识库，自动创建 PR。
- `accuracy-gate`：push/PR 运行准确率门槛。
- `release`：tag 触发构建、测试、`npm pack` 并上传 release assets。

## 6. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 兼容矩阵覆盖不足 | 高频 API 优先，数据文件化增量补齐，标注集回归 |
| 替代映射要求 100% | 静态映射 + accuracy 强校验 + 明确缺失状态 |
| 锁文件格式差异 | npm 完整支持，yarn/pnpm 解析失败降级为 package.json + warning |
| AST 误报 | 绑定表 + 最长前缀匹配 + 只输出矩阵命中的非兼容项 |
