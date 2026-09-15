# 索引与登记规范（Indexing & Registration Standards）

> 用途：deepseek-harness 产品开发的任务/变更/批准/文件索引的统一规范。
> 原则：上游源码永不修改；功能以「内部不公开插件 / 官方 patch / 壳」三种形态实现；
> 一切登记按本规范执行，索引反映真实状态。

## 1. 索引体系总览

| 文件 | 职责 | 粒度 | 更新时机 |
|---|---|---|---|
| `product/config/tasks.json` | 任务目录 + 功能索引（管理视图） | 功能 / 任务 | 任务推进、完成、决策变更时 |
| `product/config/changes.json` | 产品变更记录（发生了什么） | 功能级（一条一个功能） | 任何产品源码/配置变更提交时 |
| `product/config/source-exceptions.json` | overlay 覆盖批准记录 | 功能级（`targets` 数组） | 新增/撤销 overlay 覆盖时 |
| `product/config/overlay-manifest.json` | overlay 文件清单 | 文件级 | overlay 编辑后（rebuild 脚本） |
| `product/config/product-version.json` | 版本号 | — | 发布时 |

## 2. tasks.json 规范

- `schema: "dsh.tasks.v1"`，顶层含 `features`（功能索引）与 `tasks`（任务目录）。
- **编号**：任务 `T01` 起递增，不重用；功能沿用 changes.json 的 id（F01/P01/R01…）。
- **字段**（任务）：
  - `id` / `title` / `status`：`todo | in_progress | done | blocked | reverted`
  - `blockedBy`：blocked 时必须写原因
  - `dependsOn`：依赖的任务 id
  - `scope`：涉及文件/包列表
  - `approach` / `verify`：做法与验收
- **字段**（功能）：`now`（现状实现形态）/ `target`（目标形态）/ `state`（迁移状态）/ `ref`（关联任务）。
- **状态流转**：`todo → in_progress → done`；被阻塞置 `blocked`（写 blockedBy）；撤销置 `reverted`（不删除记录）。
- **更新时机**：任务状态变化、范围变化、决策变化立即更新 `updatedAt`。

## 3. changes.json 规范

- **功能级登记**：一个功能一条记录（不按文件拆分；多文件用 `sourcePaths` 数组）。
- **编号**：`D`（desktop）/ `F`（frontend）/ `P`（plugin）/ `B`（backend）/ `R`（调整与修复）/ `S`（shared）/ `M`（模型目录），数字递增不重用。
- **字段**：`id / area / title / status / owner / sourcePaths / upstreamDependency / updateRule / verify`。
- **状态**：`ACTIVE` / `REVERTED`；REVERTED 必须保留记录并写明 `revertReason`（不重写历史）。
- **更新时机**：产品源码或配置变更提交时；`updatedAt` 同步刷新。

## 4. source-exceptions.json 规范

- **功能级记录**：`targets` 数组列出该功能覆盖的所有上游文件（不再一文件一条）。
- 字段：`id / targets / feature / approvedByUser / approvedAt / reason`。
- **新增 overlay 覆盖必须用户显式批准**（AGENTS.md 规则）；撤销时删除记录并同步 changes.json。
- 目标：随功能迁移为插件/壳，`targets` 逐步清空，最终该文件应无条目。

## 5. overlay-manifest.json 规范

- 由 `product/tools/rebuild-frontend-overlay.mjs` 管理；overlay 编辑后运行刷新。
- **迁移目标**：所有覆盖功能迁为插件/壳后，清单应为空，工具链随之收敛（见 T05）。

## 6. 目录卫生规范

- **根目录禁止**：临时脚本（`_tmp_*`、`hash_compare*`）、日志（`*.log`）、一次性产物。
- 此类文件一律归入 `.workspace/diagnostics/`（可带日期子目录归档）。
- 产品代码/配置/文档只出现在：`product/**`、`plugins/**`、`AGENTS.md`、`package.json`、`pnpm-*.yaml`、`lefthook.yml`。

## 7. 完成标准（DoD）

一个任务视为完成，必须同时满足：
1. 代码/配置变更已生效并验证（Evidence Gate：有当前回合的工具结果背书）
2. `tasks.json` 状态更新为 `done`（或 `reverted`）并刷新 `updatedAt`
3. `changes.json` 已登记（功能级，含上游是否触碰的声明）
4. 若涉及 overlay：`overlay-manifest.json` 刷新、`source-exceptions.json` 同步
5. 上游 `git status` 保持 0 改动

## 8. 实现形态判定（功能落地三选一）

- **内部不公开 client 插件**（首选）：`plugins/**`，slots 注册 + CSS 注入 + DOM 挂钩 + 事件拦截（peak-valley 范式）。
- **官方 patch**：`cordis.patch.yml` 配置层覆盖（insert / config 覆盖）。
- **壳层**：`product/app/desktop/**`（主进程/preload/渲染壳），仅限壳自身功能。
- 禁止：覆盖上游文件（overlay 仅用于过渡，目标清零）；修改 `upstream/**`。

## 9. 插件开发文档位置

- **项目内官方参考副本**：`product/docs/plugins/`（含导航 README；中文为主）
  - 教程：`cordis-tutorial/01-first-plugin.zh.md` 起
  - API：`cordis-api/`
  - 实践：`cookbook/adding-a-conversation-node.zh.md`、`adding-a-settings-card.zh.md` 等
  - 架构/UI：`architecture.zh.md`、`web-styling.zh.md`、`capability-seams.zh.md`
- **上游原始文档**（只读，版本对应）：`upstream/docs/`
- **项目内插件范例**：`plugins/dsh-peak-valley/`（样板）、`plugins/ocgo-tab-ring/`
- 任何插件开发/迁移工作开始前，先读 `product/docs/plugins/README.md`。
