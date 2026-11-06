# 法律智能体小程序 - 部署与协作指南

本项目是基于微信小程序 + 云开发的法律智能体，包含：

- 智能对话（模型流式输出）
- 合同归档（保存、检索、详情、手动编辑）
- 报表展示
- 用户注册登录

---

## 1. 本地运行前置条件

请先准备：

- 微信开发者工具（最新版）
- 一个微信小程序 AppID（测试号或正式号都可）
- Node.js 18+（用于云函数依赖安装）
- 已开通微信云开发环境

---

## 2. 申请免费云开发环境（队友必做）

每位队友都可以使用自己的免费云开发环境联调：

1. 打开微信开发者工具，登录微信。
2. 创建或导入任意小程序项目后，打开「云开发」面板。
3. 按提示开通云开发环境并创建环境（会得到一个环境 ID，形如 `cloud1-xxxx`）。
4. 记录该环境 ID，后续会配置到项目中。

---

## 3. 导入项目并配置环境

1. 用微信开发者工具导入本项目根目录。
2. 在 `app.js` 中修改云环境 ID：

```javascript
wx.cloud.init({
  env: "你的云环境ID",
  traceUser: true,
});
```

3. 如需使用你自己的小程序账号，更新 `project.config.json` 里的 `appid`。

---

## 4. 数据库集合创建（必做）

在云开发控制台 -> 数据库，创建以下 4 个集合，名称必须一致：

### 4.1 `contracts`

- 用途：合同/文书归档与检索数据
- 主要字段示例：`title`、`content`、`summary`、`category`、`caseKey`、`manualEditHistory`、`updatedAt`
- 建议权限：仅创建者可读写（团队测试时可按需放宽）

### 4.2 `agent_ui_sessions`

- 用途：保存会话状态（模型会话、Agent 会话）
- 主要字段示例：`sessionType`、`sessionKey`、`chatRecords`、`messages`、`threadId`、`updatedAt`
- 建议权限：仅创建者可读写

### 4.3 `reports`

- 用途：报表页概览数据
- 读取逻辑：会读取 `type: "overview"` 的一条记录；没有记录时会返回内置默认数据
- 可选初始化：插入一条 `type: "overview"` 文档来自定义数据

### 4.4 `users`

- 用途：账号注册与登录
- 主要字段示例：`username`、`password`、`createdAt`、`updatedAt`
- 建议权限：前端不直连，交给云函数读写

---

## 5. 云函数部署（必做）

项目包含以下云函数目录：

- `cloudfunctions/aiChat`
- `cloudfunctions/auth`
- `cloudfunctions/contract`
- `cloudfunctions/report`

### 5.0 先安装云函数依赖（建议）

这些云函数都包含 `package.json`，部署前需要先安装依赖：

- `cloudfunctions/aiChat`（含 `adm-zip`、`mammoth`、`pdf-parse`、`wx-server-sdk`）
- `cloudfunctions/auth`（`wx-server-sdk`）
- `cloudfunctions/contract`（`wx-server-sdk`）
- `cloudfunctions/report`（`wx-server-sdk`）

在项目根目录执行：

```bash
npm install --prefix cloudfunctions/aiChat
npm install --prefix cloudfunctions/auth
npm install --prefix cloudfunctions/contract
npm install --prefix cloudfunctions/report
```

如果你使用微信开发者工具，也可以在每个云函数目录右键选择“在终端中打开”，执行 `npm install`。

补充说明：

- 最小运行场景下，你本地只有 `cloudfunctions/aiChat/node_modules` 也可以，常见于只装了带第三方库的函数。
- `auth`、`contract`、`report` 目前只依赖 `wx-server-sdk`，很多同学会在“上传并部署”时让云端安装依赖，因此本地不一定会看到它们的 `node_modules`。
- 如果你要做本地云函数调试，建议四个函数都执行一次 `npm install`，避免本地调试时报缺包。

### 5.1 部署步骤

1. 在微信开发者工具中右键每个云函数目录。
2. 选择「上传并部署：所有文件」。
3. 首次部署后，确认每个函数都能正常调用。

### 5.2 默认使用 DeepSeek（推荐直接可用）

`aiChat` 云函数默认已经按 DeepSeek 兼容接口实现，只需要在云函数环境变量里配置：

- `MODEL_API_KEY`：必填，DeepSeek API Key
- `MODEL_BASE_URL`：可选，默认 `https://api.deepseek.com/v1/chat/completions`
- `MODEL_NAME`：可选，默认 `deepseek-flash`

最小可用配置：只填 `MODEL_API_KEY` 即可跑通。

> 注意：主聊天链路为了流式输出，是**小程序端直连 DeepSeek** 的，Key 由云函数 `getConfig`
> 下发给前端。因此除了云函数环境变量，前端也需要一份可用的 Key —— 见 5.4。

可直接复制的云函数环境变量示例（JSON）：

```json
{
  "MODEL_API_KEY": "sk-xxxxxx",
  "MODEL_BASE_URL": "https://api.deepseek.com/v1/chat/completions",
  "MODEL_NAME": "deepseek-flash"
}
```

### 5.4 前端私有配置（主聊天链路必做）

主聊天的流式请求由 `services/ai-chat-stream-service.js` 直接发往 DeepSeek，
配置读取顺序为：**云函数 `getConfig` 下发 → `config/model-config.js` 兜底**。

因此在本地新建 `config/model-config.js`（该文件已在 `.gitignore` 中，不会提交）：

```javascript
module.exports = {
  MODEL_API_KEY: "sk-xxxxxx",
  MODEL_BASE_URL: "https://api.deepseek.com/v1/chat/completions",
  MODEL_NAME: "deepseek-flash",
};
```

两项配套设置：

1. 微信公众平台 →「开发管理 → 开发设置 → 服务器域名 → request 合法域名」
   添加 `https://api.deepseek.com`（必须是备案过的 HTTPS 域名）。
   本地联调可在微信开发者工具「详情 → 本地设置」勾选「不校验合法域名」。
2. 云函数 `aiChat` 的超时时间建议设为 20-60 秒（仓库内 `config.json` 已配 60 秒）。

### 5.3 接入你自己的训练模型

你有两种接入方式：

#### 方式 A：你的服务兼容 OpenAI/DeepSeek Chat Completions 协议（推荐）

如果你的模型网关支持类似下面的请求体，就不需要改代码：

- 请求体包含：`model`、`messages`、`max_tokens`
- Header 支持：`Authorization: Bearer <API_KEY>`
- 返回体包含：`choices[0].message.content`

此时只需要改云函数环境变量：

- `MODEL_API_KEY` = 你的网关密钥
- `MODEL_BASE_URL` = 你的接口地址（例如 `https://your-domain/v1/chat/completions`）
- `MODEL_NAME` = 你的模型名（例如 `your-legal-model`）

可直接复制的云函数环境变量示例（JSON）：

```json
{
  "MODEL_API_KEY": "your_gateway_api_key",
  "MODEL_BASE_URL": "https://your-domain/v1/chat/completions",
  "MODEL_NAME": "your-legal-model"
}
```

#### 方式 B：你的服务是自定义协议（不兼容 Chat Completions）

需要修改 `cloudfunctions/aiChat/index.js` 中请求与响应映射逻辑：

1. 修改请求体构造：`cloudfunctions/aiChat/index.js` 中 `exports.main` 里的 `requestJSON(..., body)` 调用位置（当前是 `model/messages/max_tokens/stream` 这段）。
2. 修改返回解析：同文件里 `const choice = res.data?.choices?.[0] || {}` 及其后续 `message.content` 读取位置。
3. 保持返回结构不变，继续返回：
   - `success`
   - `content`
   - `reasoningContent`

这样前端不用改动，只替换云函数适配层即可。

---

## 6. 快速验收清单

部署完成后建议按下面顺序自测：

1. 打开小程序，进入对话页，发送一条普通问题。
2. 注册一个新账号并登录。
3. 在归档页面创建/查看/删除一条合同记录。
4. 对已归档合同执行手动编辑并保存，确认可回显。
5. 在对话中引用归档内容，确认检索链路可用。
6. 打开报表页确认有默认数据或你自定义的数据。

---

## 7. GitHub 协作规范（main + dev）

本项目固定保留两个长期分支：

- `main`：稳定可发布分支
- `dev`：日常集成开发分支

日常建议：

- 新需求从 `dev` 拉功能分支：`feature/xxx`
- 功能完成先合并回 `dev`
- 阶段发布时再从 `dev` 合并到 `main`

---

## 8. 首次上传到 GitHub（含 main/dev）

以下命令在项目根目录执行：

```bash
git init
git add .
git commit -m "chore: initial commit"
git branch -M main
git checkout -b dev
git remote add origin https://github.com/你的用户名/你的仓库名.git
git push -u origin main
git push -u origin dev
```

如果远端仓库已经有提交（例如 README），请先拉取再推送：

```bash
git pull --rebase origin main
git push -u origin main
git push -u origin dev
```

---

## 9. 后续开发提交流程

```bash
git checkout dev
git pull origin dev
git checkout -b feature/xxx
# 开发并提交
git add .
git commit -m "feat: xxx"
git push -u origin feature/xxx
```

然后在 GitHub 发起 PR：

- `feature/xxx` -> `dev`
- 需要发布时再 `dev` -> `main`

---

## 10. 安全与提交注意事项

- 不要提交密钥、私有证书、个人环境变量。
- `config/model-config.js` 含 API Key，已在 `.gitignore` 中，请勿用 `git add -f` 强行提交。
- 若 Key 已误提交，请立即到 DeepSeek 控制台吊销并重新申请。
- `project.private.config.json` 已建议忽略，不要加入版本控制。
- 切换到自己云环境前，务必确认 `app.js` 中的 `env` 已替换。
