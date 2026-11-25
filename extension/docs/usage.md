# Gemini Chat Exporter — 使用文档

## 简介

Gemini Chat Exporter 是一款浏览器扩展，可将 [Gemini](https://gemini.google.com) AI 对话一键导出为 **Markdown** 或 **PDF** 格式，支持本地保存或直接上传到 **Google Drive**。

---

## 安装

### 开发环境安装

```bash
# 克隆项目
git clone <repo-url>
cd chat_exporter

# 安装依赖
npm install

# 构建 Chrome 版本
npm run build:chrome

# 构建 Firefox 版本
npm run build:firefox
```

### 加载到浏览器

**Chrome：**
1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `dist/chrome` 目录

**Firefox：**
1. 打开 `about:debugging#/runtime/this-firefox`
2. 点击「临时载入附加组件」
3. 选择 `dist/firefox` 目录下的 `manifest.json`

> ⚠️ 不要选择项目根目录的 `manifest.json`。Firefox 临时加载必须使用构建产物中的 `dist/firefox/manifest.json`。

---

## 基本使用

### 一键导出当前对话

1. 打开 [gemini.google.com](https://gemini.google.com) 并进入一个对话
2. 点击浏览器工具栏中的扩展图标，打开 **Popup 面板**
3. 选择导出格式：
   - 📝 **Markdown** — 生成含 FrontMatter 元数据的 `.md` 文件
   - 📄 **PDF** — 生成含封面页的精美 PDF 文档
4. 选择保存方式：
   - 💾 **本地下载** — 触发浏览器下载
   - ☁️ **Google Drive** — 直接上传到云端硬盘
5. 点击 **「导出当前对话」** 按钮
6. 等待状态栏显示 ✅ 完成

### 批量管理与导出

1. 在 Popup 面板中点击 **「打开管理面板」**（或右键扩展图标 → 选项）
2. 进入 **Options 全屏管理页面**
3. 在聊天列表中：
   - 🔍 使用搜索栏按关键字过滤（支持正则表达式）
   - ☑️ 勾选要导出的对话（或点击「全选」）
   - 点击顶栏的 **📝 Markdown** 或 **📄 PDF** 按钮批量导出

### 修改设置

在 Options 页面左侧导航栏点击 **⚙️ 设置**，可配置：

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| 语言 | 界面语言（中文 / English） | 中文 |
| 默认导出格式 | Popup 打开时的默认格式 | Markdown |
| 默认保存位置 | Popup 打开时的默认存储目标 | 本地下载 |
| 包含封面页 | PDF 是否生成封面 / Markdown 是否生成标题区 | 开启 |
| 图片质量 | 导出图片的 JPEG 压缩质量 | 80% |
| 图片最大宽度 | 超出此宽度的图片将等比缩小 | 1200px |

---

## 导出格式说明

### Markdown 格式

输出的 `.md` 文件包含：

```markdown
---
title: "对话标题"
author: "你的名字"
date: 2026-03-12T10:30:00.000Z
url: https://gemini.google.com/chat/xxx
model: "Gemini 2.0"
---

# 对话标题

> **Author:** 你的名字
> **Date:** 2026/3/12 10:30:00
> **Model:** Gemini 2.0
> **Source:** [链接](https://gemini.google.com/chat/xxx)

---

### 🧑 **User**

你的提问内容...

---

### 🤖 **Gemini**

模型的回复内容（保留代码块、列表、表格等格式）...

<img src="data:image/jpeg;base64,..." alt="conversation image" />

---
```

### PDF 格式

输出的 `.pdf` 文件包含：

- **封面页**（可选）：居中大标题、作者名、日期、模型版本
- **正文**：
  - User 消息：浅蓝色背景
  - Gemini 回复：浅绿色背景
  - 图片直接嵌入段落中
  - 自动分页处理

---

## Google Drive 配置

首次使用 Google Drive 功能需完成 OAuth 授权：

1. 点击导出时选择 ☁️ **Google Drive**
2. 浏览器会弹出 Google 登录窗口
3. 选择账号并授权访问 "Google Drive 文件" 权限
4. 授权完成后自动上传

> **注意：** 该扩展仅申请 `drive.file` 权限，只能访问由扩展自身创建的文件，无法读取你 Drive 中的其他文件。

### 自定义 OAuth Client ID

如果你是开发者，需要配置自己的 Google OAuth Client ID：

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 创建项目 → 启用 Google Drive API
3. 创建 OAuth 2.0 客户端 ID（类型：Chrome 扩展 / Web 应用）
4. 将 Client ID 填入 `manifest.json` 的 `oauth2.client_id` 字段

---

## 开发指南

### 项目命令

```bash
# 开发模式
npm run dev

# 类型检查
npm run type-check

# 构建 Chrome 版本
npm run build:chrome

# 构建 Firefox 版本
npm run build:firefox

# 代码检查
npm run lint
```

### 项目结构概览

```
src/
├── types/          # 类型定义（数据字典 + 消息协议）
├── shared/         # 共享工具（常量、浏览器 API 封装）
├── content/        # Content Script（DOM 解析、图片提取）
├── exporters/      # 导出器（Markdown、PDF）
├── storage/        # 存储（本地下载、Google Drive、IndexedDB）
├── background/     # Background Service Worker
├── i18n/           # 多语言翻译文件
├── popup/          # Popup 面板（React）
├── options/        # Options 管理页面（React）
└── styles/         # 全局样式
```

### 添加新导出格式

1. 在 `src/exporters/` 下创建新文件，实现 `IExporter` 接口
2. 在 `src/exporters/index.ts` 的工厂函数中注册
3. 在 `UserSettings.defaultExportFormat` 类型中添加新选项
4. 在 UI 组件中添加对应按钮

### 添加新存储目标

1. 在 `src/storage/` 下创建新文件，实现 `IStorage` 接口
2. 在 `src/storage/index.ts` 的工厂函数中注册
3. 在 `UserSettings.defaultStorage` 类型中添加新选项

---

## 常见问题

**Q: 点击导出按钮后提示"当前页面未检测到对话"？**
A: 请确保当前标签页打开的是 `gemini.google.com` 的对话页面（不是首页）。刷新页面后重试。

**Q: 导出的图片显示不完整？**
A: 部分图片可能因跨域限制无法提取。可尝试先在页面中完整加载所有图片后再导出。

**Q: PDF 中文显示为方块？**
A: jsPDF 默认字体不支持中文。后续版本将支持自定义字体嵌入。当前建议中文内容优先使用 Markdown 格式导出。

**Q: Google Drive 上传失败？**
A: 检查是否已正确配置 OAuth Client ID，以及是否已授权 Google 账号。

**Q: Firefox 临时加载时报错 `_locales/en/messages.json` not found，或 `background.type` unexpected？**
A: 这是因为加载了项目根目录的 `manifest.json`。请先执行 `npm run build:firefox`，再在 Firefox 中选择 `dist/firefox/manifest.json`。
