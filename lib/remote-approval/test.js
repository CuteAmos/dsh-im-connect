/** 审批样例卡文本，带【测试】前缀，避免与真实审批混淆。 */
export function buildTestApprovalText() {
    return [
        '【测试】DeepSeek Harness 需要你的审批：',
        '',
        '工具：测试工具',
        '原因：这是「测试连接」推送的样例消息，忽略即可。',
        '',
        '请精准回复「批准」或「拒绝」（真实审批才会这样收到推送）。',
    ].join('\n');
}
/** 提问样例文本，带编号选项，带【测试】前缀。 */
export function buildTestQuestionText() {
    return [
        '【测试】DeepSeek Harness 需要你补充信息：',
        '',
        '测试问题',
        '',
        '1. 选项A',
        '2. 选项B',
        '',
        '请回复一个选项序号或文字（真实提问才会这样收到推送）。',
    ].join('\n');
}
/**
 * 测试连接：校验账号连通性与目标有效性，然后主动推一条审批样例与一条
 * 提问样例到目标 chatId。v1 只做单向推送，不做端到端往返（DESIGN §5.6）。
 */
export async function testConnection(deps, input) {
    const accountId = typeof input.accountId === 'string' ? input.accountId.trim() : '';
    const chatId = typeof input.chatId === 'string' ? input.chatId.trim() : '';
    if (!accountId)
        return { ok: false, accountId, chatId, approvalPushed: false, questionPushed: false, error: '请先选择账号' };
    if (!chatId)
        return { ok: false, accountId, chatId, approvalPushed: false, questionPushed: false, error: '请先选择聊天目标' };
    const warnings = [];
    const accounts = deps.bridge.listAccounts();
    const account = accounts.find((item) => item.accountId === accountId);
    if (!account) {
        return { ok: false, accountId, chatId, approvalPushed: false, questionPushed: false, error: `账号不存在：${accountId}` };
    }
    if (!account.connected) {
        return { ok: false, accountId, chatId, approvalPushed: false, questionPushed: false, error: `账号未连接：${account.name || accountId}` };
    }
    let bound = false;
    try {
        bound = deps.bridge.listChatTargets(accountId).some((target) => target.chatId === chatId);
    }
    catch {
        // 历史绑定查询失败不阻塞测试
    }
    if (bound)
        warnings.push('该目标命中历史绑定记录');
    let approvalPushed = false;
    try {
        await deps.bridge.send(accountId, chatId, buildTestApprovalText());
        approvalPushed = true;
    }
    catch (error) {
        return {
            ok: false,
            accountId,
            chatId,
            approvalPushed: false,
            questionPushed: false,
            warnings: warnings.length ? warnings : undefined,
            error: `审批测试消息发送失败：${error instanceof Error ? error.message : String(error)}`,
        };
    }
    let questionPushed = false;
    try {
        await deps.bridge.send(accountId, chatId, buildTestQuestionText());
        questionPushed = true;
    }
    catch (error) {
        return {
            ok: false,
            accountId,
            chatId,
            approvalPushed,
            questionPushed: false,
            warnings: warnings.length ? warnings : undefined,
            error: `提问测试消息发送失败：${error instanceof Error ? error.message : String(error)}`,
        };
    }
    deps.log(`[test] 测试连接成功 accountId=${accountId} chatId=${chatId}`);
    return {
        ok: true,
        accountId,
        chatId,
        approvalPushed,
        questionPushed,
        ...(warnings.length ? { warnings } : {}),
    };
}
//# sourceMappingURL=test.js.map