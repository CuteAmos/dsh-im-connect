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
 * 提问 answerer。作为 `user-questions/request` 的 prepend 监听器，排在
 * im-connect 与 api-remotes 之前。对 IM 会话直接 next() 交还 im-connect；
 * 对 Web 会话（需求③）实现「PC 与 IM 并存」：先推 IM，再 next() 放行让
 * PC 端提问卡也弹出，二者 `Promise.race`，任一方先答完即返回，释放另一方。
 *
 * 返回 `UserQuestionAnswer`；校验失败 / abort / 发送失败时 throw（镜像 fork
 * `onUserQuestions`）。PC 无消费者时 next() 会 reject（NO_PROVIDER），视为
 * 弃权继续等 IM；IM 超时 / abort 不是「答完」，继续等 PC。
 */
export declare function handleUserQuestions(req: UserQuestionRequestLike, next: () => Promise<UserQuestionAnswer>, deps: QuestionDeps): Promise<UserQuestionAnswer>;
//# sourceMappingURL=question-handler.d.ts.map