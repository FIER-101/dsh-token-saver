/* @dsh-plugins/token-saver — client 半区（手写 bundle，loader 格式）
 * 侧边栏小组件：每 2s 轮询 /dsh-token-widget/stats，分区显示
 * 余额（进度条+币种数字）、当日花费、当前任务进程（进度条）、用量信息。 */
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
		const CURRENCY = { CNY: "¥", USD: "$", EUR: "€", JPY: "¥", HKD: "HK$" };
		const curSym = (c) => CURRENCY[c] || (c || "") + " ";
		const labelColor = "var(--dsw-alias-label-secondary, #999)";

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

		// 进度条
		function Bar({ pct, color, warnColor }) {
			const w = Math.max(0, Math.min(100, pct || 0));
			const c = w > 70 ? (warnColor || "#e6a23c") : (color || "#4f8cff");
			return React.createElement("div", { style: { height: 6, borderRadius: 3, background: "rgba(128,128,128,.22)", overflow: "hidden", margin: "2px 0 4px" } },
				React.createElement("div", { style: { width: w + "%", height: "100%", background: c, transition: "width .3s ease" } }));
		}

		// 分区容器
		function Section({ title, children }) {
			return React.createElement("div", { style: { marginBottom: 9 } },
				React.createElement("div", { style: { fontWeight: 600, marginBottom: 2, opacity: 0.92 } }, title),
				children);
		}

		// 行：左标签 / 右标签
		function Row({ left, right }) {
			return React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
				React.createElement("span", null, left),
				React.createElement("span", { style: { color: labelColor, fontSize: 11 } }, right));
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
			const bal = (s && s.balance) || { available: false, total: 0, currency: "CNY" };
			const balSym = curSym(bal.currency);
			const cap = (s && s.balanceCap) || 100;
			const balPct = bal.total > 0 ? Math.min(100, (bal.total / cap) * 100) : 0;

			return React.createElement("div", { style: { padding: "8px 4px", fontSize: 12, lineHeight: 1.5 } },
				React.createElement("div", { style: { fontWeight: 700, marginBottom: 6 } }, "⚡ Token 管家"),
				error ? React.createElement("div", { style: { color: "#e06c75" } }, "未连接服务") : null,
				!error && !s ? React.createElement("div", { style: { color: labelColor } }, "加载中…") : null,
				!error && s ? React.createElement("div", null,

					React.createElement(Section, { title: "余额" },
						React.createElement(Row, {
							left: bal.available ? (balSym + bal.total.toFixed(2)) : "未获取",
							right: "上限 " + balSym + cap
						}),
						React.createElement(Bar, { pct: balPct })
					),

					React.createElement(Section, { title: "当日花费" },
						React.createElement(Row, {
							left: "¥ " + (s.todaySpend ?? 0).toFixed(2),
							right: fmt(s.todayTokens ?? 0) + " tokens（估算）"
						})
					),

					React.createElement(Section, { title: "当前任务进程" },
						React.createElement(Row, {
							left: (s.contextUsagePct ?? 0) + "%",
							right: fmt(s.surfaceTokens ?? 0) + " / " + fmt(s.contextWindow ?? 0) + " ctx"
						}),
						React.createElement(Bar, { pct: s.contextUsagePct })
					),

					React.createElement(Section, { title: "用量" },
						React.createElement("div", null, "总用量 ", fmt(s.totalTokens), " tokens"),
						React.createElement("div", null, "压缩 ", String(s.compressedCount ?? 0), " 次",
							s.enabled === false ? "（已停用）" : ""),
						last ? React.createElement("div", { style: { color: labelColor, marginTop: 4 } },
							"最近 ", last.tool, "：", fmt(last.original), " → ", fmt(last.kept), " 字符") : null
					)

				) : null
			);
		}

		function apply(ctx) {
			ctx.slots.inject("sidebar", () => ctx.slots.register(
				{ name: "sidebar.footer.action", id: "dsh-token-widget", order: 1000, label: "Token 管家" },
				TokenWidget
			));
		}

		module.exports = { name, inject, apply };
		return module.exports;
	}
});
