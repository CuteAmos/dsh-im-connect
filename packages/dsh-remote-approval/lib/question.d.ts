/**
 * 提问契约与纯函数，与 fork `src/engine/question.ts` 逐字一致（fork 未通过
 * `exports` 暴露这些函数，故在本插件内复制以保持解析协议一致；中文文案内联，
 * 不做 locale 切换）。
 */
export interface UserQuestionOption {
    label: string;
    description?: string;
}
export interface UserQuestionItem {
    id: string;
    question: string;
    detail?: string;
    header?: string;
    options?: UserQuestionOption[];
    multiSelect?: boolean;
    intent?: {
        kind: string;
        approve?: string;
    };
}
export interface UserQuestionAnswerItem {
    id: string;
    selected: string[];
    custom?: string;
}
export interface UserQuestionAnswer {
    answers: UserQuestionAnswerItem[];
}
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
export declare function validUserQuestion(question: unknown): question is UserQuestionItem;
export declare function formatUserQuestion(question: UserQuestionItem, index: number, total: number, options?: {
    requiresMention?: boolean;
    selected?: ReadonlySet<number>;
}): string;
export declare function answerUserQuestion(question: UserQuestionItem, input: string): UserQuestionAnswerItem;
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