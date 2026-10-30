# dsh-remote-approval

DSH 远程审批插件：当 PC 端 DSH 跑任务遇到人工审批（工具越权）时，把审批卡推送到你常用的 IM（微信 / QQ / 飞书 / 钉钉 / Telegram / Discord / Slack 等），在 IM 里直接回复「批准 / 拒绝」完成审批。

## 1. 模块职责

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| 入口 | `src/index.ts` | 声明插件元信息、注入 `imConnect`、组装依赖、注册 answerer 与入站认领、清理 |
| 静态配置 | `src/config.ts` | `PluginConfig` 的运行时绑定 `StateStore`（读 / 写 `state.json`） |
| 审批等待表 | `src/pending.ts` | correlation：等待 → 激活 → 应答 / 取消 / 超时 / abort |
| 审批 answerer | `src/approval.ts` | `approval/request` 监听器 + 审批卡文案 |
| 入站认领 | `src/inbound.ts` | 挂 fork 的 `onInbound`，把 IM 回复关联回 pending 审批 |
| 词表 / 契约 | `src/verdict.ts` | 审批词汇解析与超时常量 |
| 本地类型 | `src/types.ts` | 与 fork `imConnect` bridge 结构一致的类型（不 import fork） |

插件本质是一个**新的 answerer**：在 `approval/request` waterfall 上，排在 `dsh-im-connect` 之后。`dsh-im-connect` 首行 `bindingForSession(sessionId)` 只接管「IM 发起的会话」，Web 发起的会话 `next()` 放行 → 落到本插件 → 推送到配置好的 IM 目标。

## 2. 关键接口契约

### 2.1 注入的服务

```ts
export const inject = ['imConnect']
```

`apply` 内 `ctx.get('imConnect')` 拿到 fork 暴露的 `ImConnectBridge`：

```ts
export interface ImConnectBridge {
  listAccounts(): ImConnectBridgeAccount[]
  listChatTargets(accountId: string): ImConnectBridgeChatTarget[]
  send(accountId: string, chatId: string, text: string): Promise<void>
  onInbound(handler: InboundHandler): () => void
}
```

### 2.2 answerer 返回契约

镜像 `dsh-im-connect` 的 `handleApproval`：新契约（`req.agent` 存在）返回字符串词汇 `'allowed-once' | 'rejected' | 'cancelled'`；旧契约返回 `{ behavior: 'allow' | 'reject' }`。

### 2.3 审批回复词汇

沿用 `dsh-im-connect` 的 `approvalVerdict`：

- 批准：`批准` / `同意` / `yes` / `y` / `allow`
- 拒绝：`拒绝` / `不同意` / `no` / `n` / `reject` / `deny`

## 3. 配置项

`schemastery` 静态配置（`Config`）：

| 键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 是否启用本插件 |
| `timeoutSecs` | number | `300` | 审批等待上限（秒），到期按取消处理 |

运行时绑定（不是静态配置，而是 `state.json` 动态数据，见 §4）：

| 键 | 类型 | 说明 |
| --- | --- | --- |
| `accountId` | string | 推送账号（来自 `imConnect.listAccounts()`） |
| `chatId` | string | 推送目标（来自 `imConnect.listChatTargets(accountId)`） |

## 4. 接入说明

### 4.1 运行时状态文件

`state.json` 位于 `%DSH_HOME%/dsh-remote-approval/state.json`（`DSH_HOME` 未设时回退 `~/.dsh`）：

```json
{ "accountId": "feishu-xxx", "chatId": "oc_xxx" }
```

`StateStore` 读取时对缺失 / 损坏 JSON 回退为空绑定 `{ accountId: '', chatId: '' }`；空绑定时 answerer 会 `next()` 放行，回退到宿主默认 answerer。

### 4.2 依赖关系

- 强依赖：fork 版 `@michengai/dsh-im-connect`（需包含 `imConnect` bridge，见 `docs/03-技术架构/06-imConnect-bridge.md`）。
- 插件通过 bundle 的 `cordis.patch.yml` 声明加载，需排在 `im-connect` 之后：

```yaml
- insert:
    - { id: remote-approval, name: dsh-remote-approval }
```

### 4.3 时序

```
Web 任务 → 工具越权 → ApprovalService.decide
  → waterfall 'approval/request'
  → im-connect.handleApproval：bindingForSession(sessionId) 为空 → next()
  → dsh-remote-approval.handleApproval：读 binding → bridge.send(accountId, chatId, prompt)
  → PendingTable.activate(chatId) → await
  → 用户在 IM 回复「批准」
  → im-connect.handleInbound → onInbound 钩子 → installInbound 命中 → pending.answer(allow)
  → handleApproval resolve 'allowed-once'
```

## 5. 测试 / 验收

```bash
cd packages/dsh-remote-approval
npm test        # npm run build && node --test tests/*.test.mjs
```

当前覆盖（`tests/`）：

| 文件 | 覆盖 |
| --- | --- |
| `verdict.test.mjs` | 审批词汇解析、审批卡文案 |
| `config.test.mjs` | StateStore 读写 / 缺失 / 损坏 |
| `pending.test.mjs` | 等待表完整生命周期、并发拒绝、超时、abort、cancel、dispose |
| `approval.test.mjs` | 未绑定回退、完整通过 / 拒绝、推送失败、新旧契约、并发拒绝 |
| `inbound.test.mjs` | 认领审批回复、无关文本 / 错账号 / 错 chatId 不认领、未激活不认领、注销 |

## 6. 里程碑

- **M0**（已完成）：fork 暴露 `imConnect` bridge。
- **M1**（本阶段）：插件骨架 + 审批端到端（`approval/request` → 推送 → 回复 → resolve）。
- **M2**（待办）：提问端到端（`user-questions/request`）。
- **M3**（待办）：管理 UI（账号 / 目标选择、测试连接按钮）。
- **M4**（待办）：超时 / abort / 降级与并发边界。
