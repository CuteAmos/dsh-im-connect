/**
 * dsh-remote-approval 浏览器端：插件配置页（账号/目标选择 + 测试连接）。
 *
 * 复用 fork dsh-im-connect 的挂载方式：通过 plugins.bundle.config slot 注册一张
 * bundle 配置卡，key 必须等于包名 "dsh-remote-approval"，plugin-manager 才会在
 * 插件详情页按 entryKey === pkg.name 精确过滤渲染。
 *
 * 注意：本文件是纯浏览器 bundle（非 ESM），只允许 require/h/React 等 ModuleLoader
 * 工厂内的写法；不要引入 import/export 或 Node 内置模块。
 */
window.__ModuleLoader__.load({
  id: "dsh-remote-approval",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require("react");
    const { useState, useEffect, useCallback, useMemo } = React;
    const h = React.createElement;

    // primitives 由宿主运行时注入，缺失时回退空对象；ConfigCard 依赖 Button/Menu/Tag，
    // 任一缺失时在 apply 里降级为纯文本提示（而不是 h(undefined) 抛 Element type is invalid）。
    const primitives = typeof require === "function" ? (function () {
      try { return require("@deepseek-ai/dsh-client-ui-primitives"); } catch { return {}; }
    })() : {};
    const PrimitiveButton = primitives.Button;
    const HostMenu = primitives.Menu;
    const PrimitiveTag = primitives.Tag;
    const hasPrimitives = Boolean(PrimitiveButton && HostMenu && PrimitiveTag);

    const API_BASE = "/api/dsh-remote-approval";
    const BUNDLE_KEY = "dsh-remote-approval";

    /** 页面基准地址；末尾补斜杠，避免 /app/dsh 这类无斜杠页面把前缀解析掉一级。 */
    function pageBaseHref() {
      const doc = (typeof globalThis !== "undefined" && globalThis.document) || undefined;
      if (!doc) return undefined;
      const raw = doc.baseURI;
      if (typeof raw !== "string" || raw === "") return undefined;
      try {
        const url = new URL(raw);
        if (!url.pathname.endsWith("/")) url.pathname += "/";
        return url.href;
      } catch { return undefined; }
    }

    /** 把根绝对路径端点解析到页面 base 之下（兼容反代前缀）。 */
    function resolveApiUrl(path) {
      if (typeof path !== "string" || path.charAt(0) !== "/" || path.charAt(1) === "/") return path;
      const base = pageBaseHref();
      if (base === undefined) return path;
      try { return new URL(path.slice(1), base).href; } catch { return path; }
    }

    /** 管理 API 请求：复用宿主登录 Cookie，写请求带客户端头。 */
    const api = (path, opts) => {
      const request = Object.assign({}, opts || {}, { credentials: "same-origin", cache: "no-store" });
      const method = String(request.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        request.headers = Object.assign({ "content-type": "application/json" }, request.headers || {}, { "x-dsh-im-connect-client": "1" });
        if (request.body === undefined) request.body = "{}";
      }
      const targetUrl = resolveApiUrl(API_BASE + path);
      return fetch(targetUrl, request).then((r) => r.json().catch(() => ({ ok: false, error: "服务返回非 JSON 响应（状态 " + r.status + "）" })));
    };

    const labelStyle = { display: "block", fontSize: "12px", color: "var(--dsw-text-secondary, #666)", margin: "0 0 4px" };
    const rowStyle = { margin: "0 0 12px" };

    function Field({ label, children }) {
      return h("div", { style: rowStyle },
        h("label", { style: labelStyle }, label),
        children);
    }

    /**
     * 极简下拉：宿主无原生 Select，用 Menu（items 数据行）+ Button 触发器自建。
     * options = [{ id, label }]；空时展示一条不可选的 label 行。
     */
    function Dropdown({ value, options, onChange, placeholder, emptyText }) {
      const [open, setOpen] = useState(false);
      const items = useMemo(() => {
        if (!options || options.length === 0) return [{ type: "label", id: "__empty__", text: emptyText || "无可用项" }];
        return options.map((o) => ({ id: o.id, label: String(o.label ?? o.id) }));
      }, [options, emptyText]);
      const selected = (options || []).find((o) => o.id === value);
      const trigger = h(PrimitiveButton, {
        type: "button",
        variant: "outline",
        size: "md",
        onClick: () => setOpen((v) => !v),
        style: { width: "100%", justifyContent: "space-between" },
      },
        h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
          selected ? selected.label : (placeholder || "请选择")),
        h("span", { style: { opacity: 0.5, marginLeft: 8 } }, "\u25BE"));
      return h(HostMenu, {
        open,
        anchor: trigger,
        items,
        selectedId: value || undefined,
        onSelect: (id) => { setOpen(false); onChange(id); },
        onClose: () => setOpen(false),
        portal: true,
        minWidthFromAnchor: true,
      });
    }

    function ConfigCard() {
      const [accounts, setAccounts] = useState([]);
      const [targets, setTargets] = useState([]);
      const [accountId, setAccountId] = useState("");
      const [chatId, setChatId] = useState("");
      const [loading, setLoading] = useState(true);
      const [testing, setTesting] = useState(false);
      const [testResult, setTestResult] = useState(null);
      const [error, setError] = useState(null);

      // 首次加载：拉账号列表 + 当前绑定。
      useEffect(() => {
        let alive = true;
        setLoading(true);
        Promise.all([
          api("/accounts"),
          api("/state"),
        ]).then(([acc, st]) => {
          if (!alive) return;
          setAccounts(Array.isArray(acc.accounts) ? acc.accounts : []);
          if (st.ok && st.state) {
            setAccountId(st.state.accountId || "");
            setChatId(st.state.chatId || "");
          }
        }).catch((e) => {
          if (alive) setError(String((e && e.message) || e));
        }).finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
      }, []);

      // 账号变化时拉目标列表。
      useEffect(() => {
        if (!accountId) { setTargets([]); return; }
        let alive = true;
        api("/targets?accountId=" + encodeURIComponent(accountId)).then((d) => {
          if (alive && d.ok) setTargets(Array.isArray(d.targets) ? d.targets : []);
        }).catch(() => {});
        return () => { alive = false; };
      }, [accountId]);

      const saveState = useCallback((nextAccountId, nextChatId) => {
        api("/state", { method: "POST", body: JSON.stringify({ accountId: nextAccountId, chatId: nextChatId }) }).catch(() => {});
      }, []);

      const onAccount = (id) => {
        setAccountId(id);
        setChatId("");
        saveState(id, "");
      };
      const onTarget = (id) => {
        setChatId(id);
        saveState(accountId, id);
      };

      const runTest = () => {
        setTesting(true);
        setTestResult(null);
        api("/test", { method: "POST", body: JSON.stringify({ accountId, chatId }) })
          .then((d) => setTestResult(d))
          .catch((e) => setTestResult({ ok: false, error: String((e && e.message) || e) }))
          .finally(() => setTesting(false));
      };

      const accountOptions = accounts.map((a) => ({ id: a.accountId, label: (a.connected ? "" : "[未连接] ") + (a.name || a.accountId) }));
      const targetOptions = targets.map((t) => ({ id: t.chatId, label: (t.title || t.chatId) + (t.kind === "group" ? "（群）" : "") }));

      return h("div", { style: { padding: "4px 0", maxWidth: 420 } },
        h(Field, { label: "推送账号" },
          h(Dropdown, {
            value: accountId,
            options: accountOptions,
            onChange: onAccount,
            placeholder: "选择 dsh-im-connect 已连接的账号",
            emptyText: loading ? "加载中…" : "暂无账号，请先在 dsh-im-connect 配置并连接",
          })),
        h(Field, { label: "推送目标（chatId）" },
          h(Dropdown, {
            value: chatId,
            options: targetOptions,
            onChange: onTarget,
            placeholder: accountId ? "选择历史绑定目标" : "请先选择账号",
            emptyText: accountId ? "暂无历史绑定目标，可到 IM 端向机器人发一句话后刷新" : "请先选择账号",
          })),
        error ? h("div", { style: { color: "var(--dsw-text-danger, #c00)", fontSize: 12, margin: "0 0 12px" } }, error) : null,
        testResult ? h(TestResultView, { result: testResult }) : null,
        h(PrimitiveButton, {
          type: "button",
          variant: "primary",
          size: "md",
          disabled: testing || !accountId || !chatId,
          onClick: runTest,
          style: { width: "100%" },
        }, testing ? "推送中…" : "测试连接"),
      );
    }

    function TestResultView({ result }) {
      if (!result) return null;
      if (result.ok) {
        const note = "已推送审批测试消息与提问测试消息，请到 IM 端确认收到。";
        const warnings = Array.isArray(result.warnings) && result.warnings.length ? result.warnings : [];
        return h("div", { style: { margin: "0 0 12px" } },
          h(PrimitiveTag, { tone: "success" }, "测试成功"),
          h("div", { style: { fontSize: 12, margin: "4px 0 0" } }, note),
          warnings.map((w) => h("div", { key: String(w), style: { fontSize: 12, color: "var(--dsw-text-warning, #a60)" } }, w)));
      }
      return h("div", { style: { margin: "0 0 12px" } },
        h(PrimitiveTag, { tone: "danger" }, "测试失败"),
        h("div", { style: { fontSize: 12, margin: "4px 0 0", color: "var(--dsw-text-danger, #c00)" } }, result.error || "未知错误"));
    }

    const inject = ["slots"];

    function apply(ctx) {
      ctx.slots.inject("plugins.bundle.config", () => {
        return ctx.slots.register({
          name: "plugins.bundle.config",
          key: BUNDLE_KEY,
        }, (ownerProps) => {
          // plugin-manager 在列表/行 summary 视图下不渲染详情卡。
          if (ownerProps && ownerProps.view === "summary") return null;
          if (!hasPrimitives) {
            return h("div", { style: { padding: "4px 0", fontSize: 12, color: "var(--dsw-text-secondary, #666)" } },
              "当前宿主版本未提供所需 UI 原语（Button/Menu/Tag），无法渲染配置界面；请升级宿主或在 dsh-im-connect 侧配置绑定。");
          }
          return h(ConfigCard, {});
        });
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

