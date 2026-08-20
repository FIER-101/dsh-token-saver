/* @dsh-plugins/token-saver — TOKEN Cat 侧边栏小组件（手写 bundle，loader 格式）
 * 每 2s 轮询 /dsh-token-widget/stats。
 * 高精度(~1000点)几何程序化全身小猫，花色/主题随日期随机生成。
 * 表情状态：微笑/发怒/哭泣（坐姿）、萎掉躺、躺床睡。 */
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

		// ── 几何绘制基元 ──
		function insideEllipse(x, y, cx, cy, rx, ry) { return ((x - cx) * (x - cx)) / (rx * rx) + ((y - cy) * (y - cy)) / (ry * ry) <= 1; }
		function insideCircle(x, y, cx, cy, r) { return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r; }
		function insideTri(x, y, ax, ay, bx, by, cx, cy) {
			const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
			const wa = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / d;
			const wb = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / d;
			const wc = 1 - wa - wb;
			return wa >= 0 && wb >= 0 && wc >= 0;
		}
		function insidePath(x, y, pts, rad) { for (const p of pts) if (insideCircle(x, y, p[0], p[1], rad)) return true; return false; }
		function rect(g, x0, y0, x1, y1, ch) {
			for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
				if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = ch;
		}
		const GW = 54, GH = 46;
		function grid(W, H) { return Array.from({ length: H }, () => Array(W).fill('.')); }

		// 坐姿全身猫（头+耳+身体+爪+尾巴）
		function drawSitting(face) {
			const g = grid(GW, GH), CX = 27;
			for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
				if (insideEllipse(x, y, CX, 15, 12, 10)) g[y][x] = '#';
				if (insideTri(x, y, CX - 9, 1, CX - 13, 11, CX - 4, 11) || insideTri(x, y, CX + 9, 1, CX + 4, 11, CX + 13, 11)) g[y][x] = '#';
			}
			for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
				if (insideEllipse(x, y, CX, 31, 14, 13)) g[y][x] = '#';
				if (insideEllipse(x, y, CX - 7, 41, 4, 3) || insideEllipse(x, y, CX + 7, 41, 4, 3)) g[y][x] = '#';
			}
			const tail = [];
			for (let i = 0; i <= 15; i++) tail.push([CX + 15 + i * 0.4, 34 - i * 0.95]);
			for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { if (insidePath(x, y, tail, 2.4)) g[y][x] = '#'; }
			if (face === 'smile') {
				for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
					if (insideCircle(x, y, CX - 5, 14, 1.5) || insideCircle(x, y, CX + 5, 14, 1.5)) g[y][x] = 'E';
					if (insideCircle(x, y, CX - 3, 19, 1) || insideCircle(x, y, CX + 1, 20, 1) || insideCircle(x, y, CX + 3, 19, 1)) g[y][x] = 'M';
				}
			} else if (face === 'angry') {
				for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
					if (insideCircle(x, y, CX - 6, 14, 1.5) || insideCircle(x, y, CX + 6, 14, 1.5)) g[y][x] = 'E';
					if (insideCircle(x, y, CX - 4, 12, 0.9) || insideCircle(x, y, CX + 4, 12, 0.9)) g[y][x] = 'E';
					if (insideCircle(x, y, CX, 20, 1.8) || insideCircle(x, y, CX - 2, 19, 1.3) || insideCircle(x, y, CX + 2, 19, 1.3)) g[y][x] = 'M';
				}
			} else {
				for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
					if (insideCircle(x, y, CX - 5, 13, 1.5) || insideCircle(x, y, CX + 5, 13, 1.5)) g[y][x] = 'E';
					if (insideCircle(x, y, CX - 5, 17, 1) || insideCircle(x, y, CX + 5, 17, 1)) g[y][x] = 'T';
					if (insideCircle(x, y, CX, 19, 1) || insideCircle(x, y, CX - 2, 20, 1) || insideCircle(x, y, CX + 2, 20, 1)) g[y][x] = 'M';
				}
			}
			return g.map((r) => r.join(''));
		}
		// 萎掉躺
		function drawWilted() {
			const g = grid(GW, GH);
			for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { if (insideEllipse(x, y, 36, 32, 19, 9)) g[y][x] = '#'; }
			for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
				if (insideCircle(x, y, 13, 25, 9)) g[y][x] = '#';
				if (insideTri(x, y, 8, 17, 5, 25, 12, 25) || insideTri(x, y, 19, 17, 14, 25, 22, 25)) g[y][x] = '#';
			}
			for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
				if (insideEllipse(x, y, 8, 40, 4, 3) || insideEllipse(x, y, 20, 40, 4, 3)) g[y][x] = '#';
			}
			const tail = [];
			for (let i = 0; i <= 12; i++) tail.push([54 - i * 0.6, 30 + i * 0.7]);
			for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { if (insidePath(x, y, tail, 2.2)) g[y][x] = '#'; }
			for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
				if (insideCircle(x, y, 10, 24, 1.3) || insideCircle(x, y, 16, 24, 1.3)) g[y][x] = 'E';
				if (insideCircle(x, y, 13, 29, 1) || insideCircle(x, y, 15, 29, 1)) g[y][x] = 'M';
				if (insideCircle(x, y, 4, 19, 0.9) || insideCircle(x, y, 3, 18, 0.9) || insideCircle(x, y, 2, 19, 0.9)) g[y][x] = '~';
			}
			return g.map((r) => r.join(''));
		}
		// 躺床睡
		function drawSleep() {
			const g = grid(GW, GH);
			rect(g, 2, 34, 51, 37, '#');
			rect(g, 3, 38, 7, 45, '#');
			rect(g, 46, 38, 50, 45, '#');
			rect(g, 2, 28, 7, 33, '#');
			rect(g, 46, 28, 51, 33, '#');
			rect(g, 8, 28, 17, 33, '#');
			for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { if (insideEllipse(x, y, 33, 32, 16, 6)) g[y][x] = '#'; }
			for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
				if (insideCircle(x, y, 12, 29, 7)) g[y][x] = '#';
				if (insideTri(x, y, 7, 24, 5, 29, 11, 29) || insideTri(x, y, 17, 24, 12, 29, 18, 29)) g[y][x] = '#';
			}
			rect(g, 10, 29, 15, 29, 'E');
			for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { if (insideCircle(x, y, 34, 18, 0.9)) g[y][x] = 'z'; }
			return g.map((r) => r.join(''));
		}

		const GRIDS = {
			smile: drawSitting('smile'),
			angry: drawSitting('angry'),
			cry: drawSitting('cry'),
			wilted: drawWilted(),
			sleep: drawSleep()
		};

		// ── 每日随机花色（按日期 hash 从调色板挑） ──
		const PALETTES = [
			{ body: "#f0b25c", eye: "#3a3a3a", mouth: "#3a3a3a", tear: "#5aa7ff", accent: "#d1923f" },
			{ body: "#b9bec6", eye: "#3a3a3a", mouth: "#3a3a3a", tear: "#5aa7ff", accent: "#8d939c" },
			{ body: "#3a3a3a", eye: "#d8b56a", mouth: "#d8b56a", tear: "#5aa7ff", accent: "#1f1f1f" },
			{ body: "#f3e6c8", eye: "#5a4a35", mouth: "#5a4a35", tear: "#5aa7ff", accent: "#dfc795" },
			{ body: "#c88b5a", eye: "#3a3a3a", mouth: "#3a3a3a", tear: "#5aa7ff", accent: "#a96f42" },
			{ body: "#e5b9a8", eye: "#3a3a3a", mouth: "#3a3a3a", tear: "#5aa7ff", accent: "#c99a85" },
			{ body: "#d7c26a", eye: "#3a3a3a", mouth: "#3a3a3a", tear: "#5aa7ff", accent: "#b99f48" },
			{ body: "#9ad4d6", eye: "#3a3a3a", mouth: "#3a3a3a", tear: "#5aa7ff", accent: "#6fb6b8" }
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
				body: JSON.stringify({ type: "client-request", rpcId: crypto.randomUUID(), method: "stats", payload: {} })
			});
			const full = await res.json();
			if (!full || full.type !== "server-response" || !full.result || full.result.ok === false) throw new Error("stats rpc failed");
			return full.result;
		}

		const VARIANTS = {
			smile: { anim: "tw-bob 3s ease-in-out infinite", blinkMs: 2800, color: (p) => ({ body: p.body, eye: p.eye, mouth: p.mouth, tear: null, accent: p.accent }) },
			angry: { anim: "tw-bob-angry 0.9s ease-in-out infinite", blinkMs: 900, color: () => ({ body: "#e05d5d", eye: "#7a1f1f", mouth: "#7a1f1f", tear: null, accent: "#c94a3e" }) },
			cry: { anim: "tw-bob 3s ease-in-out infinite", blinkMs: 2800, color: (p) => ({ body: p.body, eye: p.eye, mouth: p.mouth, tear: p.tear, accent: p.accent }) },
			wilted: { anim: "tw-bob 4s ease-in-out infinite", blinkMs: 0, color: (p) => ({ body: p.body, eye: p.eye, mouth: p.mouth, tear: null, accent: p.accent }) },
			sleep: { anim: "none", blinkMs: 0, color: (p) => ({ body: p.body, eye: p.eye, mouth: p.mouth, tear: null, accent: p.accent }) }
		};

		function DotAvatar({ variant }) {
			const [blink, setBlink] = React.useState(false);
			const v = VARIANTS[variant] || VARIANTS.smile;
			const grid0 = GRIDS[variant] || GRIDS.smile;
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
			const c = v.color(DAY_PALETTE);
			const cols = grid0[0].length;
			const DOT = 1, GAP = 1;
			return React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(" + cols + ", " + DOT + "px)", gap: GAP, width: "fit-content", animation: v.anim } },
				grid0.flatMap((row, r) =>
					row.split("").map((ch, col) => {
						let bg = "transparent";
						if (ch === "#") bg = c.body;
						else if (ch === "E") bg = blink ? "transparent" : c.eye;
						else if (ch === "M") bg = c.mouth;
						else if (ch === "T") bg = c.tear;
						else if (ch === "~" || ch === "z") bg = c.accent;
						return React.createElement("div", { key: r + "-" + col, style: { width: DOT, height: DOT, borderRadius: "50%", background: bg } });
					})
				)
			);
		}

		function StatusDot({ color }) {
			const c = color || "#9a9a9a";
			return React.createElement("span", { style: { display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: c, boxShadow: "0 0 6px " + c, marginRight: 6, animation: "tw-pulse 1.6s ease-in-out infinite" } });
		}

		function Bar({ pct }) {
			const w = Math.max(0, Math.min(100, pct || 0));
			const c = w > 70 ? "#e6a23c" : "#4f8cff";
			return React.createElement("div", { style: { height: 6, borderRadius: 3, background: "rgba(128,128,128,.22)", overflow: "hidden", margin: "2px 0 4px" } },
				React.createElement("div", { style: { width: w + "%", height: "100%", background: c, transition: "width .3s ease" } }));
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

		function TokenWidget({ wide }) {
			const [stats, setStats] = React.useState(null);
			const [error, setError] = React.useState(false);
			React.useEffect(() => {
				let alive = true;
				const poll = () => {
					fetchStats().then((s) => { if (!alive) return; setStats(s); setError(false); }, () => { if (alive) setError(true); });
				};
				poll();
				const timer = setInterval(poll, 2000);
				return () => { alive = false; clearInterval(timer); };
			}, []);
			const status = error ? "fail" : stats ? "ok" : "loading";
			const s = stats;
			const bal = (s && s.balance) || { available: false, total: 0, currency: "CNY" };
			const balOk = bal.available && typeof bal.total === "number";
			let variant;
			if (status === "fail") variant = "cry";
			else if (status === "loading") variant = "smile";
			else if (balOk && bal.total <= 0) variant = "sleep";
			else if (balOk && bal.total < 10) variant = "wilted";
			else if (s.risk === "high") variant = "angry";
			else variant = "smile";
			const dotColor = status === "fail" ? "#e5484d" : variant === "sleep" ? "#6b7280" : variant === "wilted" ? "#e6a23c" : variant === "angry" ? "#ff5a3c" : status === "loading" ? "#9a9a9a" : "#2ecc71";
			const statusText = status === "fail" ? "未连接" : status === "loading" ? "加载中…" : variant === "sleep" ? "额度已用尽" : variant === "wilted" ? "余额不足（<¥10）" : variant === "angry" ? "⚠ 高花费预警" : "运行中";
			const balSym = curSym(bal.currency);
			const cap = (s && s.balanceCap) || 100;
			const balPct = bal.total > 0 ? Math.min(100, (bal.total / cap) * 100) : 0;
			const balTime = fmtTime(s && s.balanceUpdatedAt);
			const last = s && s.lastCompression;
			const pred = s && s.predictions;

			return React.createElement("div", { style: { padding: "8px 4px", fontSize: 12, lineHeight: 1.5 } },
				// 头像 + 标题 + 状态
				React.createElement("div", { style: { display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 } },
					React.createElement(DotAvatar, { variant }),
					React.createElement("div", null,
						React.createElement("div", { style: { fontWeight: 700, letterSpacing: 0.5 } }, "TOKEN Cat"),
						React.createElement("div", { style: { display: "flex", alignItems: "center", color: labelColor, fontSize: 11, marginTop: 2 } },
							React.createElement(StatusDot, { color: dotColor }),
							statusText)
					)
				),
				status === "fail" ? React.createElement("div", { style: { color: "#e06c75", marginBottom: 6 } }, "无法连接 TOKEN Cat 服务，插件可能未运行") : null,
				status === "ok" && variant === "angry" ? React.createElement("div", { style: { border: "1px solid #ff5a3c", background: "rgba(255,90,60,.12)", borderRadius: 6, padding: "6px 8px", marginBottom: 8, color: "#e0452b" } },
					React.createElement("div", { style: { fontWeight: 600 } }, "⚠ 成本预警：任务可能高花费"),
					pred && pred.forecast ? React.createElement("div", null, "预估：", pred.forecast) : null,
					pred && pred.recommendation ? React.createElement("div", null, "最优策略：", pred.recommendation) : null
				) : null,
				status === "ok" ? React.createElement("div", null,
					React.createElement(Section, { title: "余额" },
						React.createElement(Row, { left: bal.available ? (balSym + bal.total.toFixed(2)) : "未获取", right: "上限 " + balSym + cap + (balTime ? " · 更新 " + balTime : "") }),
						React.createElement(Bar, { pct: balPct })
					),
					React.createElement(Section, { title: "当日花费（官方）" },
						React.createElement(Row, { left: "¥ " + (s.todaySpend ?? 0).toFixed(2), right: "本次 ¥ " + (s.sessionSpend ?? 0).toFixed(2) })
					),
					React.createElement(Section, { title: "当前任务进程" },
						React.createElement(Row, { left: (s.contextUsagePct ?? 0) + "%", right: fmt(s.surfaceTokens ?? 0) + " / " + fmt(s.contextWindow ?? 0) + " ctx" }),
						React.createElement(Bar, { pct: s.contextUsagePct })
					),
					React.createElement(Section, { title: "预测节省" },
						React.createElement(Row, { left: "已节省 ¥ " + (s.savedMoney ?? 0).toFixed(2), right: fmt(s.savedTokens ?? 0) + " tokens" })
					),
					React.createElement(Section, { title: "错误率" },
						React.createElement(Row, { left: ((s.errorRate ?? 0) * 100).toFixed(1) + "%", right: "压缩优化 " + String(s.optimizationCount ?? 0) + " 次" }),
						React.createElement(Bar, { pct: (s.errorRate ?? 0) * 100 })
					),
					React.createElement(Section, { title: "用量" },
						React.createElement("div", null, "总用量 ", fmt(s.totalTokens), " tokens"),
						React.createElement("div", null, "压缩 ", String(s.compressedCount ?? 0), " 次", s.enabled === false ? "（已停用）" : ""),
						last ? React.createElement("div", { style: { color: labelColor, marginTop: 4 } }, "最近 ", last.tool, "：", fmt(last.original), " → ", fmt(last.kept), " 字符") : null
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
