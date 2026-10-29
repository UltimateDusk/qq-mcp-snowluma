# 工具说明

服务版本 1.6.0 暴露 18 个工具。

| 工具 | 类型 | 用途 |
|---|---|---|
| `qq_status` | 只读 | QQ/SnowLuma 状态、事件连接和聊天 flow 状态 |
| `qq_list_groups` | 只读 | 列出或搜索群 |
| `qq_list_friends` | 只读 | 列出或搜索好友 |
| `qq_read_history` | 只读 | 读取群/好友历史，支持向前翻页 |
| `qq_get_message` | 只读 | 按消息 ID 读取一条消息 |
| `qq_group_members` | 只读 | 查询群成员 |
| `qq_list_images` | 只读 | 列出 outbox 内可发送图片 |
| `qq_send_text` | 写入 | 发送文字，支持引用和群内 @ |
| `qq_send_image` | 写入 | 发送 outbox 图片或 base64 图片 |
| `qq_read_image` | 只读 | 读取消息图片；GIF 返回有限预览 |
| `qq_read_animation` | 只读 | 第一帧、关键帧拼图或有限分帧 |
| `qq_recall_message` | 写入 | 撤回当前账号自己发送的消息 |
| `qq_wait_for_message` | 只读/等待 | 等待消息和 poke，支持 cursor 与会话白名单 |
| `qq_list_favorite_stickers` | 只读 | 分页列出 QQ 收藏表情 |
| `qq_get_favorite_sticker` | 只读 | 查看一项收藏表情 |
| `qq_send_favorite_sticker` | 写入 | 发送收藏表情原图或动图 |
| `qq_poke_user` | 写入 | 群聊或私聊戳一戳 |
| `qq_add_favorite_sticker` | 写入 | 把最近已读取消息里的图片加入收藏 |

## 发送约束

- 每条逻辑发送使用唯一 `request_id`；同一发送重试必须复用原 ID。
- `status: "unknown"` 表示 SnowLuma/QQ 可能已经完成发送。先读历史核对，禁止换新 ID 盲目重发。
- 回复 `qq_wait_for_message` 的事件时，使用 `send_reason: "reply"` 并传入本次回复涉及的全部 `reply_tokens`。
- 只有用户直接要求的主动发送使用 `send_reason: "proactive"`。
- `expected_name` 必须与服务端刚查到的群名、好友备注或昵称一致。

## 消息等待

`qq_wait_for_message` 默认等 30 秒，最长 60 秒。首次调用不传 cursor，只等待之后的新事件；后续复用上次的 `next_cursor`。

多会话过滤示例：

```json
{
  "target_ids": [
    { "target_type": "group", "target_id": "10001" },
    { "target_type": "private", "target_id": "10002" }
  ],
  "timeout_ms": 30000,
  "after_event_id": "上次返回的 next_cursor"
}
```

`cursor_gap: true` 或 `history_check_required: true` 表示断线、重启或缓存过期可能造成缺口，需要按相关会话读取历史补查。cursor 只在当前 MCP 进程内有效。

## 收藏写入

`qq_add_favorite_sticker.file` 必须来自最近一小时内通过历史、单条消息或 wait 读到的 `image` 段。工具拒绝任意本地路径和 URL。SnowLuma/QQ 若不支持真正写入收藏，会返回 `unsupported` 或 `unknown`，不会伪造成功。
