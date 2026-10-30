# Issue #1 任务拆解

## M1 骨架 + 依赖扫描
- [x] TypeScript 工程骨架（package.json / tsconfig / build / test）
- [x] 类型定义与知识库数据文件
- [x] package.json + npm/yarn/pnpm lockfile 依赖扫描
- [x] 依赖扫描单元测试

## M2 源码扫描 + 规则引擎
- [x] TypeScript AST 源码扫描（import/require/API 调用）
- [x] API 兼容矩阵与风险分级
- [x] 源码扫描与规则引擎单元测试

## M3 知识库 + 替代识别 + CLI
- [x] OHPM 替换关系知识库与增量合并
- [x] 缺失库发现
- [x] JSON/Markdown 报告
- [x] `scan` / `suggest` / `matrix` CLI
- [x] fixture 样例工程与标注集
- [x] `accuracy` 准确率门槛
- [x] 集成测试

## M4 Actions + 准确率门槛
- [x] `.github/workflows/compat-scan.yml`
- [x] `.github/workflows/api-matrix.yml`
- [x] `.github/workflows/ohpm-suggest.yml`
- [x] `.github/workflows/accuracy-gate.yml`
- [x] `api-matrix` 数据 diff 回归校验

## M5 发布 + 文档
- [x] `.github/workflows/release.yml`
- [x] README 使用说明与知识库维护说明
- [x] 全量测试通过

## 验收对照
- 依赖扫描 ≥80%：`accuracy` 输出 dependency accuracy。
- 可替代库 =100%：`accuracy` 输出 replaceable accuracy，未达 1.0 直接失败。
- API 识别 ≥80%：`accuracy` 输出 API recall/precision。
- 缺失识别 ≥80%：`accuracy` 输出 missing accuracy。
- 知识库：`src/knowledge/data/ohpm-replacements.json`。
- CLI 报告：`ohpm-compat scan fixtures/sample-project --out artifacts`。
- Actions：5 个 YAML。
- 测试：`npm test`。
