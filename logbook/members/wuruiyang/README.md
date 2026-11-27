# LegalAgent 法律智能体

> 面向中小企业（SME）的微信小程序法律智能体
> 基于 **微信小程序 + 云开发**，集成大模型流式对话、合同/文书归档检索、手动编辑、统计报表与用户体系。

---

## 项目简介

LegalAgent 是一款面向中小企业日常法务场景的轻量级智能法律助手。用户可通过微信小程序完成：

- **智能法律咨询**（流式对话，支持多轮上下文）
- **合同/法律文书归档与检索**（支持版本管理、手动编辑历史、全文检索）
- **统计报表与 AI 法务建议**
- **简单账号注册登录**

项目目标是帮助中小企业低成本完成法律文本的咨询、起草、审查与归档闭环，降低对专业法务的依赖门槛。

---

## 主要功能

| 模块 | 功能说明 |
|------|----------|
| **智能对话** | 基于大模型（默认 DeepSeek）的流式对话，支持法律咨询、合同起草/审查等场景，支持文件上传解析（PDF/Word/图片 OCR 等） |
| **法律文件归档与检索** | 合同/文书的保存、列表、详情、关键词检索、分类筛选、版本管理、手动编辑与编辑历史追溯 |
| **统计报表** | 咨询量、审查合同数、风险分布等指标聚合展示，支持 AI 生成法务建议 |
| **用户体系** | 简单注册/登录（本地存储登录态） |
| **会话持久化** | 对话历史与 Agent 会话状态自动保存到云数据库 |

---

## 技术架构

- **前端**：微信小程序（原生）
- **后端**：微信云开发（云函数 + 云数据库 + 云存储）
- **大模型**：默认 DeepSeek（兼容 OpenAI Chat Completions 协议），支持流式输出
- **文件解析**：`aiChat` 云函数集成 `mammoth`（docx）、`pdf-parse`、`adm-zip` 等，支持文本提取与图片 OCR

### 核心页面

| 页面路径 | 说明 |
|----------|------|
| `pages/chatBot/chatBot` | 智能对话主页面 |
| `pages/foodBuy/foodBuy` | 法律文件归档与检索（归档中心） |
| `pages/reports/reports` | 统计报表 + AI 建议 |
| `pages/my/my` | 个人中心 |
| `pages/index/index` | 登录/注册入口 |

### 云函数列表

| 云函数 | 职责 |
|--------|------|
| `aiChat` | 模型配置下发、文件文本提取、图片 OCR、非流式对话代理 |
| `auth` | 用户注册 / 登录 |
| `contract` | 合同/文书的 CRUD、搜索、手动编辑、版本管理 |
| `getReportData` | 真实数据聚合（咨询量、审查数、风险分布等） |
| `generateAIReport` | 基于报表数据生成 AI 法务建议 |
| `report` | 旧版报表接口（兼容保留） |

---

## 项目结构

```
LegalAgent/
├── cloudfunctions/ # 云函数
│   ├── aiChat/
│   ├── auth/
│   ├── contract/
│   ├── getReportData/
│   ├── generateAIReport/
│   └── report/
├── components/ # 自定义组件
│   ├── agent-ui/ # 对话核心 UI 与业务逻辑
│   └── toolCard/ # 工具卡片组件
├── pages/ # 小程序页面
│   ├── chatBot/
│   ├── foodBuy/ # 归档与检索页
│   ├── reports/
│   ├── my/
│   └── index/
├── services/ # 前端服务层
│   └── ai-chat-stream-service.js # 流式对话核心
├── docs/ # 项目文档（治理、研究、规划等）
├── project-proposal/ # 项目提案相关文档
├── imgs/ # 静态图片资源
├── API.md # 详细接口文档
├── README.md
└── ...
```

---

## 快速开始

### 1. 环境准备

- [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)（最新版）
- 微信小程序 AppID（测试号或正式号均可）
- Node.js 18+
- 已开通微信云开发环境

### 2. 开通云开发环境

1. 打开微信开发者工具，登录后导入任意小程序项目。
2. 打开「云开发」面板，按提示开通并创建环境，记录环境 ID（形如 `cloud1-xxxx`）。

### 3. 导入项目并配置

1. 用微信开发者工具导入本项目根目录。
2. 修改 `app.js` 中的云环境 ID：

```javascript
wx.cloud.init({
  env: "你的云环境ID",
  traceUser: true,
});
```

3. 如使用自己的小程序账号，更新 `project.config.json` 中的 `appid`。

### 4. 创建数据库集合（必做）

在云开发控制台 → 数据库中创建以下集合（名称必须一致）：

| 集合名 | 用途 | 主要字段示例 |
|--------|------|-------------|
| `contracts` | 合同/文书归档与检索 | `title`, `content`, `summary`, `category`, `caseKey`, `manualEditHistory`, `updatedAt` |
| `agent_ui_sessions` | 会话状态持久化 | `sessionType`, `sessionKey`, `chatRecords`, `messages`, `threadId` |
| `reports` | 报表概览数据 | `type: "overview"` |
| `users` | 账号注册登录 | `username`, `password`, `createdAt` |

### 5. 安装云函数依赖并部署

```bash
# 在项目根目录执行
npm install --prefix cloudfunctions/aiChat
npm install --prefix cloudfunctions/auth
npm install --prefix cloudfunctions/contract
npm install --prefix cloudfunctions/report
npm install --prefix cloudfunctions/getReportData
npm install --prefix cloudfunctions/generateAIReport
```

也可在微信开发者工具中右键各云函数目录 →「在终端中打开」→ 执行 `npm install`。

然后对每个云函数目录右键 →「上传并部署：所有文件」。

### 6. 配置大模型（DeepSeek 推荐）

**云函数环境变量**

在云开发控制台为 `aiChat` 和 `generateAIReport` 分别配置以下环境变量（按函数隔离，不会自动继承）：

```json
{
  "MODEL_API_KEY": "sk-xxxxxx",
  "MODEL_BASE_URL": "https://api.deepseek.com/v1/chat/completions",
  "MODEL_NAME": "deepseek-flash"
}
```

最小配置只需填写 `MODEL_API_KEY`。

**前端私有配置（主聊天流式链路必做）**

主聊天为提升流式体验，由小程序端直连 DeepSeek。在本地新建 `config/model-config.js`（已加入 `.gitignore`）：

```javascript
module.exports = {
  MODEL_API_KEY: "sk-xxxxxx",
  MODEL_BASE_URL: "https://api.deepseek.com/v1/chat/completions",
  MODEL_NAME: "deepseek-flash",
};
```

配置读取优先级：云函数 `getConfig` 下发 → `config/model-config.js` 兜底。

**其他必要配置**

1. 微信公众平台 → 开发管理 → 开发设置 → 服务器域名 → request 合法域名，添加 `https://api.deepseek.com`。
2. 本地调试时可在开发者工具「详情 → 本地设置」勾选「不校验合法域名」。
3. 建议将 `aiChat` 云函数超时时间设为 20-60 秒。

### 7. 接入自定义模型

**方式 A（推荐）**：服务兼容 OpenAI / DeepSeek Chat Completions 协议

只需修改云函数环境变量中的 `MODEL_API_KEY`、`MODEL_BASE_URL`、`MODEL_NAME`。

**方式 B**：自定义协议

需修改 `cloudfunctions/aiChat/index.js` 中的请求体构造与响应解析逻辑，保持返回结构 `{ success, content, reasoningContent }` 不变。

---

## 快速验收清单

部署完成后建议按以下顺序自测：

1. 打开小程序，进入对话页，发送一条普通问题，确认流式输出正常。
2. 注册新账号并登录。
3. 在「法律文件归档与检索」页创建 / 查看 / 删除一条合同记录。
4. 对已归档合同执行手动编辑并保存，确认可正确回显与历史记录。
5. 在对话中引用归档内容，确认检索链路可用。
6. 打开统计报表页，确认有默认数据或自定义数据，并尝试生成 AI 建议。

---

## 接口文档

完整接口说明见 `API.md`，主要包括：

- 云函数 RPC（`contract`、`aiChat`、`auth`、`getReportData`、`generateAIReport` 等）
- 前端流式直连（主聊天链路）
- 前端直连数据库兜底路径
- 组件内工具派发

---

## 协作与分支规范

本项目固定保留两个长期分支：

- `main`：稳定可发布分支
- `dev`：日常集成开发分支

日常开发建议：

1. 从 `dev` 拉取功能分支：`feature/xxx`
2. 功能完成后合并回 `dev`
3. 阶段发布时从 `dev` 合并到 `main`

更多协作细节可参考仓库内相关文档。

---

## 安全注意事项

- **切勿提交密钥**：`config/model-config.js` 含 API Key，已在 `.gitignore` 中，请勿强制提交。
- 若 Key 误提交，请立即到 DeepSeek 控制台吊销并重新申请。
- `project.private.config.json` 建议忽略，不要加入版本控制。
- 当前实现中存在以下已知风险（详见 `API.md`）：
  - 模型 API Key 会下发到前端
  - 用户密码目前为明文存储与比对
  - 鉴权为软隔离，依赖 `openid`
- 切换云环境前务必确认 `app.js` 中的 `env` 已正确替换。

---

## 已知限制与后续规划

- 当前以微信小程序为主，Web 端与更完整的 Case-centric 架构仍在规划中（见 `project-proposal/`）。
- 报表部分部分指标依赖聚合逻辑，热力图/高频问题等仍有 mock 兜底。
- 安全加固（密码哈希、服务端鉴权强化、Key 不下发等）是后续重要方向。

---

## 相关文档

- `API.md` — 完整接口文档
- `project-proposal/` — 项目提案与目标说明
- `docs/` — 治理、研究与开发文档

---

## License

本项目仅供学习与研究使用。使用大模型服务时请遵守对应平台的服务条款与当地法律法规。法律相关输出仅供参考，不构成正式法律意见。

LegalAgent —— 让中小企业也能轻松拥有智能法律助手。
