/* @dsh-plugins/token-saver — TOKEN Cat 侧边栏小组件（手写 bundle，loader 格式）
 * 每 2s 轮询 /dsh-token-widget/stats。
 * 头像 = 经典 oneko 像素猫（公有领域），支持走动/空闲/跑动/睡觉动画。
 * 情绪映射：正常=空闲+走动、高花费=跑动(红)、未连接=静止(灰)、余额<10=趴着不动、余额用尽=睡觉。 */
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

		// ── oneko 猫精灵帧（XBM 32×32，公有领域，来自 oneko-1.2.sakura.5） ──
		// 关键帧：awake/mati(空闲)、down/up/left/right(走动)、kaki(跑)、sleep(睡)
		const FRAMES = {
			awake: [0,0,0,0,0,0,0,0,32,0,0,4,64,16,16,2,128,40,40,1,0,73,36,0,6,68,68,96,24,132,66,24,96,130,131,6,0,2,128,0,0,34,136,0,15,34,136,120,0,34,136,0,0,2,128,0,0,58,185,0,0,4,64,0,0,8,32,0,0,112,28,2,0,64,4,5,0,32,136,4,0,16,80,2,0,8,32,1,0,11,160,1,128,12,97,2,64,24,49,4,64,16,17,4,192,17,17,7,96,144,19,12,224,255,254,15,0,0,0,0,0,0,0,0,0,0,0,0],
			mati2: [0,0,0,0,0,0,0,0,0,0,0,0,0,16,16,0,0,40,40,0,0,72,36,0,0,68,68,0,0,132,66,0,0,130,131,0,0,2,128,0,0,34,136,0,0,34,136,0,0,34,136,0,0,2,128,0,0,58,185,0,0,4,64,0,0,8,32,0,0,112,28,0,0,64,4,0,0,32,8,0,0,16,16,0,0,8,32,0,0,11,160,1,128,12,97,2,64,24,49,4,64,16,17,4,192,17,17,127,96,144,19,132,224,255,254,127,0,0,0,0,0,0,0,0,0,0,0,0],
			mati3: [0,0,0,0,0,0,0,0,0,0,0,0,0,16,16,0,0,40,40,0,0,72,36,0,0,68,68,0,0,132,66,0,0,130,131,0,0,58,184,0,0,66,133,0,0,146,145,0,0,78,226,0,0,66,130,0,0,66,130,0,0,68,66,0,0,136,33,0,0,112,28,0,0,64,4,0,0,32,8,0,0,16,16,0,0,8,32,0,0,11,160,1,128,12,97,2,64,24,49,4,64,16,17,4,192,17,17,127,96,144,19,132,224,255,254,127,0,0,0,0,0,0,0,0,0,0,0,0],
			down1: [0,128,1,0,0,64,2,0,0,64,2,0,0,64,2,0,0,64,2,0,0,64,2,0,0,120,30,0,0,4,32,0,0,2,64,0,0,1,128,0,128,0,0,1,128,16,16,2,128,40,40,2,64,72,36,4,64,68,68,4,64,132,66,4,64,130,131,4,64,2,128,4,96,2,128,12,192,2,128,6,32,35,136,9,160,35,136,11,224,34,136,14,128,4,65,2,0,15,224,1,0,124,124,0,0,192,7,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
			down2: [0,140,97,0,0,90,178,0,0,82,146,0,0,82,146,0,0,97,10,1,0,97,6,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,2,128,0,0,18,144,0,0,41,40,1,0,73,36,1,0,69,68,1,0,133,66,1,0,131,131,1,0,3,128,1,96,3,128,13,128,3,128,3,0,35,136,1,0,35,136,1,0,34,136,0,0,6,193,0,0,10,160,0,0,114,156,0,0,194,135,0,0,36,72,0,0,36,72,0,0,52,88,0,0,24,48,0,0,0,0,0],
			up1: [0,192,3,0,0,62,124,0,0,8,16,0,0,38,100,0,0,34,68,0,0,34,68,0,0,1,128,0,0,31,248,0,0,1,128,0,0,34,66,0,0,30,124,0,0,6,96,0,128,63,252,1,192,4,32,3,64,2,64,2,64,2,64,2,64,1,128,2,64,0,0,2,128,0,0,1,128,0,0,1,128,0,0,1,128,0,0,1,0,1,128,0,0,6,96,0,0,120,30,0,0,64,2,0,0,64,2,0,0,64,2,0,0,64,2,0,0,128,1,0,0,0,0,0,0,0,0,0],
			up2: [0,192,3,0,128,63,252,1,64,11,208,2,64,38,100,2,64,34,68,2,64,34,68,2,64,1,128,2,64,31,248,2,64,1,128,2,64,34,66,2,128,30,124,1,128,4,32,1,128,56,28,1,128,0,0,1,0,1,128,0,0,13,176,0,0,131,193,0,0,65,130,0,128,64,2,1,128,64,2,1,128,64,2,1,128,64,2,1,128,64,2,1,128,0,0,1,128,192,3,1,0,65,130,0,0,33,132,0,0,17,136,0,0,9,144,0,0,6,96,0,0,0,0,0,0,0,0,0],
			left1: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,14,0,0,128,49,0,0,96,192,0,0,16,0,1,0,8,0,1,12,4,0,2,20,4,0,4,100,2,0,8,136,3,1,18,8,132,0,35,8,128,0,69,4,64,0,73,18,64,0,146,18,64,0,164,18,135,0,194,195,129,0,1,1,64,3,1,2,128,158,1,4,3,145,1,248,14,78,2,0,52,200,2,0,200,47,3,0,144,56,0,0,224,24,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
			left2: [0,0,0,0,0,0,0,0,0,0,0,0,32,0,0,224,96,0,0,144,160,0,0,136,32,1,0,68,32,2,0,34,48,12,0,17,8,16,192,8,36,48,56,8,36,32,6,8,36,64,1,16,2,192,0,16,194,3,0,16,2,0,0,16,4,0,0,16,120,0,0,32,128,7,8,32,128,0,48,192,192,0,192,129,96,24,120,158,16,244,135,167,8,59,0,200,196,4,0,48,56,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
			right1: [0,0,0,0,0,0,0,0,0,0,0,0,0,112,0,0,0,140,1,0,0,3,6,0,128,0,8,0,128,0,16,0,64,0,32,48,32,0,32,40,16,0,64,38,72,128,192,17,196,0,33,16,162,0,1,16,146,0,2,32,73,0,2,72,37,0,2,72,67,0,225,72,128,0,145,195,128,192,2,128,128,121,1,64,128,137,192,32,64,114,112,31,64,19,44,0,192,244,19,0,0,28,9,0,0,24,7,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
			right2: [0,0,0,0,0,0,0,0,0,0,0,0,7,0,0,4,9,0,0,6,25,0,0,5,34,0,128,4,68,0,64,4,136,0,48,12,16,3,8,16,16,28,12,36,16,96,4,36,8,128,2,36,8,0,3,64,8,0,192,67,8,0,0,64,8,0,0,32,4,0,0,30,4,16,128,1,3,12,128,1,129,3,0,3,121,14,24,6,237,249,47,8,23,0,220,16,12,0,32,35,0,0,192,28,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
			kaki1: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,0,0,0,26,0,0,0,98,0,0,0,130,0,0,0,2,3,0,60,2,52,0,196,3,88,0,8,0,88,0,8,32,88,0,16,16,216,0,32,8,24,1,32,200,24,2,224,33,24,4,32,0,52,8,224,5,36,8,192,96,56,8,0,31,16,8,0,8,32,8,0,11,32,8,128,12,33,12,64,24,49,4,64,16,17,2,192,17,145,127,96,144,243,128,224,255,254,127,0,0,0,0,0,0,0,0,0,0,0,0],
			kaki2: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,32,0,0,0,80,0,0,32,144,0,0,80,16,1,0,144,8,2,0,16,9,4,0,16,6,8,0,16,0,8,0,32,0,16,0,32,128,16,0,32,96,16,0,32,16,8,0,224,129,249,3,32,96,24,4,224,197,15,8,192,224,0,8,0,159,17,8,0,8,46,8,0,11,32,8,128,12,33,8,64,24,49,4,64,16,17,4,192,17,145,127,96,144,243,128,224,255,254,127,0,0,0,0,0,0,0,0,0,0,0,0],
			sleep1: [0,0,0,0,0,0,0,0,0,0,0,0,192,31,0,0,0,8,0,0,0,5,0,0,0,2,0,0,0,5,31,0,128,0,8,0,192,31,4,0,0,0,31,0,0,0,0,0,0,0,0,1,0,0,128,2,0,0,65,2,0,128,34,2,0,64,62,6,0,56,20,10,0,38,24,20,0,17,0,24,0,17,0,24,128,16,0,56,64,16,0,44,64,160,1,43,64,32,142,104,64,64,16,84,64,128,64,91,128,0,255,76,0,63,240,100,0,224,159,63,0,0,0,0,0,0,0,0],
			sleep2: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,63,0,0,0,16,60,0,0,12,16,0,0,4,136,1,0,63,124,1,0,128,96,1,0,192,33,2,0,120,63,6,0,38,18,10,0,33,12,20,128,16,0,24,128,16,0,24,128,16,0,56,64,16,0,42,64,160,3,41,64,32,140,104,64,64,16,84,64,128,64,91,128,0,255,76,0,63,240,100,0,224,159,63,0,0,0,0,0,0,0,0]
		};

		function decodeXBM(bytes) {
			const rows = [];
			for (let y = 0; y < 32; y++) {
				let s = '';
				for (let x = 0; x < 32; x++) {
					const b = bytes[y * 4 + (x >> 3)];
					s += ((b >> (7 - (x & 7))) & 1) ? '#' : '.';
				}
				rows.push(s);
			}
			return rows;
		}
		const GRIDS = {};
		for (const k in FRAMES) GRIDS[k] = decodeXBM(FRAMES[k]);

		// ── 每日随机花色 ──
		const PALETTES = [
			{ body: "#f0b25c", accent: "#d1923f" },
			{ body: "#b9bec6", accent: "#8d939c" },
			{ body: "#3a3a3a", accent: "#1f1f1f" },
			{ body: "#f3e6c8", accent: "#dfc795" },
			{ body: "#c88b5a", accent: "#a96f42" },
			{ body: "#e5b9a8", accent: "#c99a85" },
			{ body: "#d7c26a", accent: "#b99f48" },
			{ body: "#9ad4d6", accent: "#6fb6b8" }
		];
		const DAY_STR = new Date().toISOString().slice(0, 10);
		let _h = 0;
		for (let i = 0; i < DAY_STR.length; i++) _h = (_h * 31 + DAY_STR.charCodeAt(i)) >>> 0;
		const DAY_PALETTE = PALETTES[_h % PALETTES.length];

		const TW_STYLE_ID = "tw-token-widget-styles";
		const KEYFRAMES = "\n@keyframes tw-pulse {0%,100%{opacity:1}50%{opacity:.3}}\n@keyframes tw-shake {0%,100%{transform:translateX(0)}25%{transform:translateX(-1px)}75%{transform:translateX(1px)}}\n";
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

		// ── 行为配置：mode=walk(走动+空闲) | run(跑) | static(静止) | sleep(睡觉) ──
		const BEHAVIOR = {
			smile: { mode: "walk", speedMs: 160 },
			angry: { mode: "static", speedMs: 0 },
			cry: { mode: "static", speedMs: 0, gray: true },
			wilted: { mode: "static", speedMs: 0 },
			sleep: { mode: "sleep", speedMs: 500 }
		};
		const LANE = 132; // 走动区域宽度（猫在 LANE..LANE+猫宽 之间来回）

				function ParticleCat({ variant }) {
			const [tick, setTick] = React.useState(0);
			const [pos, setPos] = React.useState(0);
			const [dir, setDir] = React.useState(1);
			const [phase, setPhase] = React.useState("idle");
			const st = React.useRef({ pos: 0, dir: 1, phase: "idle", phaseT: 0, tick: 0 });
			const canvasRef = React.useRef(null);
			const stateRef = React.useRef({ tick: 0, pos: 0, dir: 1, phase: "idle", variant });

			const B = BEHAVIOR[variant] || BEHAVIOR.smile;

			React.useEffect(() => {
				ensureStyle();
				if (B.speedMs <= 0) return () => {};
				const iv = setInterval(() => {
					const s = st.current;
					s.tick++;
					if (B.mode === "walk") {
						s.phaseT++;
						if (s.phase === "idle" && s.phaseT > 22) { s.phase = "walk"; s.phaseT = 0; }
						else if (s.phase === "walk" && s.phaseT > 30) { s.phase = "idle"; s.phaseT = 0; }
						if (s.phase === "walk") { s.pos += s.dir * 1; if (s.pos <= 0) { s.dir = 1; s.pos = 0; } if (s.pos >= LANE) { s.dir = -1; s.pos = LANE; } }
					}
					stateRef.current = { tick: s.tick, pos: s.pos, dir: s.dir, phase: s.phase, variant };
					setTick(s.tick); setPos(s.pos); setDir(s.dir); setPhase(s.phase);
				}, B.speedMs);
				return () => clearInterval(iv);
			}, [variant]);

			// 粒子效果：把小猫轮廓渲染成会呼吸/闪烁/漂移的发光粒子
			React.useEffect(() => {
				const canvas = canvasRef.current;
				if (!canvas) return () => {};
				const ctx = canvas.getContext("2d");
				const DOT = 2, GAP = 1;
				const CATPX = 32 * (DOT + GAP) - GAP;
				const W = LANE + CATPX, H = CATPX;
				canvas.width = W; canvas.height = H;
				let raf; let t0 = performance.now(); let alive = true;
				const tickFn = (now) => {
					if (!alive) return;
					const t = (now - t0) / 1000;
					const sc = stateRef.current;
					const b = BEHAVIOR[sc.variant] || BEHAVIOR.smile;
					let frame;
					if (b.mode === "sleep") frame = (sc.tick % 2 ? "sleep1" : "sleep2");
					else if (b.mode === "static") frame = "awake";
					else frame = sc.phase === "walk" ? (sc.dir > 0 ? (sc.tick % 2 ? "right1" : "right2") : (sc.tick % 2 ? "left1" : "left2")) : ["awake", "mati2", "mati3"][sc.tick % 3];
					const grid = GRIDS[frame] || GRIDS.awake;
					const color = sc.variant === "angry" ? "#e05d5d" : sc.variant === "cry" ? "#9aa0a6" : DAY_PALETTE.body;
					ctx.clearRect(0, 0, W, H);
					const baseX = sc.pos;
					grid.forEach((row, r) => row.split("").forEach((ch, c) => {
						if (ch === ".") return;
						const ph = ((r * 7 + c * 13) % 628) / 100;
						const pulse = 0.5 + 0.5 * Math.sin(t * 1.4 + ph);
						const jx = Math.sin(t * 0.8 + ph) * 0.7;
						const jy = Math.cos(t * 0.9 + ph) * 0.7;
						const x = baseX + c * (DOT + GAP) + DOT / 2 + jx;
						const y = r * (DOT + GAP) + DOT / 2 + jy;
						ctx.globalAlpha = 0.35 + 0.65 * pulse;
						ctx.fillStyle = color;
						ctx.shadowColor = color; ctx.shadowBlur = 2.5;
						ctx.beginPath(); ctx.arc(x, y, (DOT / 2) * (0.6 + 0.5 * pulse), 0, Math.PI * 2); ctx.fill();
					}));
					ctx.globalAlpha = 1; ctx.shadowBlur = 0;
					raf = requestAnimationFrame(tickFn);
				};
				raf = requestAnimationFrame(tickFn);
				return () => { alive = false; cancelAnimationFrame(raf); };
			}, [variant]);

			return React.createElement("canvas", { ref: canvasRef, style: { display: "block", marginBottom: 6, maxWidth: "100%", imageRendering: "auto" } });
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
		// 分段进度条：按计划步数分段，逐段填充（颜色可由状态决定）
		function SegBar({ pct, segments, color }) {
			const n = Math.max(1, segments || 8);
			const f = Math.max(0, Math.min(n, Math.round(((pct ?? 0) / 100) * n)));
			const c = color || "#4f8cff";
			return React.createElement("div", { style: { display: "flex", gap: 2, height: 6, margin: "2px 0 4px" } },
				Array.from({ length: n }, (_, i) => React.createElement("div", { key: i, style: { flex: 1, height: 6, borderRadius: 2, background: i < f ? c : "rgba(128,128,128,.22)" } })));
		}
		// 进度颜色：0% 灰白 → 100% 绿（进行中）；受阻红 / 待授权黄 / 完成绿
		function lerpColor(pct) {
			const t = Math.max(0, Math.min(1, (pct || 0) / 100));
			const a = [235, 235, 235], b = [46, 204, 113];
			return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * t) + "," + Math.round(a[1] + (b[1] - a[1]) * t) + "," + Math.round(a[2] + (b[2] - a[2]) * t) + ")";
		}
		function progressColor(pct, status) {
			if (status === "blocked") return "#e5484d";
			if (status === "waiting") return "#e6a23c";
			if (status === "complete") return "#2ecc71";
			return lerpColor(pct);
		}
		// 任务状态灯颜色（参考原生会话标记：无任务灰/完成绿/受阻红/待授权黄）
		const TASK_COLOR = { none: "#9a9a9a", running: "#9aa0a6", complete: "#2ecc71", blocked: "#e5484d", waiting: "#e6a23c" };
		function Section({ title, children }) {
			return React.createElement("div", { style: { marginBottom: 9 } },
				React.createElement("div", { style: { fontWeight: 600, marginBottom: 2, opacity: 0.92 } }, title), children);
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
				React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 } },
					React.createElement(ParticleCat, { variant }),
					React.createElement("div", null,
						React.createElement("div", { style: { fontWeight: 700, letterSpacing: 0.5 } }, "TOKEN Cat"),
						React.createElement("div", { style: { display: "flex", alignItems: "center", color: labelColor, fontSize: 11, marginTop: 2 } },
							React.createElement(StatusDot, { color: dotColor }), statusText)
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
					React.createElement(Section, {
						title: React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 5 } },
							React.createElement("span", { style: { width: 9, height: 9, borderRadius: "50%", background: TASK_COLOR[s.taskStatus || "none"], boxShadow: "0 0 5px " + TASK_COLOR[s.taskStatus || "none"] } }),
							"任务进程")
					},
						(s.taskStatus === "none"
							? null
							: s.taskStatus === "running"
								? React.createElement("div", null,
									React.createElement(Row, { left: (s.contextUsagePct ?? 0) + "%", right: "计划 " + (s.plannedSteps || 8) + " 步 · 已完成 " + (s.completedSteps || 0) }),
									React.createElement(SegBar, { pct: s.contextUsagePct, segments: s.plannedSteps, color: progressColor(s.contextUsagePct, s.taskStatus) }))
								: React.createElement("div", { style: { color: s.taskStatus === "complete" ? "#2ecc71" : s.taskStatus === "blocked" ? "#e5484d" : "#e6a23c" } },
									s.taskStatus === "complete" ? "完成" : s.taskStatus === "blocked" ? "任务受阻" : "待授权"))
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
