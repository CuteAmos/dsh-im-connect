/** 自持久化运行时绑定：账号与目标是动态数据，走 state.json 而非 schemastery 静态配置。 */
export interface RemoteApprovalState {
    accountId: string;
    chatId: string;
}
/** state.json 的极简读写；缺失或损坏时回退空绑定。 */
export declare class StateStore {
    private readonly file;
    constructor(file: string);
    read(): RemoteApprovalState;
    write(state: RemoteApprovalState): void;
}
//# sourceMappingURL=config.d.ts.map