# Gemini Chat Exporter 调试指南

本指南基于当前代码库的真实实现整理，重点覆盖以下场景：

- 当前聊天导出失败
- “全部历史” / “选择导出”时会话列表不完整
- Options 页面静默同步异常
- 批量删除或 Web 同步删除失败
- PDF 预渲染 / Ghost 页导出异常
- Popup 成功提示（Toast）频率异常

## 1. 当前版本的关键能力

当前代码库已经具备：

- Popup 导出格式：`Markdown / PDF / HTML / TXT`
- 输出模式：`下载文件 / 复制到剪贴板`
- 一键发送到 **NotebookLM**
- Options 页面：
  - 本地缓存聊天列表
  - 搜索与筛选
  - 静默同步 Web 会话 `SYNC_WEB_SESSIONS`
  - 批量导出
  - 批量删除
  - 可选同步删除 Gemini Web 中的聊天
- Review Toast：仅在累计成功次数达到 **8 / 15 / 30** 时显示；点过评分链接后永久静音

## 2. 常用本地验证命令

```bash
npm test
npm run build:production
npm run build:debug
npm run build:firefox
npm run build:chrome
npm run type-check
npm run lint
```

如果你正在排查 **Gemini 生成图片导不出 / Ghost PDF 页只看到附件占位**，推荐直接跑这一组最相关的命令：

```bash
npm test -- tests/content-image-extractor.test.js tests/current-chat-pdf-images.test.js tests/ghost-export-tab-flow.test.js tests/language-and-message-handler.test.js
npm run build:firefox
```

如果你想边改边验证 Firefox 包，可用：

```bash
npm run build:firefox
```

如果你想在**编译时关闭“用户输入图片导出”能力**，可以加环境变量：

```bash
ENABLE_USER_INPUT_IMAGE_EXPORT=false npm run build:firefox
ENABLE_USER_INPUT_IMAGE_EXPORT=false npm run build:chrome
```

现在也可以直接使用交互式脚本：

```bash
npm run build:production
npm run build:debug
```

脚本会在构建前询问你是否开启“用户输入图片导出”功能；如果要编译 Firefox 版本，可以配合环境变量：

```bash
BROWSER_TARGET=firefox npm run build:production
BROWSER_TARGET=firefox npm run build:debug
```

默认不传时为开启状态；开启后当前构建也**只会导出用户输入/上传的图片**，不会再尝试导出 Gemini 生成图。

如果你要做一次完整收口验证：

```bash
npm test && npm run build:firefox
```

如果只是快速验证最近改动，至少先跑：

```bash
npm run build:firefox
```

## 3. 如何开启调试日志

### 方法 A：URL 参数

在 Gemini 页面 URL 后追加：

```text
?gce_debug=1
```

例如：

```text
https://gemini.google.com/app?gce_debug=1
```

### 方法 B：Local Storage 开关

在 Gemini 页面控制台执行：

```javascript
localStorage.setItem('gce_debug', '1');
location.reload();
```

关闭调试：

```javascript
localStorage.removeItem('gce_debug');
location.reload();
```

### 生效范围

`gce_debug` 主要控制 Content Script 中的提取调试日志，前缀为：

```text
[GCE][extract]
```

### Ghost 页预览开关（默认关闭）

当前 `ghost.html` 在成功调用 `saveAsPDF` 后会**默认自动关闭**，避免每次 PDF 导出都残留一个预览页。

如果你需要保留 `ghost.html` 现场做排查，可以在扩展的 **Service Worker Console / Popup Console** 执行：

```javascript
await browser.storage.local.set({ gce_keep_ghost_preview_open: true });
```

关闭并恢复默认自动关闭：

```javascript
await browser.storage.local.remove('gce_keep_ghost_preview_open');
```

或者显式关闭：

```javascript
await browser.storage.local.set({ gce_keep_ghost_preview_open: false });
```

开启后：

- Background 打开 `ghost.html` 时会附带保留预览参数
- Ghost 页顶部会显示调试提示条
- `saveAsPDF` 成功后不会自动关闭，方便观察 DOM / 样式 / 控制台日志

同时，仓库中还有一批默认就会输出的日志，例如：

- `[GCE] selectChatsForExport ...`
- `[GCE] scroll ...`
- `[GCE][background] ...`
- `[DELETE] ...`
- `[Popup] ...`

### Ghost 页详细日志（默认关闭）

如果你想保留 Ghost 页默认自动关闭行为，但又希望看到更详细的 Ghost 导出日志，可以开启：

```javascript
await browser.storage.local.set({ gce_ghost_debug_logging: true });
```

关闭：

```javascript
await browser.storage.local.remove('gce_ghost_debug_logging');
```

或显式关闭：

```javascript
await browser.storage.local.set({ gce_ghost_debug_logging: false });
```

这会输出更详细的 Ghost 页日志，例如：

- HTML 注入后的 DOM 快照
- 附件图片数量与 src 预览
- 每张图片的 `load / error / decode / timeout`
- `saveAsPDF` 前的图片等待结果

## 4. 日志前缀与含义

### Content Script / 提取流程

调试模式日志前缀：

```text
[GCE][extract]
```

常见事件：

- `extract-start`
- `extract-success`
- `extract-error`
- `extract-no-messages`
- `payload-reduced`
- `scroll-root-from-message-ancestor`
- `scroll-root-from-main-ancestor`
- `scroll-root-from-interaction-root`
- `collect-start`
- `collect-no-native-scroll-range`
- `top-phase-progress`
- `top-phase-stable-stop`
- `collect-finish`
- `virtual-scroll-up-dispatched`

### 侧边栏选择 / 滚动日志

默认日志前缀：

```text
[GCE]
```

常见事件：

- `selectChatsForExport start`
- `after scrollSidebarToLoadAllChats`
- `selectChatsForExport complete`
- `scroll start`
- `found potential scroll targets`
- `scroll stable`
- `scroll loaded more chats`
- `scroll complete`
- `scroll timeout`
- `scroll error`

### Background / 调度层

常见前缀：

- `[GCE][background]`
- `[PDF]`
- `[BatchExport]`
- `[DELETE]`
- `[ContentScript]`

### Popup / Options

常见前缀：

- `[Popup] Failed to update review prompt storage:`
- `[Popup] Failed to persist review click flag:`
- `Auto sync failed:`
- `[Options] Failed to save settings:`

### 图片提取 / 远程抓图

调试前缀：

```text
[GCE][images]
```

常见事件：

- `fetch attempt`
- `fetch returned non-ok response`
- `fetch failed`
- `fetched image successfully`
- `converted image from DOM pixels`
- `attempting remote fetch fallback`
- `falling back to original remote URL`
- `image did not become ready in time`

### 背景图片兜底（Firefox 重点）

当前代码在 **Background fetch 全部失败后**，还会尝试一个新的“导航式兜底”：

- 后台临时打开图片 URL
- 等待标签页加载完成
- 在临时页内把图片转成 `data:` URL
- 成功后关闭临时标签页

这一路径的日志前缀仍然是：

```text
[GCE][background][images]
```

你应该能看到这些新增日志之一：

- `navigation fallback unavailable because browser.scripting.executeScript is not supported`
- `navigation fallback could not create a temporary tab`
- `navigation fallback extracted image via temporary tab`
- `navigation fallback did not produce a valid image payload`
- `navigation fallback failed`

如果你在 Firefox 里看到的日志仍然只有：

- `fetch attempt`
- `fetch failed`
- `All background image fetch strategies failed`

但**完全没有任何 `navigation fallback ...` 日志**，通常说明你当前加载的仍是**旧版构建产物**，还没有把最新修复重新打包并重新加载到浏览器。

遇到这种情况，请至少执行：

```bash
npm run build:firefox
```

然后在 Firefox 扩展管理页中：

- 重新加载临时附加组件 / 本地扩展
- 关闭旧的 Gemini 页面并重新打开
- 再次导出并观察是否出现新的 `navigation fallback ...` 日志

### Ghost PDF 页

常见前缀：

```text
[Ghost]
```

常见事件：

- `attachment images after inject`
- `image scan`
- `image already ready`
- `image decode rejected`
- `image wait finished`
- `image wait summary`
- `saveAsPDF phase starting`

## 5. 典型排查路径

### A. 当前聊天导出失败 / “No chat detected”

优先关注：

```text
[GCE][extract] extract-start
[GCE][extract] collect-start
[GCE][extract] collect-finish
[GCE][extract] extract-success
[GCE][extract] extract-no-messages
[GCE][extract] extract-error
```

排查建议：

1. 确认当前标签页是 `https://gemini.google.com/*`
2. 确认进入了真实对话页，不是首页空状态
3. 开启 `gce_debug`
4. 重新执行一次导出，核对是否有 `extract-success`

常见原因：

- DOM 结构变化导致消息选择器未命中
- 页面仍在虚拟渲染，消息未完全加载
- 消息体过大，触发 `payload-reduced`，图片被主动剥离以减少运行时消息压力

### B. “选择导出”或“全部历史”时，会话列表不完整

优先关注：

```text
[GCE] selectChatsForExport start
[GCE] scroll start
[GCE] found potential scroll targets
[GCE] scroll loaded more chats
[GCE] scroll stable
[GCE] scroll complete
[GCE] after scrollSidebarToLoadAllChats
```

当前实现中的关键参数：

- `maxDurationMs = 60000`
- `maxScrollAttempts = 150`
- `scrollStepMs = 400`
- 连续 `15` 轮无增长视为稳定

典型异常：

1. **未找到滚动容器**

```text
[GCE] scroll error { error: 'No potential sidebar containers found' }
```

2. **数量一直 stable，但始终很少**

```text
[GCE] scroll stable { stableRounds: 10, chatCount: 12 }
```

3. **有增长，但最终仍少于预期**

这通常说明真正负责滚动的节点还没被命中，或者停止条件相对偏早。

### C. Options 页面静默同步失败

优先关注：

```text
Auto sync failed:
[ContentScript] Failed to inject content script:
```

当前流程是：

1. 先 `GET_CACHED_SESSIONS` 秒开本地缓存
2. 再后台触发 `SYNC_WEB_SESSIONS`
3. 成功后刷新列表

如果失败，请确认：

- Gemini 标签页是否打开
- Background Service Worker 是否正常
- Content Script 是否已成功注入

### D. 批量删除时 Web 同步删除失败

优先关注：

```text
[DELETE] No active Gemini tab found to delete chat ...
[DELETE] Failed to delete chat ... from web:
[DELETE] Successfully deleted chat ... from web
```

说明：

- 本地删除与 Web 删除是分层处理的
- 即使 Web 删除失败，本地缓存删除也可能已经成功
- 若 Gemini 标签页未打开，往往只会完成本地删除

### E. PDF 导出异常

优先关注：

```text
[GCE][background] opening ghost export tab
[GCE][background] ghost tab created
[PDF] Pre-rendered PDF is empty/invalid, fallback to jsPDF
[PDF] HTML chat-view render failed, fallback to jsPDF:
[Gemini Chat Exporter] PDF render error:
```

说明：

- 当前 PDF 流程优先尝试 Ghost 页 / HTML 预渲染
- 失败后自动回退到 jsPDF
- Ghost 页现在默认会在 `saveAsPDF` 成功后自动关闭；如需保留预览，请打开 `gce_keep_ghost_preview_open`
- 若最终仍失败，需要继续看 Ghost 页创建、渲染和回退链路哪个环节出了问题

### F. Popup 成功 Toast 弹出频率异常

当前规则：

- 成功计数达到 `8 / 15 / 30` 时才提示
- 用户点击评分链接后永久不再提示

涉及的扩展存储字段：

- `exportSuccessCount`
- `hasClickedReview`

相关日志：

```text
[Popup] Failed to update review prompt storage:
[Popup] Failed to persist review click flag:
```

这些错误一般不会阻止导出本身，只会影响 Toast 的频率控制。

## 6. 浏览器侧的手动调试建议

### Firefox

1. 打开 `about:debugging#/runtime/this-firefox`
2. 找到扩展并点击“重新加载”
3. 分别检查：
  - Gemini 页面 Console
  - Popup Console
  - Options Console

### Chrome / Chromium

1. 打开 `chrome://extensions/`
2. 开启开发者模式
3. 重新加载扩展
4. 分别检查：
  - Service Worker Console
  - Popup Console
  - Options Console
  - Gemini 页面 Console

## 7. 提交 Issue 时建议附带的信息

建议至少提供：

1. 浏览器与版本
2. 扩展构建来源：`dist/firefox` 或 `dist/chrome`
3. 复现步骤
4. 关键日志片段
5. 是否开启了 `gce_debug`
6. 故障场景属于哪类：
  - 当前聊天导出
  - 历史列表滚动加载
  - Options 静默同步
  - 批量删除
  - PDF 导出
  - Review Toast

推荐复制这些日志：

- `extract-start`
- `collect-start`
- `collect-finish`
- `extract-success` / `extract-error`
- `scroll start`
- 最后几条 `scroll stable` / `scroll loaded more chats`
- `scroll complete`
- `opening ghost export tab`
- `[DELETE] ...`

## 8. 文档归并说明

本文件已经覆盖并更新了：

- Firefox 手动调试步骤
- 侧边栏懒加载调试要点
- 常见导出 / 同步 / 删除 / PDF / Toast 故障排查入口

因此，仓库中如果还有仅描述某次阶段性联调、旧日志名或旧参数的调试文档，通常可以安全下线，避免与当前代码相互矛盾。
