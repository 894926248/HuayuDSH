# ocgo-tab-ring

OpenCodeGo / Command Code 额度进度圈插件。

## 效果

- 在左侧栏底部“设置”同一行的右侧显示一个紧凑的进度环；环内不显示数字，高亮弧线按所有额度窗口中的最高已用百分比显示，颜色按已用率分级。
- 鼠标悬停打开额度悬浮窗，点击可固定窗口；标题两侧的左右箭头在同一个窗口内切换 OpenCodeGo 和 Command Code：
  - OpenCodeGo 显示 5h / 每周 / 每月窗口、token、花费和按模型统计。
  - Command Code 显示账户、当前套餐、5h / 每周 / 每月 credits 窗口、token、花费和按模型区域；下半段与 OpenCodeGo 完全使用“总消耗 token → 五行 token 明细 → 按模型”的排版，token 使用 M/K 单位。账户总量和花费来自 API Key 查询；API Key 报告若提供模型分组则直接使用，本地会话只有在输入/输出总量与 API 汇总一致时才用于补充模型归属。没有可验证的模型明细时，按模型区域显示账户总计，不把数值分配给模型。官网 Studio 的逐请求模型明细属于网页登录态接口，插件不读取或保存浏览器 Cookie。每月窗口按套餐月总额计算已用百分比，缺少套餐总额时显示当前余额。
  - 进度环和悬浮窗跟随当前选中的套餐，选择会保存在当前浏览器中。
- 两套用量在环挂载后同时预取并每 2 分钟后台刷新；切换套餐直接使用最近一次结果，不等待弹窗打开后才请求。
- 两套数据都通过本插件的 `/ocgo-tab-ring/api` Host 接口提供；Command Code Host 侧按 provider 配置解析 `COMMANDCODE_API_KEY`（或自定义 `apiKeyEnv`），直接调用官方 `/alpha/*` API，不读取浏览器 Cookie。
- 自动读取本机已配置的 OpenCodeGo Key（`~/.local/share/opencode/auth.json` 或 `OPENCODE_DATA_DIR`）。

## 安装

在 DeepSeek Harness 仓库根目录执行：

```bash
dsh plugin --profile web add ./plugins/ocgo-tab-ring
```

然后首次启动或重启 `dsh web`，让 Host 路由和已安装的 provider 进入 Web profile。

首次安装需要让 Web profile 加载 Host 路由；之后只修改 Client 代码时，通过客户端 HMR 或刷新页面生效，不需要重启 Harness 服务。

## 卸载

```bash
dsh plugin --profile web remove ocgo-tab-ring
```

## 文件

```text
plugins/ocgo-tab-ring/
├── package.json
├── cordis.patch.yml
├── index.js        # Host：读取 Key、官方额度和 Harness 本地统计 + /ocgo-tab-ring/api
├── client-opencodego.js # Client：双套餐额度进度环 + 液态玻璃悬浮窗
└── README.md
```

## 说明

- OpenCodeGo 卡片样式和数据口径以官方 usage 接口为准，进度环不显示数字，按当前套餐窗口中的最高已用百分比显示弧线和状态颜色；标题显示已用百分比。
- Command Code 需要产品内置的 `dsh-commandcode-provider` 已加载并配置 API Key；插件通过 credentials 服务在每次查询时解析该 Key，不复制或持久化密钥，也不依赖 provider Remote。
- Command Code API Key 的官方用量接口提供账户汇总、额度窗口和套餐信息，不提供 Studio 逐请求模型明细；模型明细只在 API 返回分组或本地模型统计与账户总量完全一致时显示，否则在按模型区域显示账户总计。
- 插件自带 Host 接口自动读取本机 OpenCodeGo 凭据，并从 Harness 持久化统计中恢复 OpenCode Go 的详细用量。
- 花费按当前 OpenCodeGo 价格估算：输入 `$0.44/M`、输出/推理 `$1.32/M`、缓存读 `$0.014/M`、缓存写 `$0/M`。
- 额度接口短暂失败时，悬浮窗保留最近一次有效的详细 token 统计，只显示额度查询错误；Host 统计接口暂不可用时，客户端会从 `session.list` 识别 OpenCode Go 会话后兜底恢复 token 汇总。
