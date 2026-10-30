# 连接 ChatGPT

## 前提

本服务默认只监听 `127.0.0.1`。ChatGPT 无法直接访问电脑的 localhost。OpenAI 当前说明，本机或私网 MCP 应使用 Secure MCP Tunnel 连接，不应把本机端口直接暴露到公网：

- [Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt)

ChatGPT 自定义 MCP 应用的套餐、工作区权限、网页端/移动端可用性仍在变化。以你的账号界面和官方页面为准；本仓库无法替你开通该功能。

## 本地目标

先启动 QQ、SnowLuma 和本 MCP。隧道的本地目标应是：

```text
http://127.0.0.1:3010/mcp
```

如果 setup 时改了端口，就使用实际端口。目标请求需要：

```text
Authorization: <data/http-authorization.txt 的完整一行>
```

该文件内容已经带 `Bearer ` 前缀。它只用于“隧道客户端 → 本地 MCP”的认证；它不是 SnowLuma OneBot access token、WebUI 密码、OpenAI API Key 或 Tunnel ID。

## 创建应用

当你的 ChatGPT 账号提供 Secure MCP Tunnel 时：

1. 在 ChatGPT 的 Apps/Developer Mode 中创建一个新的 MCP 应用或 Tunnel，名称可设为 `QQ`。
2. 在本机安装并登录官方提供的 Secure MCP Tunnel 客户端。
3. 新建独立 profile，把远端应用/Tunnel ID 连接到上述本地 MCP URL。
4. 让隧道的本地请求携带 MCP HTTP Bearer；OpenAI Runtime Key、Tunnel ID 和 Bearer 分别保存，不写入仓库。
5. 启动 profile，确认本地 `scripts/check.ps1` 和隧道健康页都 ready。
6. 回到 ChatGPT 扫描或刷新工具；应显示 18 个 `qq_*` 工具。
7. 回到原来的对话，重新选择或 `@QQ`，先调用 `qq_status` 做只读验证。若原对话仍使用旧工具 schema，再新开对话排障。

Secure MCP Tunnel 的具体 CLI 参数由 OpenAI 客户端版本决定，因此本仓库不硬编码可能过期的命令。按你创建 Tunnel 时页面生成的官方命令配置。

## 更新工具后

MCP 代码更新不会自动刷新 ChatGPT 保存的工具 schema。请在应用管理页执行 **Refresh/Scan Tools**，回到原来的对话并重新 `@QQ`；实测无需专门新建对话。工具仍是 18 个时，不代表没更新，可检查某个工具是否出现新参数，例如 `flow_target_duration_ms`。如果原对话仍显示旧参数、找不到工具或调用继续报旧版参数错误，再新开对话作为备用排障步骤。

## 不要这样做

- 不要在路由器、Cloudflare Tunnel、ngrok 或 VPS 上直接公开 3000、3001、3010、5099。
- 不要把 `data/http-authorization.txt` 当作公开 URL 参数。
- 不要把 OpenAI Runtime Key、Tunnel ID、SnowLuma access token 或 WebUI 密码提交到 GitHub Issue。
- 不要为同一个 QQ 同时运行两份 MCP 或两套 OneBot 客户端。
