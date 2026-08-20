/* @dsh-plugins/token-saver — TOKEN Cat 侧边栏小组件（手写 bundle，loader 格式）
 * 每 2s 轮询 /dsh-token-widget/stats。
 * 全身点阵小猫，花色/主题随客户端打开按日期随机生成。
 * 表情状态：正常运行（微笑）/ 未连接（哭泣）/ 高花费预警（红温发怒）/
 * 余额<¥10（萎掉叹气躺）/ 余额用尽（躺床睡觉）。
 * 分区：余额、当日花费（官方）、本次花费、当前任务进程、预测节省、错误率、用量。 */
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

		// ── 全身点阵小猫（. 透明，# 身体，E 眼，M 嘴，T 泪，~ 叹气，z 呼噜） ──
				const SITTING = [
			"....#......#....",
			"...###....###...",
			"..####....####..",
			".###.######.##.#",
			".###.######.###.",
			".####.E..E.####.",
			".####..M...####.",
			".####..MM..####.",
			".###############",
			"..#############.",
			"..###..###..###.",
			"..##...###...##.",
			"..##...###...##.",
			"...##..###..##..",
			"...##..###..##..",
			"....##..###.##..",
			"......##..##....",
			"................"
		];
				const LICKING = [
			"....#......#....",
			"...###....###...",
			"..####....####..",
			".###.######.##.#",
			".###.######.###.",
			".####.E..E.####.",
			".#####..M..####.",
			".####.#.M..####.",
			".####.#M#..####.",
			"..#############.",
			"..###..###..###.",
			"..##...###...##.",
			"..##...###...##.",
			"...##..###..##..",
			"...##..###..##..",
			"....##..###.##..",
			"......##..##....",
			"................"
		];
const ANGRY = [
			"....#......#....",
			"...##......##...",
			"..####....####..",
			".##############.",
			"################",
			"######..EE.####.",
			"######.MMMM.####",
			"################",
			".##############.",
			".##############.",
			".####....######.",
			".####....######.",
			"..###......###..",
			"..###......###..",
			"..##........##..",
			"..##........##..",
			"....###..###....",
			"................"
		];
		const CRY = [
			"....#......#....",
			"...##......##...",
			"..####....####..",
			".##############.",
			"################",
			"######.E..E.####",
			"######.T..T.####",
			"######..MM..####",
			".##############.",
			".##############.",
			".####....######.",
			".####....######.",
			"..###......###..",
			"..###......###..",
			"..##........##..",
			"..##........##..",
			"....###..###....",
			"................"
		];
		const WILTED = [
			".....##....##.....",
			"....####..####....",
			"...############...",
			"..##############..",
			".###########.##...",
			".####..E..E..##...",
			".####.~.M.~.###...",
			".##############...",
			"..############....",
			"...##########.....",
			"....######........"
		];
		const SLEEP = [
			"..........z.........",
			".........z..........",
			".####..######..####.",
			".####..######..####.",
			".####..####....####.",
			".####..##..E...####.",
			".####..######..####.",
			".####..######..####.",
			".###################",
			"####################",
			"...................."
		];

		// ── 每日随机花色（按日期 hash 从调色板里挑） ──
		const PALETTES = [
			{ body: "#f0b25c", dark: "#d1923f", eye: "#3a3a3a", mouth: "#3a3a3a", tear: "#5aa7ff" }, // 橘猫
			{ body: "#b9bec6", dark: "#8d939c", eye: "#3a3a3a", mouth: "#3a3a3a", tear: "#5aa7ff" }, // 灰猫
			{ body: "#3a3a3a", dark: "#1f1f1f", eye: "#d8b56a", mouth: "#d8b56a", tear: "#5aa7ff" }, // 黑猫
			{ body: "#f3e6c8", dark: "#dfc795", eye: "#5a4a35", mouth: "#5a4a35", tear: "#5aa7ff" }, // 奶油
			{ body: "#c88b5a", dark: "#a96f42", eye: "#3a3a3a", mouth: "#3a3a3a", tear: "#5aa7ff" }, // 棕猫
			{ body: "#e5b9a8", dark: "#c99a85", eye: "#3a3a3a", mouth: "#3a3a3a", tear: "#5aa7ff" }, // 粉白
			{ body: "#d7c26a", dark: "#b99f48", eye: "#3a3a3a", mouth: "#3a3a3a", tear: "#5aa7ff" }, // 虎斑黄
			{ body: "#9ad4d6", dark: "#6fb6b8", eye: "#3a3a3a", mouth: "#3a3a3a", tear: "#5aa7ff" }  // 蓝白
		];
		const DAY_STR = new Date().toISOString().slice(0, 10);
		let _h = 0;
		for (let i = 0; i < DAY_STR.length; i++) _h = (_h * 31 + DAY_STR.charCodeAt(i)) >>> 0;
		const DAY_PALETTE = PALETTES[_h % PALETTES.length];

		const TW_STYLE_ID = "tw-token-widget-styles";
		const KEYFRAMES = "\n@keyframes tw-pulse {0%,100%{opacity:1}50%{opacity:.3}}\n@keyframes tw-bob {0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}\n@keyframes tw-bob-angry {0%,100%{transform:translateY(0)}25%{transform:translateY(-3px)}50%{transform:translateY(0)}75%{transform:translateY(-3px)}}\n";

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
			if (!full || full.type !== "server-response" || !full.result || full.result.ok === false) throw new Error("stats rpc failed");
			return full.result;
		}

		const VARIANTS = {
			smile: { grid: SITTING, frames: [SITTING, LICKING], anim: "tw-bob 3s ease-in-out infinite", blinkMs: 2800, lickMs: 420, lickHoldMs: 1600, lickDelayMs: 2200, colorFn: (p) => ({ body: p.body, eye: p.eye, mouth: p.mouth, tear: null, accent: p.dark }) },
			angry: { grid: ANGRY, anim: "tw-bob-angry 0.9s ease-in-out infinite", blinkMs: 900, colorFn: () => ({ body: "#e05d5d", eye: "#7a1f1f", mouth: "#7a1f1f", tear: null, accent: "#c94a3e" }) },
			cry: { grid: CRY, anim: "tw-bob 3s ease-in-out infinite", blinkMs: 2800, colorFn: (p) => ({ body: p.body, eye: p.eye, mouth: p.mouth, tear: p.tear, accent: p.dark }) },
			wilted: { grid: WILTED, anim: "tw-bob 4s ease-in-out infinite", blinkMs: 4000, colorFn: (p) => ({ body: p.body, eye: p.eye, mouth: p.mouth, tear: null, accent: p.dark }) },
			sleep: { grid: SLEEP, anim: "none", blinkMs: 0, colorFn: (p) => ({ body: p.body, eye: p.eye, mouth: p.mouth, tear: null, accent: p.dark }) }
		};

				function DotAvatar({ variant }) {
			const [blink, setBlink] = React.useState(false);
			const [frame, setFrame] = React.useState(0);
			const v = VARIANTS[variant] || VARIANTS.smile;
			const frames = v.frames && v.frames.length ? v.frames : [v.grid];
			React.useEffect(() => {
				ensureStyle();
				if (v.blinkMs <= 0) return () => {};
				let alive = true;
				const t = setInterval(() => {
					if (!alive) return;
					setBlink(true);
					setTimeout(() => { if (alive) setBlink(false); }, 160);
				}, v.blinkMs);
				return () => { alive = false; clearInterval(t); };
			}, [variant]);
			React.useEffect(() => {
				if (!v.frames || v.frames.length < 2) return () => {};
				let alive = true;
				let idx = 0;
				const step = () => {
					if (!alive) return;
					idx = (idx + 1) % frames.length;
					setFrame(idx);
					setTimeout(step, idx === 0 ? (v.lickHoldMs || 1600) : (v.lickMs || 420));
				};
				const t0 = setTimeout(step, v.lickDelayMs || 2200);
				return () => { alive = false; clearTimeout(t0); };
			}, [variant]);
			const grid = frames[frame % frames.length];
			const colors = v.colorFn(DAY_PALETTE);
			const cols = grid[0].length;
			return React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(" + cols + ", 5px)", gap: 1, width: "fit-content", animation: v.anim } },
				grid.flatMap((row, r) =>
					row.split("").map((ch, c) => {
						let bg = "transparent";
						if (ch === "#") bg = colors.body;
						else if (ch === "E") bg = blink ? "transparent" : colors.eye;
						else if (ch === "M") bg = colors.mouth;
						else if (ch === "T") bg = colors.tear;
						else if (ch === "~") bg = colors.accent;
						else if (ch === "z") bg = colors.accent;
						return React.createElement("div", { key: r + "-" + c, style: { width: 5, height: 5, borderRadius: "50%", background: bg } });
					})
				)
			);
		}

		// —— 状态脉冲点 ——
		function StatusDot({ color }) {
			const c = color || "#9a9a9a";
			return React.createElement("span", { style: { display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: c, boxShadow: "0 0 6px " + c, marginRight: 6, animation: "tw-pulse 1.6s ease-in-out infinite" } });
		}

		// 进度条
		function Bar({ pct }) {
			const w = Math.max(0, Math.min(100, pct || 0));
			const c = w > 70 ? "#e6a23c" : "#4f8cff";
			return React.createElement("div", { style: { height: 6, borderRadius: 3, background: "rgba(128,128,128,.22)", overflow: "hidden", margin: "2px 0 4px" } },
				React.createElement("div", { style: { width: w + "%", height: "100%", background: c, transition: "width 1.2s cubic-bezier(.22,1,.36,1)" } }));
		}

		function Section({ title, children }) {
			return React.createElement("div", { style: { marginBottom: 9 } },
				React.createElement("div", { style: { fontWeight: 600, marginBottom: 2, opacity: 0.92 } }, title),
				children);
		}

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

			const status = error ? "fail" : stats ? "ok" : "loading";
			const s = stats;
			const bal = (s && s.balance) || { available: false, total: 0, currency: "CNY" };
			const balOk = bal.available && typeof bal.total === "number";

			// 表情状态（余额驱动优先级最高）
			let variant;
			if (status === "fail") variant = "cry";
			else if (status === "loading") variant = "smile";
			else if (balOk && bal.total <= 0) variant = "sleep";
			else if (balOk && bal.total < 10) variant = "wilted";
			else if (s.risk === "high") variant = "angry";
			else variant = "smile";

			const dotColor = status === "fail" ? "#e5484d"
				: variant === "sleep" ? "#6b7280"
				: variant === "wilted" ? "#e6a23c"
				: variant === "angry" ? "#ff5a3c"
				: status === "loading" ? "#9a9a9a" : "#2ecc71";
			const statusText = status === "fail" ? "未连接"
				: status === "loading" ? "加载中…"
				: variant === "sleep" ? "额度已用尽"
				: variant === "wilted" ? "余额不足（<¥10）"
				: variant === "angry" ? "⚠ 高花费预警" : "运行中";

			const balSym = curSym(bal.currency);
			const cap = (s && s.balanceCap) || 100;
			const balPct = bal.total > 0 ? Math.min(100, (bal.total / cap) * 100) : 0;
			const balTime = fmtTime(s && s.balanceUpdatedAt);
			const last = s && s.lastCompression;
			const pred = s && s.predictions;

			return React.createElement("div", { style: { padding: "8px 4px", fontSize: 12, lineHeight: 1.5 } },
				// 头像 + 标题 + 状态点
				React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 } },
					React.createElement(DotAvatar, { variant }),
					React.createElement("div", null,
						React.createElement("div", { style: { fontWeight: 700, letterSpacing: 0.5 } }, "TOKEN Cat"),
						React.createElement("div", { style: { display: "flex", alignItems: "center", color: labelColor, fontSize: 11, marginTop: 2 } },
							React.createElement(StatusDot, { color: dotColor }),
							statusText)
					)
				),

				status === "fail"
					? React.createElement("div", { style: { color: "#e06c75", marginBottom: 6 } }, "无法连接 TOKEN Cat 服务，插件可能未运行")
					: null,

				// 高花费预警框
				status === "ok" && variant === "angry" ? React.createElement("div", { style: { border: "1px solid #ff5a3c", background: "rgba(255,90,60,.12)", borderRadius: 6, padding: "6px 8px", marginBottom: 8, color: "#e0452b" } },
					React.createElement("div", { style: { fontWeight: 600 } }, "⚠ 成本预警：任务可能高花费"),
					pred && pred.forecast ? React.createElement("div", null, "预估：", pred.forecast) : null,
					pred && pred.recommendation ? React.createElement("div", null, "最优策略：", pred.recommendation) : null
				) : null,

				status === "ok" ? React.createElement("div", null,

					React.createElement(Section, { title: "余额" },
						React.createElement(Row, {
							left: bal.available ? (balSym + bal.total.toFixed(2)) : "未获取",
							right: "上限 " + balSym + cap + (balTime ? " · 更新 " + balTime : "")
						}),
						React.createElement(Bar, { pct: balPct })
					),

					React.createElement(Section, { title: "当日花费（官方）" },
						React.createElement(Row, {
							left: "¥ " + (s.todaySpend ?? 0).toFixed(2),
							right: "本次 ¥ " + (s.sessionSpend ?? 0).toFixed(2)
						})
					),

					React.createElement(Section, { title: "当前任务进程" },
						React.createElement(Row, {
							left: (s.contextUsagePct ?? 0) + "%",
							right: fmt(s.surfaceTokens ?? 0) + " / " + fmt(s.contextWindow ?? 0) + " ctx"
						}),
						React.createElement(Bar, { pct: s.contextUsagePct })
					),

					React.createElement(Section, { title: "预测节省" },
						React.createElement(Row, {
							left: "已节省 ¥ " + (s.savedMoney ?? 0).toFixed(2),
							right: fmt(s.savedTokens ?? 0) + " tokens"
						})
					),

					React.createElement(Section, { title: "错误率" },
						React.createElement(Row, {
							left: ((s.errorRate ?? 0) * 100).toFixed(1) + "%",
							right: "压缩优化 " + String(s.optimizationCount ?? 0) + " 次"
						}),
						React.createElement(Bar, { pct: (s.errorRate ?? 0) * 100 })
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
				{ name: "sidebar.footer.action", id: "dsh-token-widget", order: 1000, label: "TOKEN Cat" },
				TokenWidget
			));
		}

		module.exports = { name, inject, apply };
		return module.exports;
	}
});
