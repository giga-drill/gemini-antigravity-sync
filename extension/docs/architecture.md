# Gemini Chat Exporter — 系统架构设计文档

## 1. 项目概述

Gemini Chat Exporter 是一款基于 **Manifest V3** 规范的跨浏览器扩展（Chrome / Firefox），用于将 Gemini AI 对话导出为 Markdown 或 PDF 格式，支持本地下载或上传至 Google Drive。

### 技术栈

| 层面 | 技术选型 |
|------|---------|
| 构建工具 | Vite 6 |
| UI 框架 | React 19 + TypeScript 5 |
| 样式方案 | Tailwind CSS 4 |
| 多语言 | react-i18next（支持运行时切换） |
| PDF 生成 | jsPDF（无 DOM 依赖，兼容 Service Worker） |
| 本地数据库 | IndexedDB (idb 库) |
| 跨浏览器兼容 | webextension-polyfill |

---

## 2. 整体系统架构

系统分为 **三个物理层级**，通过消息总线解耦通信：

```
┌─────────────────────────────────────────────────────────────┐
│                      UI 层 (React)                          │
│  ┌──────────────┐   ┌──────────────────────────────────┐    │
│  │ Popup Panel  │   │ Options Page (全屏管理面板)        │    │
│  │ - 一键导出    │   │ - 聊天列表 / 搜索 / 多选批量导出   │    │
│  │ - 格式选择    │   │ - 用户设置面板                     │    │
│  └──────┬───────┘   └───────────────┬──────────────────┘    │
│         │     browser.runtime       │                       │
│         │       .sendMessage        │                       │
└─────────┼───────────────────────────┼───────────────────────┘
          ▼                           ▼
┌─────────────────────────────────────────────────────────────┐
│              通信与调度层 (Background Service Worker)          │
│                                                             │
│  ┌────────────────┐  ┌────────────┐  ┌──────────────────┐   │
│  │ Message Router │  │ Task Mgr   │  │ IndexedDB Cache  │   │
│  │ 消息路由分发    │→ │ 导出任务调度 │→ │ 会话缓存/搜索    │   │
│  └────────────────┘  └─────┬──────┘  └──────────────────┘   │
│                            │                                │
│                   ┌────────┼────────┐                       │
│                   ▼        ▼        ▼                       │
│           ┌───────────┐ ┌──────┐ ┌──────────────┐           │
│           │ Exporter  │ │Local │ │ Google Drive  │           │
│           │ MD / PDF  │ │Save  │ │ Storage      │           │
│           └───────────┘ └──────┘ └──────────────┘           │
└─────────────────────────────────────────────────────────────┘
          │  browser.tabs.sendMessage
          ▼
┌─────────────────────────────────────────────────────────────┐
│              数据采集层 (Content Script)                      │
│                                                             │
│  ┌─────────────┐  ┌─────────────────┐  ┌────────────────┐   │
│  │ DOM Parser  │  │ Image Extractor │  │ Metadata       │   │
│  │ 对话文本提取  │  │ 图片→Base64     │  │ 用户名/模型版本 │   │
│  └─────────────┘  └─────────────────┘  └────────────────┘   │
│                                                             │
│  注入目标: https://gemini.google.com/*                       │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 与原设计文档的关键差异

| 原设计 | 优化后 | 原因 |
|--------|--------|------|
| Popup 做 CS↔BG 中继 | BG 统一调度，转发消息给 CS | 降低 Popup 复杂度，Popup 关闭不影响任务 |
| `browser.i18n.getMessage` | react-i18next | 支持运行时语言切换 |
| `localforage` | `idb` 库 | 更轻量，TypeScript 类型更好 |
| `pdfmake` / `@react-pdf/renderer` | `jsPDF` | 无 DOM 依赖，可在 Service Worker 中运行 |
| 无错误处理 | 全链路错误捕获 + 状态广播 | 健壮性 |
| 无进度通知 | Task Manager + 进度广播 | 用户体验 |
| 无消息时间戳 | ChatMessage.timestamp | 消息粒度完整 |

---

## 3. 核心数据字典

### 3.1 ChatSession（对话会话）

```typescript
interface ChatSession {
  id: string;               // 对话唯一标识 (来自 URL)
  title: string;            // 对话标题
  author: string;           // 登录用户名
  url: string;              // 对话页面 URL
  createDate?: number;      // 对话创建时间
  exportDate: number;       // 导出时间戳
  modelVersion?: string;    // Gemini 模型版本
  messages: ChatMessage[];  // 消息列表
}
```

### 3.2 ChatMessage（单条消息）

```typescript
interface ChatMessage {
  role: 'user' | 'model';
  content: string;           // Markdown 或纯文本
  images: string[];          // Base64 data URL 数组
  timestamp?: number;        // 消息时间戳
}
```

### 3.3 ChatSessionSummary（列表展示用摘要）

```typescript
interface ChatSessionSummary {
  id: string;
  title: string;
  author: string;
  url: string;
  messageCount: number;
  createDate?: number;
  exportDate: number;
  modelVersion?: string;
}
```

### 3.4 UserSettings（用户设置）

```typescript
interface UserSettings {
  language: 'zh-CN' | 'en-US';
  defaultExportFormat: 'markdown' | 'pdf';
  defaultStorage: 'local' | 'google-drive';
  includeCover: boolean;
  imageQuality: number;       // 0.1 - 1.0
  maxImageWidth: number;      // 最大宽度 px
}
```

### 3.5 ExportTask（导出任务）

```typescript
type ExportTaskStatus = 'pending' | 'extracting' | 'exporting' | 'uploading' | 'done' | 'error';

interface ExportTask {
  id: string;
  sessionId: string;
  sessionTitle: string;
  format: 'markdown' | 'pdf';
  storage: 'local' | 'google-drive';
  status: ExportTaskStatus;
  progress: number;          // 0 - 100
  error?: string;
}
```

---

## 4. 模块详细设计

### 4.1 数据抓取模块（Content Script）

**目录：** `src/content/`

| 子模块 | 文件 | 职责 |
|--------|------|------|
| DOM Parser | `dom-parser.ts` | 多级选择器降级匹配，解析对话气泡文本，保留 Markdown 格式 |
| Image Extractor | `image-extractor.ts` | Canvas API 转 Base64，压缩控制，跳过装饰性图片 |
| Metadata Fetcher | `metadata-fetcher.ts` | 提取用户名、模型版本 |
| 入口 | `index.ts` | 注册消息监听器，响应 `EXTRACT_CURRENT_CHAT` |

**DOM 解析策略：** 采用候选选择器数组，按优先级尝试匹配，兼容 Gemini 页面 DOM 结构变化。

**图片安全限制：**
- 单张图片 ≤ 5MB
- 自然尺寸 < 50px 的图片被跳过（图标/头像）
- 跨域图片 Canvas 读取失败时静默跳过

### 4.2 导出器模块（策略模式）

**目录：** `src/exporters/`

| 类 | 说明 |
|----|------|
| `IExporter` 接口 | `export(session, settings): Promise<Blob>` |
| `MarkdownExporter` | YAML FrontMatter + QA 格式 + Base64 内联图片 |
| `PDFExporter` | jsPDF 生成 A4 PDF，含封面页 + 角色区分背景色 |

**Markdown 输出结构：**
```markdown
---
title: "对话标题"
author: "用户名"
date: 2026-03-12T...
---

# 对话标题
> Author: ... | Date: ... | Model: ...

### 🧑 User
用户消息内容...

### 🤖 Gemini
模型回复内容...
```

**PDF 输出特点：**
- 封面页：居中标题、作者、日期、装饰线条
- 正文：User（蓝底）/ Model（绿底）区分
- 图片直接嵌入对应段落

### 4.3 存储分发模块（策略模式）

**目录：** `src/storage/`

| 类 | 说明 |
|----|------|
| `IStorage` 接口 | `save(blob, filename): Promise<boolean>` |
| `LocalStorage` | 调用 `browser.downloads.download` 触发本地下载 |
| `GoogleDriveStorage` | OAuth → multipart upload → Drive API v3 |

**Google Drive 上传流程：**
1. `browser.identity` 获取 OAuth Token（Chrome: `getAuthToken`, Firefox: `launchWebAuthFlow`）
2. 构造 `multipart/related` 请求体（元数据 + 文件内容）
3. POST 到 `googleapis.com/upload/drive/v3/files`

### 4.4 缓存与搜索模块

**文件：** `src/storage/db.ts`

- **数据库：** IndexedDB，库名 `gemini-chat-exporter`
- **存储仓库：** `sessions`（keyPath: id，索引: by-title, by-date）、`settings`
- **CRUD：** `upsertSession` / `getSession` / `deleteSession` / `getAllSessionSummaries`
- **搜索引擎：** 支持正则和纯文本，匹配标题和消息内容

### 4.5 Background Service Worker

**目录：** `src/background/`

| 文件 | 职责 |
|------|------|
| `index.ts` | 入口，注册消息监听 |
| `message-handler.ts` | 消息路由分发（10 种 action） |
| `task-manager.ts` | 导出任务生命周期管理 + 进度广播 |

**消息 Action 清单：**

| Action | 方向 | 说明 |
|--------|------|------|
| `EXTRACT_CURRENT_CHAT` | UI→BG→CS | 提取当前页面对话 |
| `EXTRACT_CHAT_LIST` | UI→BG→CS | 提取侧边栏聊天列表 |
| `EXPORT_SESSION` | UI→BG | 导出单个对话 |
| `BATCH_EXPORT` | UI→BG | 批量导出多个对话 |
| `GET_CACHED_SESSIONS` | UI→BG | 获取缓存列表 |
| `SEARCH_SESSIONS` | UI→BG | 搜索对话 |
| `DELETE_CACHED_SESSION` | UI→BG | 删除缓存 |
| `GET_SETTINGS` | UI→BG | 读取设置 |
| `SAVE_SETTINGS` | UI→BG | 保存设置 |
| `TASK_PROGRESS` | BG→UI | 任务进度通知 |

### 4.6 UI 与多语言模块

**Popup（`src/popup/`）：**
- 宽度 320px 的紧凑面板
- 格式选择（Markdown / PDF）+ 存储目标（本地 / Google Drive）
- 一键导出按钮 + 实时状态反馈
- 快捷入口跳转 Options 页面

**Options（`src/options/`）：**
- 左侧导航栏 + 右侧主工作区
- 聊天列表：复选框多选、搜索过滤（防抖 300ms）、批量导出、删除
- 设置面板：语言、默认格式、默认存储、封面开关、图片质量/宽度

**多语言：**
- 基于 `react-i18next`，支持运行时切换 `zh-CN` / `en-US`
- 翻译文件：`src/i18n/zh-CN.json`、`src/i18n/en.json`
- 浏览器原生 i18n（`_locales/`）仅用于 manifest 展示名和描述

---

## 5. 关键业务流程

### 5.1 单对话导出（Popup → PDF → Google Drive）

```
User                Popup           Background          Content Script
 │                   │                 │                     │
 │  点击导出按钮       │                 │                     │
 │─────────────────→│                 │                     │
 │                   │  EXTRACT...     │                     │
 │                   │────────────────→│  EXTRACT...         │
 │                   │                 │────────────────────→│
 │                   │                 │                     │ 解析 DOM
 │                   │                 │   ChatSession       │ 图片→Base64
 │                   │                 │←────────────────────│
 │                   │                 │                     │
 │                   │  EXPORT_SESSION │                     │
 │                   │────────────────→│                     │
 │                   │                 │ ① Upsert IndexedDB  │
 │                   │                 │ ② PDFExporter.export │
 │                   │  TASK_PROGRESS  │ ③ OAuth Token       │
 │                   │←── (exporting) ─│ ④ Drive API Upload  │
 │                   │←── (uploading) ─│                     │
 │                   │←── (done) ──────│                     │
 │  ✅ 成功动画       │                 │                     │
 │←─────────────────│                 │                     │
```

### 5.2 批量导出（Options 页面）

1. 用户在 Options 聊天列表中搜索过滤
2. 勾选多个对话 → 点击"导出选中"
3. `BATCH_EXPORT` 消息发送到 Background
4. Background 逐个从 IndexedDB 取出完整 ChatSession
5. 逐个调用 Exporter → Storage（串行执行，避免内存峰值）
6. 每个任务完成后广播 `TASK_PROGRESS`

---

## 6. 目录结构

```
gemini-chat-exporter/
├── manifest.json                  # MV3 清单
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   └── _locales/                  # 浏览器原生 i18n
│       ├── en/messages.json
│       └── zh_CN/messages.json
└── src/
    ├── types/
    │   ├── models.ts              # 核心数据字典
    │   └── messages.ts            # 消息通信协议
    ├── shared/
    │   ├── constants.ts           # 全局常量
    │   └── browser-api.ts         # 跨浏览器兼容层
    ├── content/
    │   ├── index.ts               # CS 入口
    │   ├── dom-parser.ts          # DOM 解析
    │   ├── image-extractor.ts     # 图片提取
    │   └── metadata-fetcher.ts    # 元数据抓取
    ├── exporters/
    │   ├── index.ts               # 导出器工厂
    │   ├── types.ts               # IExporter 接口
    │   ├── markdown-exporter.ts
    │   └── pdf-exporter.ts
    ├── storage/
    │   ├── index.ts               # 存储工厂
    │   ├── types.ts               # IStorage 接口
    │   ├── db.ts                  # IndexedDB 管理
    │   ├── local-storage.ts
    │   └── google-drive-storage.ts
    ├── background/
    │   ├── index.ts               # SW 入口
    │   ├── message-handler.ts     # 消息路由
    │   └── task-manager.ts        # 任务管理
    ├── i18n/
    │   ├── index.ts               # i18next 初始化
    │   ├── en.json
    │   └── zh-CN.json
    ├── popup/
    │   ├── index.html
    │   ├── main.tsx
    │   ├── App.tsx
    │   └── components/
    │       ├── ExportPanel.tsx
    │       └── StatusBar.tsx
    ├── options/
    │   ├── index.html
    │   ├── main.tsx
    │   ├── App.tsx
    │   └── components/
    │       ├── Sidebar.tsx
    │       ├── SearchBar.tsx
    │       ├── ChatList.tsx
    │       └── SettingsPanel.tsx
    └── styles/
        └── global.css
```

---

## 7. 安全设计

- **CSP**：`script-src 'self'; object-src 'self'`
- **权限最小化**：仅申请 `activeTab`, `storage`, `downloads`, `identity`
- **Host Permissions**：限制为 `gemini.google.com` 和 `googleapis.com`
- **OAuth Scope**：仅 `drive.file`（只能操作扩展创建的文件）
- **图片内存控制**：单张 ≤ 5MB，总量 ≤ 50MB
- **XSS 防护**：React 默认转义，i18n `escapeValue: false` 仅对 React 组件生效

---

## 8. 跨浏览器兼容

- **Chrome**：`chrome.identity.getAuthToken` → 原生 OAuth
- **Firefox**：`browser.identity.launchWebAuthFlow` → 手动 OAuth
- **统一层**：`webextension-polyfill` + `src/shared/browser-api.ts` 封装差异
- **构建命令**：`npm run build:chrome` / `npm run build:firefox`（通过 `BROWSER_TARGET` 环境变量区分）
