import type { ImConnectBridge } from './types.js';
/** 测试连接的依赖：注入的 bridge 与运行时绑定读取器。 */
export interface TestConnectionDeps {
    bridge: ImConnectBridge;
    log(line: string): void;
}
/** 测试连接的结果契约，与 DESIGN §5.6 一致。 */
export interface TestConnectionResult {
    ok: boolean;
    accountId: string;
    chatId: string;
    approvalPushed: boolean;
    questionPushed: boolean;
    error?: string;
    warnings?: string[];
}
/** 审批样例卡文本，带【测试】前缀，避免与真实审批混淆。 */
export declare function buildTestApprovalText(): string;
/** 提问样例文本，带编号选项，带【测试】前缀。 */
export declare function buildTestQuestionText(): string;
/**
 * 测试连接：校验账号连通性与目标有效性，然后主动推一条审批样例与一条
 * 提问样例到目标 chatId。v1 只做单向推送，不做端到端往返（DESIGN §5.6）。
 */
export declare function testConnection(deps: TestConnectionDeps, input: {
    accountId?: unknown;
    chatId?: unknown;
}): Promise<TestConnectionResult>;
//# sourceMappingURL=test.d.ts.map