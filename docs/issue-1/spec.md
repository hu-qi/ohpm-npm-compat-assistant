# Issue #1 需求文档：OHPM/NPM 三方库兼容性扫描与适配助手

## 1. 背景与目标

前端/跨端开发者迁移 HarmonyOS 时，需要人工判断 NPM 依赖、Node API、浏览器 API、原生模块是否可用，并手工检索 OHPM 替代库。本工具提供可演示 CLI，自动扫描项目依赖与源码调用，识别不兼容 API 与运行时风险，推荐 OHPM 替代库，并输出 JSON/Markdown 结构化迁移报告与机器可读的替换关系知识库。

## 2. 用户与场景

- 迁移 HarmonyOS 的前端/跨端开发者。
- 三方库适配者，用于发现高频但 OHPM 侧缺失的库。
- CI 维护者，通过 GitHub Actions 对兼容矩阵与准确率做回归。

## 3. 功能需求

1. **依赖扫描**：解析 `package.json` 及 `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml`，得到直接依赖、解析版本、原生模块标记与传递依赖数量。
2. **源码扫描**：基于 TypeScript AST 识别 `import` / `require` / 动态 `import()`，以及 Node/Browser/原生 API 调用（支持别名、解构、成员链）。
3. **规则引擎**：用数据文件维护 Node/Browser/原生 API → HarmonyOS 6.0.0+ 兼容矩阵，输出状态（unsupported/partial/replaced）与风险等级。
4. **OHPM 替代识别**：用数据文件维护 NPM 包 → OHPM 替代库映射，输出可替代库、缺失库与迁移备注。
5. **缺失库发现**：汇总 OHPM 侧缺失或仅部分可用的三方库，给出优先级。
6. **报告**：`scan` 对目标工程输出 JSON 与 Markdown；`suggest` 输出替代建议并可增量更新替换关系知识库。
7. **准确率校验**：fixture 标注集驱动，计算依赖扫描、替代识别、API 识别、缺失识别的准确率/召回率，并按门槛退出非 0。
8. **CLI**：`scan`、`suggest`、`accuracy`、`matrix` 子命令。
9. **GitHub Actions**：`compat-scan`、`api-matrix`、`ohpm-suggest`、`accuracy-gate`、`release` 五条流水线。

## 4. 非功能需求

- TypeScript + Node.js（>=18），CommonJS 输出，零运行时第三方依赖（AST 使用 TypeScript 编译器 API）。
- 兼容矩阵、替换关系知识库均为 JSON 数据文件，可通过 PR 增量更新。
- CLI 可在 CI 与本地一次性执行，不启动长驻服务。
- 报告结构稳定，带 `schemaVersion`，便于下游消费。

## 5. 验收标准

| 验收项 | 门槛 | 校验方式 |
|--------|------|---------|
| 依赖扫描正确率 | ≥ 80% | `accuracy` 对标注集计算 |
| 可替代鸿蒙库识别正确率 | = 100% | 标注集逐一比对 OHPM 映射 |
| 不兼容 API 识别率 | ≥ 80% | 标注集计算召回率（同时校验精确率） |
| 三方库鸿蒙版缺失识别率 | ≥ 80% | 标注集计算 |
| 替换关系知识库 | 存在且机器可读 | `src/knowledge/data/ohpm-replacements.json`，`suggest --update-kb` 可累积 |
| CLI JSON + Markdown 报告 | 通过 | `scan fixtures/sample-project --out <dir>` |
| 5 条 Actions | 通过 | `.github/workflows/` 下 5 个 YAML |
| 测试 | 全通过 | `npm test` |

## 6. 非目标

- 不自动改写用户代码。
- 不实现 OHPM 库适配本身。
- 不做 IDE 插件 / Web UI。
- 不扫描私有依赖源。
