# 持续聊天 Flow 控制

Flow 用于“去群里聊 5 分钟”或“聊半小时左右”这类需要重复 wait/send 的任务。它同时解决真实时间截止、模型执行链并发、主动开场重复和最后回复收尾。

## 共同字段

- `flow_id`：整段任务保持不变，8–128 字符。
- `execution_id`：当前模型执行链的唯一 ID。跳过思考、取消或重新生成后使用新 ID。
- `flow_lease_token`：首次 wait/send 返回；同一执行链后续调用复用。
- `flow_takeover`：新执行链接管已有 flow 时设为 `true`，旧 lease 立即失效。
- `dedupe_key`：proactive 动作的稳定键，例如 `opening`、`closing`。同一 flow 内同一键最多发送一次。

## 严格时长

“聊 5 分钟”首次调用：

```json
{
  "flow_id": "group-10001-five-minutes",
  "execution_id": "execution-20261029-a",
  "flow_duration_ms": 300000,
  "target_type": "group",
  "target_id": "10001",
  "timeout_ms": 60000
}
```

服务记录固定 `started_at` 和 `deadline_at`。每次 wait 的实际超时为 `min(requested_timeout, remaining_ms)`，后续调用不会把 deadline 向后延。deadline 后停止新 wait 和主动话题；截止前已经收到的一条消息可在有限收尾窗口完成一次回复。

## 柔性时长

“聊半小时左右，自己看着来”首次调用：

```json
{
  "flow_id": "group-10001-around-thirty-minutes",
  "execution_id": "execution-20261029-b",
  "flow_target_duration_ms": 1800000,
  "flow_max_duration_ms": 2100000,
  "flow_idle_end_ms": 180000,
  "target_type": "group",
  "target_id": "10001",
  "timeout_ms": 60000
}
```

30 分钟是目标，35 分钟是绝对上限。`max - target` 同时作为目标前的观察窗口，因此示例在第 25 分钟进入 `winding_down`：

- `active`：正常对话。
- `winding_down`：寻找自然收尾点；`flow_idle_end_ms` 此时才生效。
- `closing`：已到 hard max，只允许处理已经收到的最后一条回复。
- `ended`：任务结束。

到 target 后普通 proactive 新话题会被拒绝。自然告别使用 `dedupe_key: "closing"`；成功或结果不明后 flow 以 `target_reached` 结束。也可在 winding down 的 wait 调用中显式传 `flow_end_reason: "target_reached"`，表示不再发送告别便自然结束。

严格 `flow_duration_ms` 与柔性的 target/max/idle 字段不能混用。

## 取消与错误

上层明确取消整段持续任务时，可在 wait 中传：

```json
{
  "flow_id": "原 flow_id",
  "execution_id": "当前 execution_id",
  "flow_lease_token": "当前 lease token",
  "target_type": "group",
  "target_id": "10001",
  "flow_end_reason": "cancelled"
}
```

内部错误可使用 `error`。普通单次请求取消不会自动结束整段 flow，避免一次网络中断误杀会话。
