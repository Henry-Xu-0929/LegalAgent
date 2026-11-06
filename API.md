# 接口文档

本项目接口按调用方式分为四类：

| 类型 | 说明 | 涉及模块 |
|---|---|---|
| A. 云函数 RPC | 主要接口，`wx.cloud.callFunction` + `action` 分发 | `contract`、`aiChat`、`auth`、`report` |
| B. 前端流式直连 | 主聊天链路，小程序端直接请求 DeepSeek | `services/ai-chat-stream-service.js` |
| C. 前端直连数据库 | 绕过云函数的兜底写入 / 会话持久化 | `contracts`、`agent_ui_sessions` 集合 |
| D. 组件内工具派发 | 组件内部方法调用，非网络接口 | `archive_contract` |

云开发环境：`cloud1-6gehasf567bbe26f`（`app.js`）。

---

## 0. 通用约定

**云函数响应格式（`ok` 风格）**

```js
// 成功
{ ok: true, data: ..., /* 可能附带 total/page/size */ }

// 失败
{ ok: false, error: "错误描述" }
```

**`aiChat` 是例外**，使用 `success` 风格：

```js
{ success: true, ... }   // 或 { success: false, statusCode, errCode?, message }
```

前端通过 `parseCloudPayload`（`services/ai-chat-stream-service.js:37`）做了兼容，两种风格都能解析。

**鉴权模型**

- 全站无 token / session 概念。身份靠云开发隐式注入的 `openid`（`cloud.getWXContext().OPENID`）。
- `auth` 登录态仅存于本地 `wx.setStorageSync("authUser")`，与云函数权限体系无关联。
- 数据隔离是**软隔离**：`contract` 云函数按 `_openid` / `ownerOpenId` 过滤，但两者都不存在的记录对所有用户可见（见 `buildBaseWhere`，`cloudfunctions/contract/index.js:325`）。

**分页约定**

- `page` 从 1 开始，`size` 默认 20、上限 50（`list`）；`search` 不分页、固定上限 100 条。

---

## 1. `contract` — 合同 / 法律文件归档

文件：`cloudfunctions/contract/index.js`
调用方：`pages/foodBuy/*`（归档页）、`components/agent-ui/modules/chat-core-retrieval-methods.js`（对话内检索）

统一入参：`{ action: string, ...其余参数按 action }`

### 1.1 `list` — 分页列表

**入参**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `query` / `keyword` | string | 否 | 关键词，在 `searchableText` 上做不区分大小写的正则匹配（`query` 优先） |
| `category` | string | 否 | 分类筛选，`"all"` 或空表示不筛 |
| `sourceType` | string | 否 | 来源筛选，如 `chat` / `upload` / `generated` |
| `caseKey` | string | 否 | 案件 key 精确筛选 |
| `page` | number | 否 | 默认 1 |
| `size` | number | 否 | 默认 20，区间 [1, 50] |

**返回**

```js
{
  ok: true,
  data: [ /* ContractListItem[] */ ],
  total: 123,
  page: 1,
  size: 20
}
```

`ContractListItem` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 文档 `_id` |
| `title` | string | 标题（服务端清洗后） |
| `party` | string | 相对方 |
| `status` | string | 版本状态：`定稿版` / `已上传` / `生成中` / `已生成` / 自定义 |
| `category` | string | 分类，空值回落为 `未分类` |
| `sourceType` | string | `chat` / `upload` / `generated` 等 |
| `summary` | string | 摘要，截断 220 字 |
| `keywords` | string[] | 关键词，最多 12 个 |
| `fileId` / `fileName` / `fileType` | string | 关联的云存储文件（`generated` 来源为服务端生成的 Word） |
| `docType` | string | 文档类型，如 `合同文件` / `法律文书` / `证据材料` / `通用文件` |
| `caseKey` / `caseTitle` | string | 案件标识 |
| `contractGroupKey` | string | 版本组 key，同组共享版本号序列 |
| `manualEdited` | boolean | 是否手动编辑过 |
| `manualEditCount` | number | 手动编辑次数 |
| `manualEditUpdatedAt` | string | 格式 `YYYY-MM-DD HH:mm` |
| `versionNo` | number | 版本号，从 1 开始 |
| `finalConfirmed` | boolean | 是否已定稿 |
| `createdAt` / `updatedAt` | string | 格式化时间字符串 |
| `createdAtTs` / `updatedAtTs` | number | 原始毫秒时间戳 |

**行为说明**：结果会过滤掉 `status` 为 `生成中` 的记录，以及「合同类但正文不合法」的记录（见 `isInvalidContractContent`，`cloudfunctions/contract/index.js:223`）。

### 1.2 `search` — 全量检索

入参同 `list`（忽略 `page` / `size`），按 `updatedAt` 倒序返回最多 100 条。

```js
{ ok: true, data: [ /* ContractListItem[] */ ] }
```

### 1.3 `detail` — 详情

**入参**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 合同 `_id` |

**返回**：`{ ok: true, data: ContractDetail }`

`ContractDetail` 在 `ContractListItem` 基础上增加：

| 字段 | 类型 | 说明 |
|---|---|---|
| `content` | string | 完整正文（上限 80000 字符） |
| `manualEditHistory` | object[] | 手动编辑历史，倒序，最多 20 条 |

`manualEditHistory` 元素：

```js
{
  editedAt: 1730000000000,        // 毫秒时间戳
  summary: "编辑3处",
  trace: [                        // 最多 12 条
    { lineNo: 12, before: "原文本(≤120字)", after: "新文本(≤120字)" }
  ]
}
```

**错误**：`缺少合同ID` / `合同不存在` / `合同内容无效或已过期`

### 1.4 `saveFromChat` — 保存 / 更新归档

对话归档的主写入入口，兼具「新建」「按 id 更新」「按 archiveKey 更新」「版本组追加」四种语义。

**入参**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `payload` | object | 是 | 见下表 |

`payload` 字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | 否 | 空则回落为 `${category}-${时间}` |
| `category` | string | 否 | 默认 `未分类` |
| `content` | string | 是 | 合同类内容会先做正文裁剪（`pruneContractTail`），上限 80000 |
| `summary` | string | 否 | 空则从 `content` 截取 220 字 |
| `sourceType` | string | 否 | 默认 `chat` |
| `docType` | string | 否 | 影响是否按合同类规则校验 |
| `party` / `status` / `keywords` | — | 否 | `keywords` 去重后最多 12 个 |
| `fileId` / `fileName` / `fileType` | string | 否 | 关联文件 |
| `caseKey` / `caseTitle` | string | 否 | 案件标识 |
| `contractGroupKey` | string | 否 | 版本组；传入时同组版本号自动递增 |
| `finalConfirmed` | boolean | 否 | 定稿标记，触发同组清理 |
| `ownerOpenId` | string | 否 | 空则用当前调用者 `openid` |
| `id` | string | 否 | 有值时走更新分支 |
| `archiveKey` | string | 否 | 幂等键，`id` 未命中时按此查找更新 |

**返回**：`{ ok: true, data: { id, updatedAt } }`（`updatedAt` 为格式化字符串）

**错误**：`内容不符合合同正文归档条件`

**服务端版本管理规则**（`cloudfunctions/contract/index.js:425` 起）

1. 命中 `id` 或 `archiveKey` → 原地更新，保留原 `versionNo` 和 `contractGroupKey`。
2. 带 `contractGroupKey` 新建 → 同组最大 `versionNo` + 1。
   - 未定稿时，同组仅保留最新 2 个未定稿版本，更旧的自动删除；已定稿的版本不受影响。
   - `finalConfirmed: true` 时，同组其他记录全部删除，只留这一条。
3. 都不带 → 新建单条，`contractGroupKey` 回填为自身 `_id`。

同时服务端会重建 `searchableText`（title/category/docType/caseKey/summary/content/keywords/编辑历史等拼接近似全文索引，上限 120000 字符）。

### 1.5 `updateManualEdit` — 手动编辑正文

**入参**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 合同 `_id` |
| `content` | string | 是 | 新正文，非空，超长截断 80000 |
| `summary` | string | 否 | 不传则沿用原 `summary` |

**返回**：`{ ok: true, data: ContractDetail }`（更新后的完整详情）

**行为**：服务端逐行 diff 生成 `trace`（最多 30 条，每条前后各截 120 字），写入 `manualEditHistory` 头部（保留最近 20 条），`manualEditCount` +1，置 `manualEdited: true`，并重建 `searchableText`。

**错误**：`缺少合同ID` / `合同不存在` / `编辑内容不能为空`

### 1.6 `delete` — 删除

**入参**：`{ id }`

**返回**：`{ ok: true }`（记录本就不存在时同样返回 `ok: true`，幂等）

**错误**：`缺少合同ID` / `合同不存在`

### 1.7 未匹配 action

任何无法识别的 `action` 返回 `{ ok: false, error: "不支持的操作" }`。

---

## 2. `aiChat` — 模型配置、文件解析、非流式对话

文件：`cloudfunctions/aiChat/index.js`
响应格式为 `success` 风格。

### 2.1 `getConfig` — 下发模型配置

**入参**：`{ action: "getConfig" }`

**返回**

```js
{
  success: true,
  apiKey: "sk-xxxx",                 // ⚠️ 明文下发
  baseURL: "https://api.deepseek.com/v1/chat/completions",
  modelName: "deepseek-flash"
}
```

取值来源：云函数环境变量 `MODEL_API_KEY`（或 `DEEPSEEK_API_KEY`）、`MODEL_BASE_URL`、`MODEL_NAME`。

### 2.2 `extractFileText` — 文件文本提取

**入参**：`{ action: "extractFileText", fileId, fileName }`

**返回**：`{ success: true, text: "..." }`

**错误**：`{ success: false, statusCode, message }`，`message` 取值 `缺少 fileId` / `文件解析结果为空`（422）/ `下载文件失败`（500）/ 解析异常信息。

支持格式取决于 `file-text-extractor.js`（txt / csv / 图片 OCR / docx / pdf / zip 等）。

### 2.3 `extractImageText` — 图片 OCR

**入参**：`{ action: "extractImageText", fileId, fileName }`（`fileName` 默认 `image.jpg`）

**返回**：`{ success: true, text: "..." }`

**错误**：`缺少 fileId` / `图片OCR结果为空` / `云端图片识别失败`

### 2.4 无 action — 非流式对话代理

**入参**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `messages` | array | 是 | 标准 Chat Completions 消息数组 |
| `model` | string | 否 | 覆盖默认模型名 |
| `maxTokens` | number | 否 | 区间 [256, 8192]，默认 8192 |

**返回**

```js
{ success: true, content: "正文", reasoningContent: "推理内容" }
```

**错误**

| 场景 | 返回 |
|---|---|
| 未配置 Key | `{ success: false, statusCode: 500, message: "未配置模型 API_KEY 环境变量..." }` |
| 上游 4xx/5xx | `{ success: false, statusCode: <上游状态码>, message }` |
| 上游超时（45s） | `{ success: false, statusCode: 504, errCode: "UPSTREAM_TIMEOUT", message: "上游模型响应超时，请稍后重试" }` |

> 注意：主聊天链路**不走**这里。该分支仅为非流式兜底，前端实际使用第 3 节的直连方案。

---

## 3. 前端流式直连（主聊天链路）

文件：`services/ai-chat-stream-service.js`
导出：`streamChat({ messages, model, maxTokens }, onChunkReceived, onDone, onError) → { abort() }`

**调用流程**

1. 先调 `aiChat.getConfig` 获取配置；失败或无 Key 时回退到 `config/model-config.js`（本地私有文件，已 gitignore）。
2. 小程序端直接以 `wx.request` 请求 DeepSeek，`enableChunked: true` 接收 SSE。

**请求**

```
POST {baseURL}
Authorization: Bearer {apiKey}
Content-Type: application/json

{
  "model": "deepseek-flash",
  "messages": [...],       // 压缩后：首条 system + 最近 5 条非 system，单条上限 80000 字符
  "stream": true,
  "max_tokens": 8192       // 区间 [256, 8192]
}
```

**响应（SSE）**：逐块解析 `data: {json}` 行，取 `choices[0].delta`：

- `delta.content` → `onChunkReceived(chunk, false)`（正文）
- `delta.reasoning_content` → `onChunkReceived(chunk, true)`（推理）
- `data: [DONE]` → `onDone()`
- HTTP 状态码 ≥ 400 → `onError({ statusCode })`

**降级行为**：上游超时 / `-504003` / `FUNCTIONS_TIME_LIMIT_EXCEEDED` 时，不报错，改为按 22ms/字的打字机效果输出内置兜底文案（`buildTimeoutFallback`）。

**取消**：返回对象的 `abort()` 会置标志位并中断 `wx.request`。

---

## 4. `auth` — 注册 / 登录

文件：`cloudfunctions/auth/index.js`

### 4.1 `register`

**入参**：`{ action: "register", username, password }`

**返回**：`{ ok: true, userId }`

**错误**：`请输入账号和密码` / `账号已存在`

### 4.2 `login`

**入参**：`{ action: "login", username, password }`

**返回**：`{ ok: true, userId, username }`

**错误**：`请输入账号和密码` / `账号或密码错误`

> ⚠️ 密码明文入库、明文比对（`cloudfunctions/auth/index.js:32`）。前端登录成功后仅将 `{ username, userId }` 写入本地 storage，后续请求不携带任何凭证。

---

## 5. `report` — 统计报表

文件：`cloudfunctions/report/index.js`

**入参**：无（不需要 `action`）

**返回**

```js
{
  ok: true,
  data: {
    metrics:          [ { label, value } ],                   // 概览指标卡片
    trends:           [ { label, value } ],                   // 环比趋势
    heatmap:          [ { day, counts: [早, 中, 下午, 晚] } ],  // 7 天 × 4 时段
    risks:            [ { label, value, percentage, color } ], // 风险分布
    frequentQuestions:[ { question, count } ],
    suggestions:      [ string ]
  }
}
```

数据来源：`reports` 集合中 `type: "overview"` 的第一条记录；不存在时整体返回内置 mock 数据（云函数与前端各有一份，双保险）。

---

## 6. 前端直连数据库

以下路径绕过云函数，直接读写数据库，与云函数共用同一批集合。

### 6.1 `contracts` 集合直写（归档兜底）

位置：`components/agent-ui/modules/chat-core-archive-methods.js:26` `saveContractFallback`

当 `contract` 云函数 `saveFromChat` 失败时，前端降级为 `wx.cloud.database().collection("contracts").add()`。写入字段与云函数基本对齐（含 `searchableText`），但**不含**版本分组、内容裁剪、无效内容校验等逻辑。

### 6.2 `agent_ui_sessions` 集合（会话持久化）

位置：`components/agent-ui/index.js`

| 接口 | 操作 | 说明 |
|---|---|---|
| `upsertSessionDoc(sessionType, sessionKey, payload)` | 查后 add/update | 按 `{ sessionType, sessionKey }` 唯一 |
| `restoreModelSession()` | where + get | `sessionType: "model"`，恢复 `featureChatRecordsMap`、`activeFeatureKey` |
| `restoreAgentSession()` | where + get | `sessionType: "agent"`，恢复 `threadId`、`messages` |
| `clearSessionDocsByType(sessionType)` | where + 逐条 remove | 最多处理 100 条，仅非 release 环境调用 |

写入时机为防抖 1.2s 落库；`messages` 最多保留最近 40 条。注意 `restoreModelSession` 中会**主动删除** `draft`（合同起草）和 `review`（合同审查）的历史记录（`components/agent-ui/index.js:489-491`）。

---

## 7. 组件内工具派发

`callFunctionByName(name, rawArgs)`（`components/agent-ui/modules/chat-core-archive-methods.js:131`）是组件内部的伪工具调用层，**不对应任何云函数**：

| name | 实际行为 |
|---|---|
| `archive_contract` | 调用组件内 `archiveGeneratedContract(userInput, generatedContent, options)` |
| 其他 | 返回 `{ ok: false, error: "unsupported function: ..." }` |

调用记录写入本地 `wx.setStorageSync("contract_archive_trace")`，最多 30 条。

---

## 8. 调用方索引

| 云函数 | 调用位置 |
|---|---|
| `contract` | `pages/foodBuy/foodBuy.js`（list / detail / updateManualEdit / delete）、`components/agent-ui/modules/chat-core-retrieval-methods.js`（search / list / detail）、`chat-core-archive-methods.js`（saveFromChat） |
| `aiChat` | `services/ai-chat-stream-service.js`（getConfig）、`components/agent-ui/modules/file-methods.js`（extractFileText / extractImageText） |
| `auth` | `pages/index/index.js`（register / login） |
| `report` | `pages/reports/reports.js`（无 action） |

数据库集合：`contracts`、`agent_ui_sessions`、`reports`、`users`。

`cloudfunctions/aiService/` 为空目录，未使用。

---

## 9. 已知风险

1. **API Key 下发**：`getConfig` 将模型 Key 明文返回给前端，抓包或反编译小程序即可获取。README 5.2/5.4 已承认此设计，是最主要的暴露面。
2. **密码明文**：`users` 集合存储与比对均为明文，泄露即全量账号失守。
3. **鉴权缺失**：无 token 机制，`auth` 登录态与云函数数据权限完全脱节；`contract` 的软隔离对无 `_openid` 记录放行。
4. **双写路径**：`saveContractFallback` 直连写库，与云函数的版本 / 去重 / 清洗逻辑并存，可能产生不一致数据。
5. **Key 泄露应急**：若 `config/model-config.js` 或环境变量曾误提交，需在 DeepSeek 控制台吊销并重新申请。
