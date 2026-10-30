# OHPM/NPM 三方库兼容性扫描与适配助手

扫描 NPM 依赖与源码调用，识别 HarmonyOS 6.0.0+ 下的不兼容 API 与运行时风险，检索可替代 OHPM 库，输出 JSON/Markdown 结构化迁移建议，并沉淀可增量维护的替换关系知识库。

## 特性

- **依赖扫描**：`package.json` + `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml`，识别直接依赖、解析版本、原生模块与传递依赖。
- **源码扫描**：基于 TypeScript AST 识别 `import` / `require` / 动态 `import()` 与 Node/Browser/原生 API 调用（支持别名与解构）。
- **兼容矩阵**：数据文件维护 Node/Browser/原生 API → HarmonyOS 6.0.0+ 状态、替代方案与风险等级。
- **OHPM 替代识别**：NPM 包 → OHPM 库映射，输出可替代库与缺失库。
- **结构化报告**：JSON + Markdown 双格式。
- **准确率门槛**：fixture 标注集驱动，四项准确率自动校验。
- **GitHub Actions**：compat-scan / api-matrix / ohpm-suggest / accuracy-gate / release。

## 安装与构建

```bash
npm ci
npm run build
npm test
```

本地调试可直接运行 `node dist/src/cli/index.js <command>`，安装后使用 `ohpm-compat <command>`。

## CLI 用法

### 扫描项目

```bash
ohpm-compat scan fixtures/sample-project --out artifacts
```

输出 `artifacts/report.json` 与 `artifacts/report.md`。也可分别指定：

```bash
ohpm-compat scan ./my-app --json report.json --md report.md --harmony-version 6.0.0
```

### 替代建议与知识库更新

```bash
ohpm-compat suggest fixtures/sample-project
ohpm-compat suggest fixtures/sample-project --update-kb src/knowledge/data/ohpm-replacements.json
```

`--update-kb` 会保留已有条目，仅增量补充扫描发现的新包（缺失项标记为 `missing`）。

### 准确率校验

```bash
ohpm-compat accuracy --fixtures fixtures --json artifacts/accuracy.json
```

默认门槛：依赖扫描 ≥ 80%、可替代库识别 = 100%、API 召回/精确率 ≥ 80%、缺失识别 ≥ 80%。任一未达退出码为 1。

### 兼容矩阵校验

```bash
ohpm-compat matrix --check
ohpm-compat matrix --check --base origin/main
```

`--base` 会对比 base 分支的矩阵，阻断非法删除、重复 API 与状态降级。

## 报告结构

```json
{
  "schemaVersion": "1.0.0",
  "summary": {
    "dependencies": 8,
    "incompatibleApis": 6,
    "replaceableLibs": 5,
    "missingLibs": 2,
    "riskLevel": "high"
  },
  "dependencies": [],
  "apiFindings": [],
  "replaceableLibs": [],
  "missingLibs": [],
  "warnings": []
}
```

## 知识库维护

| 文件 | 用途 |
|------|------|
| `src/knowledge/data/api-matrix.json` | Node/Browser/原生 API → HarmonyOS 兼容矩阵 |
| `src/knowledge/data/ohpm-replacements.json` | NPM 包 → OHPM 替代库映射 |

两个文件均为 JSON，可直接在 PR 中增量新增条目；`api-matrix` 与 `accuracy-gate` 流水线会做回归校验。

### 新增 API 矩阵条目

```json
{
  "api": "fs.readFile",
  "module": "fs",
  "kind": "node",
  "status": "replaced",
  "harmonyVersion": "6.0.0+",
  "replacement": "@ohos.file.fs",
  "risk": "high",
  "notes": "使用 @ohos.file.fs 的文件读写接口"
}
```

### 新增替换关系

```json
{
  "axios": {
    "ohpm": "@ohos/axios",
    "status": "available",
    "risk": "low",
    "category": "network",
    "notes": "OHPM 提供同名能力封装"
  }
}
```

## Fixtures 与标注集

- `fixtures/sample-project`：包含可替代库、缺失库、Node/Browser API 与原生模块的样例工程。
- `fixtures/annotations/*.expected.json`：准确率标注集，`accuracy` 命令据此计算指标。

## GitHub Actions

| Workflow | 触发 | 作用 |
|----------|------|------|
| `compat-scan.yml` | push / PR / 手动 | 扫描 fixture，上传 JSON/MD 报告 |
| `api-matrix.yml` | PR 变更矩阵 / 手动 | 校验矩阵 schema 与 base diff |
| `ohpm-suggest.yml` | 手动 / 定时 | 扫描并更新替换知识库，自动建 PR |
| `accuracy-gate.yml` | push / PR / 手动 | 运行准确率门槛 |
| `release.yml` | tag `v*` | 构建、测试、打包并上传 release assets |

## 非目标

不自动改写用户代码、不实现 OHPM 库适配本身、不提供 IDE 插件 / Web UI、不扫描私有依赖源。
