/* @dsh-plugins/token-saver — client 半区（手写 bundle，loader 格式）
 * 侧边栏小组件：每 2s 轮询 /dsh-token-widget/stats，实时显示
 * token 用量 + 压缩活动。随 dsh 重启后由 client-modules 加载。 */
window.__ModuleLoader__.load({
	id: "@dsh-plugins/token-saver",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");

		const name = "dsh-token-widget";
		const inject = ["slots"];

		const fmt = (n) => (typeof n === "number" ? Math.round(n).toLocaleString() : "—");

		async function fetchStats() {
			const res = await fetch("/dsh-token-widget/stats", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					type: "client-request",
					rpcId: crypto.randomUUID(),
					method: "stats",
					payload: {}
				})
			});
			const full = await res.json();
			// host 端 RPC 响应是 { type:'server-response', rpcId, result }，统计在 result 下
			if (!full || full.type !== "server-response" || !full.result || full.result.ok === false) throw new Error("stats rpc failed");
			return full.result;
		}

		function TokenWidget() {
			const [stats, setStats] = React.useState(null);
			const [error, setError] = React.useState(false);

			React.useEffect(() => {
				let alive = true;
				const poll = () => {
					fetchStats().then((s) => {
						if (!alive) return;
						setStats(s);
						setError(false);
					}, () => {
						if (alive) setError(true);
					});
				};
				poll();
				const timer = setInterval(poll, 2000);
				return () => {
					alive = false;
					clearInterval(timer);
				};
			}, []);

			const s = stats;
			const last = s && s.lastCompression;
			return React.createElement("div", { style: { padding: "8px 4px", fontSize: 12, lineHeight: 1.5 } },
				React.createElement("div", { style: { fontWeight: 600, marginBottom: 4 } }, "⚡ Token 实时"),
				error ? React.createElement("div", { style: { color: "#e06c75" } }, "未连接服务") : null,
				!error && !s ? React.createElement("div", { style: { color: "var(--dsw-alias-label-secondary, #999)" } }, "加载中…") : null,
				!error && s ? React.createElement("div", null,
					React.createElement("div", null, "总用量 ", fmt(s.totalTokens), " tokens"),
					React.createElement("div", null, "上下文 ", fmt(s.surfaceTokens), " tokens"),
					React.createElement("div", null, "压缩 ", String(s.compressedCount ?? 0), " 次",
						s.enabled === false ? "（已停用）" : ""),
					last ? React.createElement("div", { style: { color: "var(--dsw-alias-label-secondary, #999)", marginTop: 4 } },
						"最近 ", last.tool, "：", fmt(last.original), " → ", fmt(last.kept), " 字符") : null
				) : null
			);
		}

		function apply(ctx) {
			ctx.slots.inject("sidebar", () => ctx.slots.register(
				{ name: "sidebar.footer.action", id: "dsh-token-widget", order: 1000, label: "Token 实时" },
				TokenWidget
			));
		}

		module.exports = { name, inject, apply };
		return module.exports;
	}
});
