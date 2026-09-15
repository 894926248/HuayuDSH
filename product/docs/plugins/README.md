# 插件开发文档（官方参考）

> 本目录是 DeepSeek Harness 官方插件开发文档的**中文参考副本**，来源：`upstream/docs/`（官方仓库，只读）。
> 用途：产品功能按「内部不公开 client 插件」形态落地时，先读这里；官方文档更新时同步替换本目录（保留文件名）。

## 学习路径（按顺序）

1. **cordis-tutorial/** —— 插件开发教程（从第一个插件开始）
   - `01-first-plugin.zh.md` 第一个插件
   - `02-lifecycle-and-effects.zh.md` 生命周期与副作用
   - `03-services.zh.md` 服务
   - `04-events.zh.md` 事件
   - `05-config.zh.md` 配置
   - `06-composition-and-hmr.zh.md` 组合与热更新
   - `07-into-the-harness.zh.md` 进入 Harness
2. **cordis-primer.zh.md** —— Cordis 概念入门
3. **cordis-api/** —— API 参考（context / events / fiber 等）

## 实践菜谱（cookbook/）—— 产品迁移直接对口

- `adding-a-conversation-node.zh.md` —— 自定义会话消息节点（对应 turn-error / P01 节点导航）
- `adding-a-settings-card.zh.md` —— 设置卡片（对应 P02 模型设置面板）
- `adding-a-tool.zh.md` —— 添加工具
- `adding-an-llm-adapter.zh.md` —— 添加 LLM 适配器
- `adding-a-package.zh.md` —— 添加包

## 架构与 UI

- `architecture.zh.md` —— 一切皆插件架构
- `capability-seams.zh.md` —— 能力接缝（可替换能力）
- `web-styling.zh.md` —— Web UI 样式参考（UI 定制）
- `development.zh.md` —— 开发指南
- `config-catalog.zh.md` —— 配置目录

## 项目内插件范例

- `plugins/dsh-peak-valley/` —— 内置不公开插件（slots 注入 + CSS + DOM，本目录规范的落地样板）
- `plugins/ocgo-tab-ring/` —— 内置不公开插件（额度状态环）

## 注册与索引

- 任务/功能登记：`product/config/tasks.json`（功能索引 + 任务目录）
- 变更登记：`product/config/changes.json`
- 索引规范：`product/docs/agent/indexing.md`
