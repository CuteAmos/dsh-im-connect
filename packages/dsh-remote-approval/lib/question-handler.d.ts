import { type UserQuestionAnswer, type UserQuestionRequestLike } from './question.js';
import type { QuestionPending } from './question.js';
import type { RemoteApprovalState } from './config.js';
import type { ImConnectBridge } from './types.js';
/** 提问 answerer 的依赖。 */
export interface QuestionDeps {
    bridge: ImConnectBridge;
    questions: QuestionPending;
    timeoutSecs: number;
    readBinding(): RemoteApprovalState;
    log(line: string): void;
}
/** 从 bridge 的历史绑定里解析 chatId 的聊天类型；纯推送场景可能查不到。 */
export declare function resolveKind(bridge: ImConnectBridge, accountId: string, chatId: string): 'dm' | 'group' | undefined;
/**
 * 提问 answerer。作为 `user-questions/request` 的普通顺序监听器，排在
 * im-connect 之后，只接管其 `next()` 放行的 Web 会话。
 *
 * 返回 `UserQuestionAnswer`；校验失败 / abort / 发送失败时 throw（镜像 fork
 * `onUserQuestions`）。
 */
export declare function handleUserQuestions(req: UserQuestionRequestLike, next: () => Promise<UserQuestionAnswer>, deps: QuestionDeps): Promise<UserQuestionAnswer>;
//# sourceMappingURL=question-handler.d.ts.map