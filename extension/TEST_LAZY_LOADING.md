# 测试懒加载修复

## 修改内容

1. **新增滚动函数** `scrollSidebarToLoadAllChats()`
   - 自动滚动侧边栏到底部触发懒加载
   - 智能检测：连续 3 次无新聊天则停止
   - 超时保护：最多 30 秒，最多滚动 50 次

2. **新增查找函数** `findSidebarContainer()`
   - 智能查找侧边栏容器
   - 支持多种选择器策略

3. **修改导出函数** `selectChatsForExport()`
   - 导出前先滚动加载所有聊天
   - 使用 `console.log` 输出详细日志

## 测试步骤

### 1. 重新加载扩展

**Chrome:**
1. 打开 `chrome://extensions/`
2. 找到 "Gemini Chat Exporter"
3. 点击刷新按钮 🔄

**或者在开发者模式:**
1. 打开 `chrome://extensions/`
2. 右上角开启"开发者模式"
3. 找到扩展，点击"重新加载"按钮

### 2. 打开 Gemini 页面

1. 访问 https://gemini.google.com
2. 确保左侧显示聊天列表

### 3. 打开浏览器控制台

**方法 1:** 按 `F12` 或 `Cmd+Option+J` (Mac) / `Ctrl+Shift+J` (Windows/Linux)
**方法 2:** 右键点击页面 → "检查" → 切换到 "Console" 标签

### 4. 点击"导出所有对话"

1. 点击扩展图标
2. 点击"导出所有对话"按钮
3. **观察控制台输出**

## 预期日志输出

你应该看到类似以下的日志：

```
[GCE] selectChatsForExport start {initialChatCount: 10, href: "https://gemini.google.com/..."}
[GCE] scroll start {maxDurationMs: 30000, maxScrollAttempts: 50, scrollStepMs: 150}
[GCE] sidebar found {tag: "NAV", className: "...", scrollHeight: 2000, clientHeight: 600, scrollTop: 0}
[GCE] scroll progress {attempt: 1, scrollTop: 1400, scrollHeight: 2000, clientHeight: 600, chatCount: 15}
[GCE] scroll progress {attempt: 2, scrollTop: 1400, scrollHeight: 2500, clientHeight: 600, chatCount: 20}
[GCE] scroll stable {stableRounds: 1, chatCount: 20}
[GCE] scroll stable {stableRounds: 2, chatCount: 20}
[GCE] scroll stable {stableRounds: 3, chatCount: 20}
[GCE] scroll complete
[GCE] after scrollSidebarToLoadAllChats {loadedChatCount: 20}
[GCE] selectChatsForExport complete {selectedCount: 20}
```

## 可能的问题

### 问题 1: 没有看到任何日志

**原因:** 扩展没有重新加载

**解决:**
1. 确保在 `chrome://extensions/` 点击了重新加载
2. 刷新 Gemini 页面
3. 重新点击扩展图标

### 问题 2: 看到 "Sidebar container not found"

**原因:** 无法找到侧边栏容器

**解决:**
1. 确保 Gemini 页面完全加载
2. 确保左侧聊天列表可见
3. 将完整的控制台日志发给开发者

### 问题 3: 看到日志但侧边栏没有滚动

**原因:** 找到了侧边栏但 scrollTop 没有变化

**解决:**
1. 检查日志中的 `scrollHeight` 和 `clientHeight`
2. 如果 `scrollHeight === clientHeight`，说明没有更多内容可滚动
3. 将日志发给开发者进一步诊断

### 问题 4: 一直在滚动不停止

**原因:** 聊天列表持续加载新内容

**解决:**
- 正常现象，最多滚动 50 次或 30 秒后会自动停止
- 检查日志中的 `attempt` 计数

## 收集日志

如果遇到问题，请复制控制台的完整日志：

1. 在控制台右键
2. 选择"Save as..."或"另存为..."
3. 保存为 `.log` 或 `.txt` 文件
4. 或者全选 (Cmd+A / Ctrl+A) 复制粘贴

## 技术细节

### 滚动逻辑

```typescript
for (let i = 0; i < 50; i++) {
  // 1. 滚动到底部
  sidebar.scrollTop = sidebar.scrollHeight - sidebar.clientHeight;
  
  // 2. 等待 150ms 让新内容加载
  await sleep(150);
  
  // 3. 检查聊天数量是否增加
  const currentCount = parseChatList().length;
  
  // 4. 如果连续 3 次没变化，停止
  if (currentCount === lastCount) {
    stableRounds++;
    if (stableRounds >= 3) break;
  }
}
```

### 侧边栏查找策略

1. 尝试常见选择器：`nav`, `[role="navigation"]`, `.sidebar` 等
2. 检查元素是否包含聊天链接 (`/app/` 或 `/chat/`)
3. 备选：从聊天链接向上遍历 DOM 树查找可滚动容器
