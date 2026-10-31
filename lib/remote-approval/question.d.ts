/**
 * 提问等待表（correlation），语义镜像 fork `QuestionBroker`，但 key 用 chatId
 * （单账号路由，把 Web 会话的提问推到配置的 IM chatId），并额外加了与审批
 * 一致的超时（timeoutMs）到期按 abort 拒绝。纯函数与契约类型复用 fork。
 */
import { type UserQuestionAnswer, type UserQuestionItem } from '../engine/question.js';
export type { UserQuestionOption, UserQuestionItem, UserQuestionAnswerItem, UserQuestionAnswer, } from '../engine/question.js';
export { validUserQuestion, formatUserQuestion, answerUserQuestion } from '../engine/question.js';
/** `user-questions/request` waterfall 收到的请求最小契约。 */
export interface UserQuestionRequestLike {
    agent?: {
        id?: string;
        session?: {
            id?: string;
        };
    };
    questions?: unknown[];
    signal?: AbortSignal;
}
export interface QuestionReplyResult {
    handled: boolean;
    waitingPresentation?: boolean;
    completed?: boolean;
    next?: {
        question: UserQuestionItem;
        index: number;
        total: number;
    };
}
/**
 * 提问等待表（correlation）。单账号路由下以 chatId 为 key，同一目标同时只
 * 有一个提问交互；多问题逐题推进，语义镜像 fork `QuestionBroker`，额外加了
 * 与审批一致的超时（`timeoutMs`）到期按 abort 拒绝。
 */
export declare class QuestionPending {
    private readonly pending;
    begin(chatId: string, accountId: string, questions: UserQuestionItem[], timeoutMs: number, signal?: AbortSignal): Promise<UserQuestionAnswer> | undefined;
    accountIdOf(chatId: string): string | undefined;
    activate(chatId: string): boolean;
    isReady(chatId: string): boolean;
    current(chatId: string): {
        question: UserQuestionItem;
        index: number;
        total: number;
    } | undefined;
    answer(chatId: string, text: string): QuestionReplyResult;
    cancel(chatId: string, reason?: unknown): boolean;
    dispose(): void;
    private finish;
    private cleanupEntry;
}
//# sourceMappingURL=question.d.ts.map