import Schema from '@deepseek-ai/schemastery';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { ChannelManager } from './manager.js';
import { ImConnectBridgeService } from './bridge.js';
import { createRotatingFileAppender } from './engine/file-log.js';
import { registerPluginUpdater } from './plugin-updater.js';
import { withReplyLocale } from './engine/command-locale.js';
import { setupRemoteApproval } from './remote-approval/index.js';
export const name = 'dsh-im-connect';
export const inject = [
    'webServer',
    'credentials',
    'agents',
    'agentPresets',
    'agentDefaultModel',
    'llm',
    'permissionPresets',
    'systemPrompt',
];
export const Config = Schema.object({
    stateDir: Schema.string().default(''),
    cwd: Schema.string().default(process.cwd()),
    provider: Schema.string().default(''),
    model: Schema.string().default(''),
    agentPreset: Schema.string().default('standard'),
    mergeTimeoutSecs: Schema.number().default(5),
    topicNaming: Schema.union(['once', 'follow', 'off']).default('once'),
    segmentReply: Schema.boolean().default(false).description('分段回复：助手按标记把一次回复拆成多条消息。'),
    segmentMarker: Schema.string().default('<<<MSG>>>').description('分段回复的分隔标记，必须独占一行。'),
    segmentDelayMinSecs: Schema.number().default(1).description('相邻两条分段消息之间随机间隔的下界（秒）。'),
    segmentDelayMaxSecs: Schema.number().default(2).description('相邻两条分段消息之间随机间隔的上界（秒）。'),
    updater: Schema.boolean(),
    onlineUpdate: Schema.boolean(),
    remoteApproval: Schema.object({
        enabled: Schema.boolean().default(true).description('远程审批：把 Web 发起任务的人工审批 / 引导提问推送到配置的 IM 完成。'),
        timeoutSecs: Schema.number().min(1).default(300).description('审批 / 提问等待回复的超时（秒），超时视为取消。'),
    }),
});
export function apply(ctx, config) {
    const hostUpdateDisabled = config.updater === false || config.onlineUpdate === false;
    const permissionPresets = ctx.permissionPresets;
    const stateDir = config.stateDir !== ''
        ? config.stateDir
        : join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-im-connect');
    mkdirSync(stateDir, { recursive: true });
    const logFile = join(stateDir, 'gateway.log');
    const fileLog = createRotatingFileAppender(logFile);
    const log = (line) => {
        const stamped = `${new Date().toISOString()} ${line}`;
        ctx.logger(name).info(line);
        fileLog.append(`${stamped}\n`);
    };
    const engineConfig = {
        cwd: config.cwd || process.cwd(),
        provider: config.provider,
        model: config.model,
        agentPreset: config.agentPreset || 'standard',
        mergeTimeoutSecs: config.mergeTimeoutSecs || 5,
        permissionPreset: permissionPresets.defaultPreset,
        topicNaming: config.topicNaming ?? 'once',
        segmentReply: config.segmentReply === true,
        segmentMarker: config.segmentMarker,
        segmentDelayMinSecs: config.segmentDelayMinSecs,
        segmentDelayMaxSecs: config.segmentDelayMaxSecs,
    };
    const applyStarted = Date.now();
    const manager = new ChannelManager({ ctx, stateDir, log, engineConfig, hostUpdateDisabled });
    const bridge = new ImConnectBridgeService(manager);
    ctx.provide('imConnect', bridge);
    log(`[boot] ChannelManager 构造 ${Date.now() - applyStarted}ms`);
    // 远程审批组件：bridge 已就绪，同步装配（answerer / 入站认领 / 管理 API）。
    // 独立 state 目录保持与旧独立插件一致，避免与 im-connect 的 channels 混用。
    const remoteApprovalStateDir = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-remote-approval');
    const disposeRemoteApproval = setupRemoteApproval(ctx, {
        bridge,
        enabled: config.remoteApproval?.enabled !== false,
        timeoutSecs: config.remoteApproval?.timeoutSecs ?? 300,
        stateDir: remoteApprovalStateDir,
        log,
    });
    ctx.effect(() => disposeRemoteApproval, 'dsh-remote-approval.lifecycle');
    // 分段回复：把「用标记分隔多条消息」的规则挂进系统提示。
    // 只有本插件已绑定、且该账号开启了分段回复的会话才拿到这段说明，其余会话提示词不变。
    const promptHost = ctx;
    // 排在部署人设后缀之后：格式类规则放在提示词末尾更容易被遵循。
    // 宿主没有对应槽位时退回人设后缀的默认序号 10200 之后。
    const sectionOrder = (() => {
        try {
            const order = promptHost.systemPrompt?.getSectionOrder?.('DEPLOYMENT_PERSONA_SUFFIX');
            if (typeof order === 'number' && Number.isFinite(order))
                return order + 10;
        }
        catch { /* 注册表没有该方法时退回默认值 */ }
        return 10210;
    })();
    ctx.effect(() => {
        const systemPrompt = promptHost.systemPrompt;
        if (!systemPrompt)
            return () => { };
        return systemPrompt.section({
            name: 'im-connect-segments',
            order: sectionOrder,
            text: (context) => {
                const sessionId = context?.agent?.session?.header?.id;
                if (typeof sessionId !== 'string' || sessionId.length === 0)
                    return '';
                return withReplyLocale(ctx, () => manager.segmentInstructionForSession(sessionId));
            },
            interpolate: false,
        });
    }, 'im-connect.segment-section');
    ctx.effect(() => registerPluginUpdater(ctx, {
        endpoint: '/api/michengai/dsh-im-connect/update',
        packageName: '@michengai/dsh-im-connect',
        manifestUrl: new URL('../package.json', import.meta.url),
        isEnabled: async () => !hostUpdateDisabled && manager.isUpdateEnabled(),
    }), 'im-connect.plugin-updater');
    ctx.effect(() => {
        manager.registerApi(ctx);
        // 卸载或初始化失败后不再恢复会话；保留一个完整异常链，避免后台拒绝终止宿主。
        void manager.initEnabled().then(() => manager.attachMappedSessions()).catch(error => {
            fileLog.append(`${new Date().toISOString()} [boot] 初始化失败: ${error instanceof Error ? error.message : String(error)}\n`);
        });
        log(`[boot] apply 完成 ${Date.now() - applyStarted}ms`);
        return () => { manager.disposeApi(); void fileLog.flush(); };
    }, 'im-connect.serve');
}
export { CHANNEL_META, CHANNEL_ORDER, listChannelMeta } from './channels/meta.js';
export { IM_ORIGIN, IM_SESSION_PREFIX, IM_SESSION_PREFIX_LEGACY, createImSessionId, isImOrigin, isImSessionId, isTaskSession, sessionKeyOf, } from './engine/session-id.js';
export { splitText } from './engine/split.js';
export { ImConnectBridgeService, } from './bridge.js';
//# sourceMappingURL=index.js.map