# 1.7 持续聊天策略

本版本扩展现有 flow / lease / reply claim；没有新增自动唤醒模型的后台聊天器。18 个工具保持不变。需要更新代码、重启 MCP 后端、刷新工具，再在原对话重新 `@QQ`。

## 60 秒滚动会话

明确的“聊五分钟”仍使用 `flow_duration_ms=300000`；“聊半小时左右”仍可使用 target/max。没有指定总时长的“聊一会，看情况结束”，传 `flow_id`、`execution_id` 和单一会话即可默认创建 rolling flow，也可显式 `flow_rolling=true`。

```json
{
  "target_type": "group",
  "target_id": "10001",
  "flow_id": "group-chat-task-001",
  "execution_id": "execution-001",
  "flow_rolling": true,
  "flow_rolling_max_ms": 1800000,
  "timeout_ms": 60000,
  "batch_window_ms": 7000
}
```

首次有效期 60 秒，绝对最长时限默认 30 分钟。模型决定留下时，在**下次 wait** 中复用 flow/执行 ID、lease 和 `next_cursor`，传 `flow_renew=true`。续期将有效期延到当前时间加 60 秒，但不会超过首次固定的绝对上限，也不会复活已经结束的 flow。首次若要开场，send 同样可以创建 rolling flow；继续复用其 lease。

- 必须有本 flow 新收到的入站活动，重读旧批次、空 wait 或重复续期不能延长时间。
- 不想继续时，不续期，或显式传 `flow_end_reason=idle/manual_end`。
- `renew_requires_new_activity` / `ai_only_renewal_paused` 表示本次续期被拒绝，不一定表示整个 flow 已结束；查看 `chat_flow.flow_phase` 与 `ended_reason`。可以不带 renew 再等待到当前截止，或收尾。
- 续期、hard、soft 不混用。rolling 到期不再发送；原 hard/soft 保留最多一次有限收尾回复。

## AI 互聊信号

QQ 消息没有可靠的“真人/AI”身份标识。服务器只把本地配置 `QQ_AI_USER_IDS` 中的账号标为 `configured_ai`；其他账号为 `unknown`。风格启发式是弱提示，引用 AI 文本或开玩笑也可能命中。

模型应综合上下文，通过 `flow_activity_observation` 对**上一批新消息**提供 `human_active`、`suspected_ai_only` 或 `unknown`。不需要用户逐个配置 QQ 号；名单只是可选增强。`human_active` 同样是推测，不代表验证身份。

- 连续疑似/已配置 AI 互聊批次：增加发送延迟。
- 连续 3 批：暂停 rolling 续期，禁止新主动话题，仍可使用 `dedupe_key=closing` 收尾。
- 连续 6 批：自动以 `ai_only_loop` 结束；若之前先到当前截止，也会以该原因结束。
- 新一批真人活跃判断或未知活动会清除连续计数；反复读取同批消息不会增加计数。
- 日志和状态包含 `activity_assessment`、`assessment_is_inferred`、`suspected_ai_rounds`，便于判断误报。不要把这些字段当身份认证或安全授权。

单靠文本不能保证识别所有机器人；模型不提供判断、风格信号也未命中时，不会凭空认定对方是 AI。60 秒未续期截止和绝对最长时限仍生效。

## 延迟、合并和优先级

默认发送目标间隔为 **8–40 秒**，短句/纯表情偏快，长句偏慢；最近 60 秒同会话连续发送、多 AI 活跃和疑似 AI 轮次增加等待。最终目标间隔不超过 40 秒，返回 `pacing` 并记录各项原因及实际等待。

该间隔从收到消息及上次发送时间计算，模型已经花掉的处理时间会抵扣，不会再完整等待一轮。模型处理、队列排队、网络时间可能使总耗时超过 40 秒；日志单列 `queue_wait_ms` 与 `actual_wait_ms`。显式配置的 `QQ_SEND_DELAY_MIN_MS/MAX_MS` 仍可覆盖默认范围。

rolling 的 wait 默认从首条匹配消息起合并 **7 秒**，`batch_window_ms` 可设 5000–10000（也可 0 关闭）。不会因后续不断来消息而无限延长，受 wait/deadline 和每批 100 条上限限制。普通 wait 和原 hard/soft 默认仍是旧的 200 ms 合并窗口，可显式设置。

`events/messages` 保持原始时间顺序，`reply_order` 提供本批建议优先级：@自己、回复自己或疑似问题 > 普通聊天 > 笑声/纯表情。问题识别也是启发式；优先级不删除消息、不跨过尚未返回的事件。模型可以合并回复同会话的几条消息，发送时传实际涉及的**全部** `reply_tokens`。

## 图片和回复上下文

`qq_read_image` / `qq_read_animation` 会尝试 `get_image` 返回的多个来源；失败时最多刷新一条已读父消息，再重试一次 `get_image`。只访问受允许的 QQ 域名/缓存路径，不猜测替换带签名 URL 的域名，不跟随重定向。网络尝试受 20 秒总预算限制，失败返回 `media.original_error` 和脱敏后的逐次错误。

GIF 默认已经返回第一帧与最多六帧关键帧拼图；短于六帧时展示所有帧，可用 `mode=frames` 获取分帧。不是只返回第一帧。

wait 默认补充 `[reply]` 的 `reply_context`，最多查询 8 条引用，采用短超时与总时间预算。失败时标记 `unavailable/deferred`，不丢弃原消息；可设 `include_reply_context=false` 关闭。

## 游标恢复、退出原因和输入状态

- `data/events.json` 保存最近事件正文、媒体链接和游标，受原 30 分钟 / 1000 条 / 16 MiB 内存容量限制；持续运行时定期裁剪，重启时再次裁剪。该文件是私人缓存，不能上传 GitHub。
- flow 只保存调用者**已经带回来确认的** cursor（`resume_cursor`），不把“服务器已返回但客户端可能没收到”的消息自动当作已消费。后续带同一 flow 但省略 cursor 时从此位置恢复；可能重放，reply claim 继续防止重复回复。新 flow 可显式传旧 flow 的 `resume_cursor`。
- 断线或重启后增加 generation，并提示 `history_check_required`。停机期间上游未投递的消息仍需补查历史；无法绕过 OpenAI 429 或保证补齐超过 retention 的消息。
- 可显式结束为 `idle`、`human_left`、`ai_only_loop`、`manual_end`、`cancelled`、`error`；保留 `target_reached/deadline/idle_after_target`。`human_left` 是模型判断，不是客户端检测到人离开。
- 审计记录续期次数、退出原因、lease owner、request ID 和发送延迟原因，不记录消息正文；事件缓存与审计日志是不同文件。
- send 可设 `show_typing=true`，仅私聊尝试 `set_input_status`，在等待后清除。群聊返回 unsupported；协议拒绝时返回 unavailable/unsupported，不阻断发送。是否在对方客户端实际显示仍由 QQ/SnowLuma 决定。
