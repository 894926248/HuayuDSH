# dsh-conversation-navigator

独立的 Codex 风格对话节点插件：每条用户消息一个短横线节点，悬停显示预览，点击只跳转聊天正文，导航器自己的滚轮只移动超出范围的节点窗口。

这个插件不修改 `upstream/`，也不进入 `product/app/frontend/source/`。它通过 `dsh.client` 的浏览器半和 `conversation.input.dock` 插槽挂载；宿主半用会话投影保存完整用户消息索引。

## 本地安装

```powershell
node .workspace/artifacts/staging/runtime/apps/cli/lib/bin.js plugin --profile web add "C:/Users/89492/Desktop/deepseek-harness/plugins/dsh-conversation-navigator"
```

重启 Web profile 后生效。卸载：

```powershell
node .workspace/artifacts/staging/runtime/apps/cli/lib/bin.js plugin --profile web remove dsh-conversation-navigator
```

## 交互边界

- 每条用户消息对应一个节点；节点以 12px 密集节奏排列，可见上限按视窗高度计算并保持奇数格。
- 节点轨道按聊天滚动区左边缘与正文列左边缘的真实中点定位，正文右侧详情列不会参与计算。
- 当前消息始终保持一条短白节点；鼠标悬停时只在附近显示五节点范围的长度/透明度过渡和对应消息预览，悬停中心使用灰色延展态，不产生第二条白线；点击只负责跳转，离开悬停后其余节点恢复普通状态。
- 导航轨自己的滚轮只移动超出可见范围的节点窗口，不改变选中节点，也不带动右侧正文滚动。
- 点击节点只在聊天滚动容器内居中定位对应用户消息，并保留历史消息的完整投影索引。
- 打开会话、重连或流式重试后，后台自动补齐正文的旧历史页；左侧节点索引与聊天正文不会再出现一边完整、一边只剩尾页的状态。
