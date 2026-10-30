# 故障排查

## `本机 OneBot 接口配置不可用`

检查 SnowLuma 当前账号配置中是否有已启用的 `qq-mcp-local` 和 `qq-mcp-events`，host 必须为 `127.0.0.1` 或 `localhost`，端口合法且 access token 非空。修改后重新运行 `scripts/setup.ps1`。

## `当前登录账号与配置不匹配`

MCP 检测到 SnowLuma 暴露的 QQ 与 `QQ_EXPECTED_ACCOUNT` 不同。停止 MCP，确认接入的 QQ，再重新生成 `config/local.ps1`。不要通过删除账号检查来绕过。

## `/health` 连接被拒绝

`scripts/start-http.ps1` 尚未运行、3010 被占用或进程启动失败。前台运行脚本查看错误；然后执行 `scripts/check.ps1`。

## ChatGPT 只有旧工具

服务端代码与 ChatGPT 工具快照是两层。确认本地进程已重启且 tunnel ready，然后在应用管理页 Refresh/Scan Tools，回到原对话并重新 `@QQ`。实测无需专门新建对话；如果原对话仍显示旧参数或找不到工具，再新开对话排障。当前版本工具数量为 18。

## 群历史为空

SnowLuma 群历史可能需要先收到该群新消息建立锚点。让群里产生一条消息，再调用 `qq_read_history`。空数组不一定表示群里没有历史。

## `cursor_gap: true`

事件 WebSocket 断线、MCP 重启、缓存溢出或 30 分钟 retention 过期。按目标会话调用 `qq_read_history` 补查，然后使用本次 wait 返回的新 cursor 继续。

## 发送返回 `status: unknown`

这表示上游响应超时或连接中断，QQ 端可能已经成功发送。保持原 `request_id`，读取最近历史核对。不要生成新 ID 重发同一内容。

## 同一消息被两个模型链处理

回复 wait 事件必须传 `reply_tokens`。持续聊天还需稳定 `flow_id`、唯一 `execution_id` 与返回的 lease token。新执行链接管时设置 `flow_takeover: true`；主动开场使用稳定 `dedupe_key: "opening"`。

审计关联记录在 `data/reply-flow.jsonl`，不含正文，可用 `flow_id`、event/message ID、claim、request ID、dedupe key 与 message ID 判断重复发生在哪一层。
