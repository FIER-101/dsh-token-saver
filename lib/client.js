/* @dsh-plugins/token-saver — client 半区（手写 bundle，loader 格式）
 * 侧边栏小组件：每 2s 轮询 /dsh-token-widget/stats。
 * 分区显示：连接状态（点阵猫咪头像 + 绿/红脉冲点）、余额（进度条+币种数字）、
 * 当日花费、当前任务进程（进度条）、用量信息。
 * 余额来自官方 api.deepseek.com/user/balance（与官网用量页同源），并显示更新时间。 */
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
		const fmtTime = (t) => (t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null);
		const CURRENCY = { CNY: "¥", USD: "$", EUR: "€", JPY: "¥", HKD: "HK$" };
		const curSym = (c) => CURRENCY[c] || (c || "") + " ";
		const labelColor = "var(--dsw-alias-label-secondary, #999)";

		// —— 点阵猫咪（8×8，. = 透明，# = 身体，E = 眼，M = 嘴，T = 泪）——
		const SMILING_CAT = [
			"..####..",
			".##..##.",
			"##....##",
			"#.E..E.#",
			"#......#",
			"#.M..M.#",
			"..####..",
			"........"
		];
		const CRYING_CAT = [
			"..####..",
			".##..##.",
			"##....##",
			"#.E..E.#",
			"#.T..T.#",
			"#..MM..#",
			"..####..",
			"........"
		];

		const TW_STYLE_ID = "tw-token-widget-styles";
		const KEYFRAMES = "\n@keyframes tw-pulse {0%,100%{opacity:1}50%{opacity:.3}}\n@keyframes tw-bob {0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}\n";

		function ensureStyle() {
			if (document.getElementById(TW_STYLE_ID)) return;
			const el = document.createElement("style");
			el.id = TW_STYLE_ID;
			el.textContent = KEYFRAMES;
			document.head.appendChild(el);
		}

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

		// —— 点阵猫咪头像（带眨眼 + 浮动动画）——
		function DotAvatar({ ok }) {
			const [blink, setBlink] = React.useState(false);
			React.useEffect(() => {
				ensureStyle();
				let alive = true;
				const t = setInterval(() => {
					if (!alive) return;
					setBlink(true);
					setTimeout(() => { if (alive) setBlink(false); }, 160);
				}, 2800);
				return () => { alive = false; clearInterval(t); };
			}, []);
			const grid = ok ? SMILING_CAT : CRYING_CAT;
			const colors = { body: "#f0b25c", eye: "#3a3a3a", mouth: "#3a3a3a", tear: "#5aa7ff" };
			return React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(8, 8px)", gap: 2, width: "fit-content", animation: "tw-bob 3s ease-in-out infinite" } },
				grid.flatMap((row, r) =>
					row.split("").map((ch, c) => {
						let bg = "transparent";
						if (ch === "#") bg = colors.body;
						else if (ch === "E") bg = blink ? "transparent" : colors.eye;
						else if (ch === "M") bg = colors.mouth;
						else if (ch === "T") bg = colors.tear;
						return React.createElement("div", { key: r + "-" + c, style: { width: 8, height: 8, borderRadius: "50%", background: bg } });
					})
				)
			);
		}

		// —— 状态脉冲点 ——
		function StatusDot({ ok }) {
			const c = ok ? "#2ecc71" : "#e5484d";
			return React.createElement("span", { style: { display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: c, boxShadow: "0 0 6px " + c, marginRight: 6, animation: "tw-pulse 1.6s ease-in-out infinite" } });
		}

		// 进度条
		function Bar({ pct }) {
			const w = Math.max(0, Math.min(100, pct || 0));
			const c = w > 70 ? "#e6a23c" : "#4f8cff";
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

			// 运行状态：插件成功运行 = 能轮询到 host 统计
			const status = error ? "fail" : stats ? "ok" : "loading";
			const ok = status === "ok";

			const s = stats;
			const last = s && s.lastCompression;
			const bal = (s && s.balance) || { available: false, total: 0, currency: "CNY" };
			const balSym = curSym(bal.currency);
			const cap = (s && s.balanceCap) || 100;
			const balPct = bal.total > 0 ? Math.min(100, (bal.total / cap) * 100) : 0;
			const balTime = fmtTime(s && s.balanceUpdatedAt);

			return React.createElement("div", { style: { padding: "8px 4px", fontSize: 12, lineHeight: 1.5 } },
				// —— 头像 + 标题 + 状态点 ——
				React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 } },
					React.createElement(DotAvatar, { ok }),
					React.createElement("div", null,
						React.createElement("div", { style: { fontWeight: 700 } }, "⚡ Token 管家"),
						React.createElement("div", { style: { display: "flex", alignItems: "center", color: labelColor, fontSize: 11, marginTop: 2 } },
							React.createElement(StatusDot, { ok: status === "ok" }),
							status === "fail" ? "未连接" : status === "loading" ? "加载中…" : "运行中")
					)
				),

				status === "fail"
					? React.createElement("div", { style: { color: "#e06c75", marginBottom: 6 } }, "无法连接 Token 管家服务，插件可能未运行")
					: null,

				status === "ok" ? React.createElement("div", null,

					React.createElement(Section, { title: "余额" },
						React.createElement(Row, {
							left: bal.available ? (balSym + bal.total.toFixed(2)) : "未获取",
							right: "上限 " + balSym + cap + (balTime ? " · 更新 " + balTime : "")
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
