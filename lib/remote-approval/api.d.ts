import type { Context } from '@deepseek-ai/cordis';
import type { Readable } from 'node:stream';
import type { ImConnectBridge } from './types.js';
import type { StateStore } from './config.js';
interface ApiBodyReadResult {
    body: Record<string, unknown>;
    oversized: boolean;
    invalidJson: boolean;
}
/** 累计原始字节后一次性解码，避免 UTF-8 多字节跨 chunk 被替换字符破坏（照抄 fork）。 */
export declare function readApiJsonBody(req: Readable, maxBodyBytes?: number): Promise<ApiBodyReadResult>;
/** 本插件管理 API 的依赖。 */
export interface ApiDeps {
    bridge: ImConnectBridge;
    state: StateStore;
    log(line: string): void;
}
/**
 * 注册 `/api/dsh-remote-approval` 前缀管理 API，供配置页读取账号/目标、
 * 读写绑定、测试连接。身份认证与写请求格式校验完全照抄 fork `registerApi`。
 */
export declare function registerApi(ctx: Context, deps: ApiDeps): () => void;
export {};
//# sourceMappingURL=api.d.ts.map