# @deepseek-ai/dsh-desktop

[English](README.md) | 中文

DeepSeek Harness 的 Electron 桌面壳。壳负责原生窗口、单实例激活、嵌入式 Web Profile 和隔离的 preload 桥接；渲染器复用 [`apps/web`](../web/README.md)。

## 命令

从仓库根目录先构建 Web 和宿主产物，再执行：

```sh
pnpm run desktop:dev
pnpm run desktop:package
pnpm run desktop:dist
```

`desktop:package` 生成未安装的应用目录，`desktop:dist` 按 `package.json` 中的配置生成固定名称的 Windows 便携版可执行文件。

便携版不压缩 Electron 运行时，以保证重新打壳足够快；因此生成的 exe 体积会更大，这是预期行为。

发布文件名固定为 `DeepSeek Harness.exe`。便携启动器运行时可能先把自身解压到 `%TEMP%`，这个路径只是运行细节，快捷方式不能指向它。使用 `pnpm --filter @deepseek-ai/dsh-desktop run repair-shortcut` 创建或修复桌面快捷方式；修复任务栏固定项时，把现有的其他 `.lnk` 路径一并传入。脚本会写入稳定目标、图标和 `System.AppUserModel.ID`（`ai.deepseek.harness`），让固定快捷方式和运行窗口归入同一个任务栏分组。

任务栏和窗口使用同一套 DSH 原始图标 `apps/web/public/favicon.svg` 的浅色／深色栅格资源，并按渲染器解析出的主题切换。便携版可执行文件和快捷方式继续嵌入由同一 DSH 资源生成的稳定 `build/icon.ico` 身份，因此切换主题不会改变 exe 或快捷方式目标。便携包包含 Electron 壳，以及从锁定上游 `@deepseek-ai/dsh` 部署出的生产运行时闭包，其中包括构建后的前端、后端、配置、插件、worker 和原生运行时依赖。electron-builder 复制前会把 workspace 链接实体化。校验会使用临时 `DSH_HOME` 启动解包资源中的 `lib/bin.js`，并解析标准 preset 的全部 entry。

非当前会话完成时，通用 Web 会话列表会把这个状态投影给桌面壳。Windows 会让固定的应用任务栏按钮闪烁，并显示一个小红色覆盖标记；窗口获得焦点或完成提醒被消费后，标记会清除。这部分是壳拥有的操作系统表现，插件 entry 不需要加入任务栏逻辑，也不会被修改。

桌面壳会从内置官方运行时闭包导入官方 Profile 启动模块，并在 Electron 主进程内挂载未修改的 Web Profile。壳通过官方命令行服务关闭默认浏览器跳转，再由渲染器加载这个应用内部的 loopback 地址。`3080` 是这个一体化应用专用的固定端口；壳不会自动附着到其他程序占用的端口。`DSH_DESKTOP_HOST_URL` 只保留给开发诊断使用。官方功能层派生的工具通过 `ELECTRON_RUN_AS_NODE=1` 继承 Electron 的 Node 兼容模式。

第二次启动获取不到第二实例锁时，会把激活动作发送给已有进程；已有窗口恢复、显示、获得焦点，并短暂闪烁任务栏。渲染器保持隔离上下文，关闭 Node 集成，外部链接交给系统浏览器。名为 `dsh-github-oauth` 的弹窗是例外：它留在 Electron 内，以便 GitHub 授权回调返回 Harness。

渲染器现有的 `light`／`dark`／`system` 主题仍是颜色权威。它经 preload IPC 上报计算后的背景色和文字色，让原生标题栏随自定义调色板变化，Electron 主进程不维护第二套调色板。Web Profile 加载期间原生窗口保持不透明，因此启动失败不会只留下标题栏控件并露出桌面。

渲染器的 `document.title` 仍是当前会话名称的权威来源。原生窗口标题在产品默认标题下使用 `DeepSeek Harness`，遇到非默认页面标题时使用 `DeepSeek Harness -` 前缀；同一个值会经 preload IPC 同步给原生 `BrowserWindow` 标题。可见的桌面标题栏固定显示 `DeepSeek Harness` 产品标识。主进程只接受有长度上限且不含换行的标题值。

渲染器把桌面标题栏放在 `#root` 之前的正常布局流中。插件自己拥有的 slot 仍然位于 `#root` 内，不会被桌面壳覆盖或替换；壳层为位于顶层、贴右侧且覆盖大部分视口的固定插件面板，以及已识别的 `dsh-better-sidebar` 切换控件组保留标题栏内缩；浏览器控件、其他插件工具栏、全窗口覆盖层和普通插件内容保持不变。标题栏与侧边栏共用 `--dsw-specific-sidebar-fill`；框架经中心工作列左上角圆角露出该 token，工作区继续使用基础表面。

桌面外壳拥有一组精简的原生右键菜单。可编辑输入框提供复制、剪切、粘贴和全选，并在存在选区时提供删除；普通选中的文本只提供复制；图片提供复制和图片另存为。编辑命令由外壳显式执行，菜单不显示键盘快捷键提示，也不加入导航、开发者工具、拼写检查或插件专属命令。
