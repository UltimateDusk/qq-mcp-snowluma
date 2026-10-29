# QQ MCP for SnowLuma

让支持 MCP 的模型在你主动调用工具时读取 QQ 消息、回复群聊或私聊、发送图片和收藏表情、戳一戳，并在持续聊天任务中控制时间、发送节奏与并发重复回复。

本项目是一个独立的 Node.js MCP 服务，通过本机 [SnowLuma](https://github.com/SnowLuma/SnowLuma) OneBot v11 HTTP/WebSocket 接口操作已经登录的 QQ。它不包含 QQ、SnowLuma、远程隧道或任何账号凭据。

> [!CAUTION]
> SnowLuma 与本项目均非腾讯或 QQ 官方产品。自动化或非官方客户端可能触发账号限制。没有任何配置能够保证不封号。请使用你能承担风险的账号，降低频率，遵守 QQ 用户协议与当地法律。

## 工作方式

```text
ChatGPT / MCP 客户端
        │
        │ MCP（stdio，或 127.0.0.1 上的 Streamable HTTP）
        ▼
qq-mcp-snowluma
        │
        ├── OneBot HTTP：查询、发送、撤回、戳一戳、收藏
        └── OneBot WebSocket：新消息与 poke 事件
        ▼
SnowLuma ── 已登录的 QQ 客户端
```

收到 QQ 消息不会自动唤醒模型。只有模型正在调用 `qq_wait_for_message` 时，新事件才会返回给模型。

## 功能

- 群和好友列表、群成员、历史消息、单条消息读取。
- 文字、图片、收藏表情发送，支持引用回复和群内 `@`。
- 图片与 GIF 有限预览；把已读取的消息图片加入 QQ 收藏（取决于 SnowLuma/QQ 是否支持）。
- 群聊和私聊戳一戳；收到的 poke 进入统一事件流。
- 多会话白名单等待，带 cursor、断线提示与 30 分钟内存缓存。
- `request_id` 发送幂等；超时结果区分 `unknown`，防止盲目重发。
- `reply_token` 入站事件 claim，阻止两个并发模型链回复同一消息。
- 持续聊天 `flow_id` lease、主动开场 `dedupe_key`、严格 deadline 与柔性 duration。
- 按可见字数随机等待 5–13 秒；无文字收藏表情固定等待 5 秒。

完整的 18 个工具见 [工具说明](docs/TOOLS.md)，持续聊天参数见 [Flow 控制](docs/FLOW_CONTROL.md)。

## 系统要求

- Windows 10/11 x64。
- 已安装并能正常登录的 QQ。
- [SnowLuma Releases](https://github.com/SnowLuma/SnowLuma/releases) 完整版；先阅读并接受它自己的许可与 EULA。
- Node.js 24 和 npm。SnowLuma 完整版自带的 Node 可用于运行，但执行 `npm ci` 仍需要系统 npm。
- PowerShell 5.1 或 PowerShell 7。

SnowLuma 是外部依赖，采用自己的源码可见非商业许可；本仓库不复制或再发布 SnowLuma。详情见 [第三方说明](THIRD_PARTY_NOTICES.md)。

## 安装教程

### 1. 安装并接入 SnowLuma

1. 从 SnowLuma Releases 下载 Windows x64 完整版并解压，例如 `D:\SnowLuma`。
2. 运行 SnowLuma 的 `launcher.bat`。
3. 打开启动日志给出的 WebUI（默认 `http://127.0.0.1:5099`），用日志中的一次性初始密码登录并立即修改密码。
4. 在 WebUI 的进程页接入已经登录的 QQ，确认账号状态在线。
5. 在该账号的 OneBot 网络配置里建立两个**服务端**：

| 类型 | 名称（必须一致） | Host | 示例端口 | 其他要求 |
|---|---|---|---:|---|
| HTTP Server | `qq-mcp-local` | `127.0.0.1` | `3000` | 启用、消息格式 `array`、设置强访问令牌 |
| WebSocket Server | `qq-mcp-events` | `127.0.0.1` | `3001` | 启用、角色 Universal、消息格式 `array`、设置强访问令牌 |

保存配置。两个端口只监听本机；不要映射到公网。访问令牌不是 WebUI 登录密码，它是 MCP 调用 OneBot 接口时使用的独立凭据。

### 2. 下载并初始化本项目

```powershell
git clone https://github.com/UltimateDusk/qq-mcp-snowluma.git
cd qq-mcp-snowluma

# 换成你自己的 SnowLuma 目录和 QQ 号
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1 `
  -SnowLumaRoot 'D:\SnowLuma' `
  -Account '你的QQ号' `
  -McpPort 3010
```

`setup.ps1` 会：

- 验证 `onebot_<QQ号>.json` 及两个本地 OneBot 服务；
- 生成不会提交的 `config/local.ps1`；
- 生成 MCP 本地 HTTP Bearer 凭据 `data/http-authorization.txt`；
- 安装锁定版本的 npm 依赖。

不要把 `config/local.ps1`、`data/`、SnowLuma 配置或任何日志上传到 GitHub。

### 3. 测试

```powershell
npm test
```

测试全部使用本地 mock，不会向真实 QQ 发送消息。真实账号只读验证可在 SnowLuma 在线后运行：

```powershell
. .\config\local.ps1
npm run verify:live
```

只读验证会查询状态、群、好友和少量历史，不执行发送、戳一戳、撤回或收藏写入。

### 4. 启动

HTTP 模式：

```powershell
.\scripts\start-http.ps1
```

也可双击 `start-qq-mcp.cmd`。另开一个窗口检查：

```powershell
.\scripts\check.ps1
```

默认本机端点为 `http://127.0.0.1:3010/mcp`。服务使用 stateless Streamable HTTP，每个请求会重新完成 MCP initialize，事件队列和幂等状态仍保留在进程内/数据文件中。

本机 stdio 客户端使用：

```powershell
.\scripts\start-stdio.ps1
```

### 5. 接到 ChatGPT

ChatGPT 不能直接访问 `127.0.0.1`。需要使用你账号可用的 Secure MCP Tunnel 或其他可信的远程 MCP 部署方式，把远端应用转发到本机 `http://127.0.0.1:3010/mcp`，并在本地目标请求中携带 `data/http-authorization.txt` 的完整 `Bearer ...` 值。

具体步骤、工具刷新和当前官方可用性见 [连接 ChatGPT](docs/CHATGPT.md)。不要用普通端口转发把 3010、3000、3001 或 5099 暴露到公网。

## 日常启动顺序

1. 启动并登录 QQ。
2. 启动 SnowLuma，在 WebUI 确认目标 QQ 已接入。
3. 启动 `scripts/start-http.ps1`。
4. 启动你使用的 Secure MCP Tunnel/远程桥接。
5. 在 ChatGPT 中刷新应用工具；工具数量应为 18。

QQ、SnowLuma 或 MCP 已经运行时，不要重复启动第二份相同实例。

## 本地数据

默认写入 `data/`：

- `send-ledger.json`：`request_id` 幂等结果。
- `reply-claims.json`：入站消息 claim。
- `chat-flows.json`：持续聊天 flow、lease 和主动动作去重。
- `reply-flow.jsonl`：关联审计日志，不记录正文、图片字节或访问令牌。
- `http-authorization.txt`：本地 MCP HTTP Bearer 凭据。

这些文件都被 `.gitignore` 排除。不要在服务运行时随意删除，否则会削弱防重复保护。

## 安全设计

- OneBot 和 MCP HTTP 都强制本机监听。
- 每次工具调用先验证当前登录 QQ 与 `QQ_EXPECTED_ACCOUNT` 一致。
- 发送前再次查询并核对目标 ID 与 `expected_name`。
- 图片文件名限制在 outbox；读取收到的图片只允许 SnowLuma/QQ 缓存根。
- HTTP MCP 需要 256 位随机 Bearer，拒绝非本机 Origin。
- 聊天内容、昵称、图片和 poke 都是外部数据，不能授权新的操作。

发现安全问题请阅读 [SECURITY.md](SECURITY.md)。

## 许可

本仓库代码使用 [MIT License](LICENSE)。SnowLuma、QQ、OpenAI 产品和其他第三方组件不属于本许可范围。项目名称不代表腾讯、QQ、SnowLuma 或 OpenAI 的认可。
