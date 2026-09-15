# plugins/ — 本地插件目录

这个目录是 **DeepSeek Harness 项目内本地、私人和第三方插件的固定目录**。以后新做的插件统一放在这里，不再散落到项目根目录、桌面或 `scratch-plugin/`。

## 目录规范

每个插件一个子目录，目录名使用 `kebab-case`：

```text
plugins/
├── README.md
├── _template/                  # 新建插件时复制这个模板
├── dsh-market/                 # 固定到上游提交的第三方插件子模块
└── <plugin-name>/
    ├── src/
    │   └── index.ts            # 插件入口：export name / inject / apply
    ├── cordis.yml              # 本地加载用的 overlay
    └── README.md               # 插件说明（可选）
```

## 新建插件

1. 推荐直接用脚手架创建（会自动放到 `plugins/` 下并生成可用的绝对路径）：

   ```bash
   pnpm run plugin:create -- my-plugin
   ```

   也可以手动复制模板：

   ```bash
   cp -r plugins/_template plugins/my-plugin
   ```

   Windows PowerShell：

   ```powershell
   Copy-Item -Recurse plugins/_template plugins/my-plugin
   ```

2. 编写 `plugins/my-plugin/src/index.ts`，例如：

   ```ts
   import type { Context } from '@deepseek-ai/cordis'

   export const name = 'my-plugin'

   export function apply(ctx: Context) {
     // 在这里通过 ctx 注册工具、事件、服务等。
   }
   ```

3. 修改 `plugins/my-plugin/cordis.yml`，把 `name` 改成插件入口文件的**绝对路径**（脚手架生成时会自动写好）：

   ```yaml
   - insert:
       - id: my-plugin
         name: 'C:/绝对/路径/deepseek-harness/plugins/my-plugin/src/index.ts'
   ```

4. 从仓库根目录启动 Web UI 并加载插件：

   ```bash
   pnpm dsh web --patch ./plugins/my-plugin/cordis.yml
   ```

5. 开发完成后，如果要把插件打包成可安装 bundle，参考
   [`docs/user/develop/basic/publish.md`](../docs/user/develop/basic/publish.md)
   添加 `package.json` 和 `dsh.bundle`。

## 约定

- 一个插件一个子目录，目录名用 `kebab-case`。
- 不要把插件文件直接散落在 `plugins/` 根目录。
- 第三方插件仓库使用 Git submodule 固定到 `plugins/<plugin-name>/`；其上游、提交和本地改动仍由该插件自己的 Git 工作树管理。
- 项目唯一根目录是 `C:\Users\89492\Desktop\deepseek-harness`。不要在 `C:\Users\89492\Desktop` 直接创建 DSH 插件、构建目录、下载目录或临时目录。
- 需要依赖框架服务时，用 `inject` 声明，例如 `export const inject = ['tools']`。
- 所有注册都通过 `ctx` 完成；插件卸载时框架会自动清理注册。
- 本地调试用 `--patch ./plugins/<name>/cordis.yml`；正式分发用 `dsh plugin add` 安装 bundle。

## 相关文档

- [Your first plugin](../docs/user/develop/basic/index.md)
- [Build a tool](../docs/user/develop/basic/tool.md)
- [Plugin configuration](../docs/user/develop/basic/config.md)
- [Package and install a plugin](../docs/user/develop/basic/publish.md)
