import { type QuestionPending } from './question.js';
import type { ImConnectBridge } from './types.js';
import type { RemoteApprovalState } from './config.js';
import type { PendingTable } from './pending.js';
/** 入站认领依赖。 */
export interface InboundDeps {
    bridge: ImConnectBridge;
    pending: PendingTable;
    questions: QuestionPending;
    readBinding(): RemoteApprovalState;
    log(line: string): void;
}
/**
 * 把入站消息认领钩子挂到 fork 的 `onInbound`，返回注销函数。
 * 命中本插件 pending 的审批回复 / 提问答案时返回 true（短路 im-connect 正常
 * 流程），否则返回 false（继续原流程）。单账号路由下用 chatId 匹配。
 */
export declare function installInbound(deps: InboundDeps): () => void;
//# sourceMappingURL=inbound.d.ts.map