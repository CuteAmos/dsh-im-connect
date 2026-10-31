import { testConnection } from './test.js';
/** 与 fork 管理 API 一致的写请求头标记。 */
const API_CLIENT_HEADER = 'x-dsh-im-connect-client';
const MAX_API_BODY_BYTES = 1024 * 1024;
class ApiRequestError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
/** 宿主负责身份认证；插件仍限制写请求格式，避免简单跨站表单与错误载荷（照抄 fork）。 */
function validateApiMutation(request) {
    const method = (request.method ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD')
        return undefined;
    const markerValue = request.headers[API_CLIENT_HEADER];
    const marker = Array.isArray(markerValue) ? markerValue[0] : markerValue;
    if (marker !== '1')
        return { status: 403, error: 'forbidden mutation request' };
    const typeValue = request.headers['content-type'];
    const contentType = String(Array.isArray(typeValue) ? typeValue[0] ?? '' : typeValue ?? '').split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/json')
        return { status: 415, error: 'content-type must be application/json' };
    return undefined;
}
/** 累计原始字节后一次性解码，避免 UTF-8 多字节跨 chunk 被替换字符破坏（照抄 fork）。 */
export function readApiJsonBody(req, maxBodyBytes = MAX_API_BODY_BYTES) {
    return new Promise((resolve) => {
        const chunks = [];
        let bytes = 0;
        let oversized = false;
        let settled = false;
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            resolve(result);
        };
        req.on('data', (chunk) => {
            if (oversized)
                return;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > maxBodyBytes) {
                oversized = true;
                chunks.length = 0;
                return;
            }
            chunks.push(buffer);
        });
        req.on('error', () => finish({ body: {}, oversized, invalidJson: true }));
        req.on('end', () => {
            if (oversized) {
                finish({ body: {}, oversized: true, invalidJson: false });
                return;
            }
            try {
                const raw = Buffer.concat(chunks, bytes).toString('utf8');
                const parsed = raw ? JSON.parse(raw) : {};
                const valid = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
                finish({ body: valid ? parsed : {}, oversized: false, invalidJson: !valid });
            }
            catch {
                finish({ body: {}, oversized: false, invalidJson: true });
            }
        });
    });
}
/**
 * 注册 `/api/dsh-remote-approval` 前缀管理 API，供配置页读取账号/目标、
 * 读写绑定、测试连接。身份认证与写请求格式校验完全照抄 fork `registerApi`。
 */
export function registerApi(ctx, deps) {
    const webServer = ctx.webServer;
    if (!webServer) {
        deps.log('[api] 未找到 webServer service，管理 API 未注册');
        return;
    }
    const send = (res, status, body) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(body));
    };
    const readJson = async (req) => {
        const { body, oversized, invalidJson } = await readApiJsonBody(req);
        if (oversized)
            throw new ApiRequestError(413, '请求体超过 1MB 上限');
        if (invalidJson)
            throw new ApiRequestError(400, '请求体不是合法 JSON');
        return body;
    };
    const asString = (value) => (typeof value === 'string' ? value.trim() : '');
    const dispatch = async (method, path, query, readBody, send) => {
        try {
            // 路由段统一从插件前缀之后开始；身份认证只由入口负责。
            const parts = ('/dsh-remote-approval/api' + path).split('/').filter(Boolean);
            const route = parts[2];
            if (route === 'accounts' && parts.length === 3) {
                if (method === 'GET' || method === 'HEAD') {
                    send(200, method === 'HEAD' ? undefined : { ok: true, accounts: deps.bridge.listAccounts() });
                    return;
                }
                send(405, { ok: false, error: 'method not allowed' });
                return;
            }
            if (route === 'targets' && parts.length === 3) {
                if (method === 'GET' || method === 'HEAD') {
                    const accountId = query.get('accountId') ?? '';
                    send(200, method === 'HEAD' ? undefined : { ok: true, targets: deps.bridge.listChatTargets(accountId) });
                    return;
                }
                send(405, { ok: false, error: 'method not allowed' });
                return;
            }
            if (route === 'state' && parts.length === 3) {
                if (method === 'GET' || method === 'HEAD') {
                    send(200, method === 'HEAD' ? undefined : { ok: true, state: deps.state.read() });
                    return;
                }
                if (method === 'POST') {
                    const body = await readBody();
                    const accountId = asString(body.accountId);
                    const chatId = asString(body.chatId);
                    if (accountId && !deps.bridge.listAccounts().some((item) => item.accountId === accountId)) {
                        send(400, { ok: false, error: `账号不存在：${accountId}` });
                        return;
                    }
                    const next = { accountId, chatId };
                    deps.state.write(next);
                    deps.log(`[api] 绑定已更新 accountId=${accountId} chatId=${chatId}`);
                    send(200, { ok: true, state: next });
                    return;
                }
                send(405, { ok: false, error: 'method not allowed' });
                return;
            }
            if (route === 'test' && parts.length === 3) {
                if (method === 'POST') {
                    const body = await readBody();
                    const result = await testConnection(deps, body);
                    send(200, result);
                    return;
                }
                send(405, { ok: false, error: 'method not allowed' });
                return;
            }
            send(404, { ok: false, error: 'not found' });
        }
        catch (error) {
            if (error instanceof ApiRequestError) {
                send(error.status, { ok: false, error: error.message });
                return;
            }
            deps.log(`[api] API 处理失败: ${error instanceof Error ? error.message : String(error)}`);
            send(500, { ok: false, error: '操作失败，请查看本机日志' });
        }
    };
    const basePath = '/api/dsh-remote-approval';
    webServer.register({
        kind: 'prefix',
        path: basePath,
        handler: async (req, res) => {
            try {
                const connection = (typeof ctx.get === 'function' ? ctx.get('connection') : undefined);
                if (typeof connection?.requestRejection !== 'function') {
                    send(res, 503, { ok: false, error: '宿主认证服务尚未就绪或版本不支持；请稍后重试或升级宿主。' });
                    return;
                }
                const rejection = connection.requestRejection(req);
                if (rejection !== undefined) {
                    send(res, rejection, { ok: false, error: rejection === 401 ? '请先登录 DSH' : '宿主拒绝此 Host 或跨站请求' });
                    return;
                }
                const requestError = validateApiMutation(req);
                if (requestError) {
                    send(res, requestError.status, { ok: false, error: requestError.error });
                    return;
                }
                const url = new URL(req.url ?? '/', 'http://localhost');
                if (url.pathname !== basePath && !url.pathname.startsWith(basePath + '/')) {
                    send(res, 404, { ok: false, error: 'not found' });
                    return;
                }
                await dispatch(req.method ?? 'GET', url.pathname.slice(basePath.length), url.searchParams, () => readJson(req), (status, body) => send(res, status, body));
            }
            catch (error) {
                deps.log(`[api] API 认证失败: ${error instanceof Error ? error.message : String(error)}`);
                send(res, 500, { ok: false, error: '操作失败，请查看本机日志' });
            }
        },
    });
    deps.log('[api] API 已注册 /api/dsh-remote-approval');
}
//# sourceMappingURL=api.js.map