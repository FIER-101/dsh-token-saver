/* @dsh-plugins/token-saver — TOKEN Cat 侧边栏小组件（手写 bundle，loader 格式）
 * 每 2s 轮询 /dsh-token-widget/stats。
 * 头像 = 3D 立方体粒子动画（余额比例缩放 + 轰击/涟漪），可拖动置顶。 */
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
				body: JSON.stringify({ type: "client-request", rpcId: crypto.randomUUID(), method: "stats", payload: {} }),
				signal: AbortSignal.timeout(8000)
			});
			const full = await res.json();
			if (!full || full.type !== "server-response" || !full.result || full.result.ok === false) throw new Error("stats rpc failed");
			return full.result;
		}


																function ParticleCat({ variant, cube, anchorEl, anchorTitle }) {
			const canvasRef = React.useRef(null);
			const DISP = Math.round(150 * 1.5); // 动画显示范围放大 1.5 倍
			const POS_KEY = 'tw-token-cat-pos';
			const savedPos = (() => {
				try {
					const v = JSON.parse((typeof localStorage !== 'undefined' ? localStorage.getItem(POS_KEY) : null) || 'null');
					if (v && typeof v.x === 'number' && typeof v.y === 'number') return { x: v.x, y: v.y };
				} catch (e) { /* ignore */ }
				return null;
			})();
			const [pos, setPos] = React.useState(savedPos || {
				x: Math.max(8, (typeof window !== 'undefined' ? window.innerWidth : 1280) - DISP - 16),
				y: Math.max(8, (typeof window !== 'undefined' ? window.innerHeight : 800) - DISP - 16)
			});
			const drag = React.useRef(null);   // 拖动起点 {sx,sy,lx,ly}
			const moved = React.useRef(false); // 是否发生了拖拽（区分点击飞行）
			const [mode, setMode] = React.useState('rotate'); // rotate=拖旋转/锁位置; move=拖移动位置
			const modeRef = React.useRef('rotate');
			const lastClick = React.useRef(0);
			const flightTimer = React.useRef(null);
			const toggleMode = () => { const n = modeRef.current === 'move' ? 'rotate' : 'move'; modeRef.current = n; setMode(n); };
			const cubeRef = React.useRef(1);       // 当前立方体缩放(0.2..1)
			const particlesRef = React.useRef(null);
			const posInitRef = React.useRef(false); // 默认位置只设置一次
			React.useEffect(() => {
				ensureStyle();
				const canvas = canvasRef.current;
				if (!canvas) return () => {};
				const ctx = canvas.getContext("2d");
				const W = DISP, H = DISP;
				canvas.width = W; canvas.height = H;
				// 默认位置：插件显示区域水平居中，垂直放在"TOKEN Cat"词条上方 1px（无手动放置记录时，仅首次挂载）
				try {
					if (!posInitRef.current && !savedPos && ((anchorEl && anchorEl.current) || canvas.parentElement)) {
						const host = (anchorEl && anchorEl.current) || canvas.parentElement;
						requestAnimationFrame(() => requestAnimationFrame(() => {
							if (posInitRef.current || !host.isConnected) return;
							posInitRef.current = true;
							const r = host.getBoundingClientRect();
							let top = r.top - DISP - 12;
							const title = anchorTitle && anchorTitle.current;
							if (title) { const tr = title.getBoundingClientRect(); top = tr.top - DISP - 1; }
							setPos({ x: Math.max(8, r.left + r.width / 2 - DISP / 2), y: Math.max(8, top) });
						}));
					}
				} catch (e) { /* 忽略 */ }
				const RUBIK = ["#e5484d", "#f0b90b", "#2ecc71", "#4f8cff", "#ffffff", "#ff8a00"];
				const SIZE = 1.2, GRID = 7, FOCAL = Math.round(60 * 1.5), DIST = 3.2;
				// 轰击：每 7 秒 3 颗粒子飞向立方体，错峰先后命中（顺序随机）；撞击速度随机，力度=速度（成正比），决定撞击环与反馈强度
				const STRIKE_EVERY = 7, STRIKE_IN = 1.3, STRIKE_GAP = 0.8; // STRIKE_GAP=相邻起飞错峰间隔（含随机速度差异余量），保证绝不"同时击中"
				const BORDER_R = 3.8; // 轰击粒子从外部边框飞入，绕立方体做电子式螺旋运动（随机角度/速度决定命中点）
				const WAVE_STR = 0.1, HOP = 0.06, CONTACT = 0.4; // 传导强度(不再衰减)；每跳时长0.06s；外部粒子命中判定距离
				const TRAIL_LIFE = 0.55, TRAIL_MAX = 100; // 飞行轨迹：尾迹存活时长(s)与最大点数（短线、逐渐消失）
				const faces = [[0,0,1],[0,0,-1],[0,1,0],[0,-1,0],[1,0,0],[-1,0,0]];
				const particles = [];
				for (const n of faces) {
					for (let a = 0; a < GRID; a++) for (let b = 0; b < GRID; b++) {
						const t = -1 + 2 * a / (GRID - 1), u = -1 + 2 * b / (GRID - 1);
						let x, y, z;
						if (Math.abs(n[0]) === 1) { x = n[0] * SIZE; y = t * SIZE; z = u * SIZE; }
						else if (Math.abs(n[1]) === 1) { y = n[1] * SIZE; x = t * SIZE; z = u * SIZE; }
						else { z = n[2] * SIZE; x = t * SIZE; y = u * SIZE; }
						particles.push({ bx: x, by: y, bz: z, ox: x, oy: y, oz: z, x, y, z, vx: 0, vy: 0, vz: 0, id: Math.random() * 6, ph: Math.random() * 6.28, fly: null });
					}
				}
				particlesRef.current = particles;
				// 邻接关系（相距<0.6即为相邻）；传导级数在每次命中时从受击粒子做 BFS
				const neighbors = [];
				for (let i = 0; i < particles.length; i++) {
					const arr = [];
					const a = particles[i];
					for (let j = 0; j < particles.length; j++) {
						if (i === j) continue;
						const b = particles[j];
						const dx = a.ox - b.ox, dy = a.oy - b.oy, dz = a.oz - b.oz;
						if (dx * dx + dy * dy + dz * dz < 0.36) arr.push(j);
					}
					neighbors.push(arr);
				}
				const bfs = (src) => {
					const lv = new Array(particles.length).fill(-1);
					lv[src] = 0; let fr = [src], m = 0;
					while (fr.length) {
						const nx = [];
						for (const i of fr) for (const j of neighbors[i]) if (lv[j] < 0) { lv[j] = lv[i] + 1; nx.push(j); }
						fr = nx; m++;
					}
					return { levels: lv, maxLevel: m };
				};
				// 立方体表面随机点（回归落点）
				const randSurface = () => {
					const f = faces[Math.floor(Math.random() * faces.length)];
					const t = (Math.random() * 2 - 1) * SIZE, u = (Math.random() * 2 - 1) * SIZE;
					if (Math.abs(f[0]) === 1) return { x: f[0] * SIZE, y: t, z: u };
					if (Math.abs(f[1]) === 1) return { x: t, y: f[1] * SIZE, z: u };
					return { x: t, y: u, z: f[2] * SIZE };
				};
				const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
				const lerp = (a, b, k) => a + (b - a) * k;
				// 拖动：rotate 模式=拖旋转(位置锁定/防误触)；move 模式=拖移动位置。双击切换
				let rotX = 0, rotY = 0;
				const onDown = (e) => { e.preventDefault(); moved.current = false; const r = canvas.getBoundingClientRect(); drag.current = { sx: e.clientX, sy: e.clientY, lx: r.left, ly: r.top, rx: rotX, ry: rotY }; try { canvas.setPointerCapture(e.pointerId); } catch (err) {} };
				const onMove = (e) => {
					if (!drag.current) return;
					const dx = e.clientX - drag.current.sx, dy = e.clientY - drag.current.sy;
					if (Math.abs(dx) + Math.abs(dy) > 3) moved.current = true;
					if (modeRef.current === 'move') {
						const np = { x: drag.current.lx + dx, y: drag.current.ly + dy };
						setPos(np);
						try { localStorage.setItem(POS_KEY, JSON.stringify(np)); } catch (err) { /* ignore */ } // 记住手动位置
					}
					else { rotX = drag.current.rx + dy * 0.012; rotY = drag.current.ry + dx * 0.012; }
				};
				const onUp = () => {
					const wasMoved = moved.current;
					drag.current = null;
					if (wasMoved) return;
					const now = Date.now();
					if (now - lastClick.current < 320) { // 双击 → 锁定/解锁拖动
						lastClick.current = 0;
						if (flightTimer.current) { clearTimeout(flightTimer.current); flightTimer.current = null; }
						toggleMode();
						return;
					}
					lastClick.current = now;
					if (flightTimer.current) clearTimeout(flightTimer.current);
					flightTimer.current = setTimeout(() => { flightTimer.current = null; doFlight(); }, 300);
				};
				// 多实例飞行（最多 10 次）
				const OUT = 0.8, HOLD = 0.5, RETURN = 1.3;
				const flights = [];
				let strikeTimer = STRIKE_EVERY, strike = null; const waves = []; // 多波并行：前一波未结束时，后续命中可再产生新波
				const doFlight = () => {
					if (flights.length >= 10) return;
					const avail = particles.filter((q) => !q.fly);
					const n = Math.min(Math.max(3, Math.floor(particles.length / 10)), avail.length);
					if (n <= 0) return;
					const sel = [];
					for (let i = 0; i < n; i++) sel.push(avail[Math.floor(Math.random() * avail.length)]);
					// 小立方体目标中心（右上前）与随机颜色
					let cx = 0, cy = 0, cz = 0;
					for (const p of sel) { cx += p.ox; cy += p.oy; cz += p.oz; }
					cx /= n; cy /= n; cz /= n;
					const fc = [cx + 2.0, cy + 1.6, cz + 1.2];
					const sc = 0.28;
					const color = RUBIK[Math.floor(Math.random() * RUBIK.length)];
					const fl = { particles: sel, color, phase: "out", p: 0, r: 0, holdT: 0, orbit: (Math.random() < 0.5 ? -1 : 1) * Math.PI * 2 * (0.8 + Math.random() * 0.4) };
					for (const p of sel) {
						const land = randSurface();
						p.fly = { home: { x: p.ox, y: p.oy, z: p.oz }, far: { x: fc[0] + (p.ox - fc[0]) * sc, y: fc[1] + (p.oy - fc[1]) * sc, z: fc[2] + (p.oz - fc[2]) * sc }, land, fl };
					}
					flights.push(fl);
				};
				canvas.addEventListener("pointerdown", onDown);
				canvas.addEventListener("pointermove", onMove);
				canvas.addEventListener("pointerup", onUp);
				canvas.addEventListener("pointercancel", onUp);
				let raf; let alive = true; let lastTime = performance.now();
				const tick = (now) => {
					if (!alive) return;
					const dt = Math.min((now - lastTime) / 1000, 0.05); lastTime = now;
					const t = now / 1000;
					const ax = t * 0.5 + rotX, ay = t * 0.7 + rotY;
					// 更新所有飞行状态机
					for (let fi = flights.length - 1; fi >= 0; fi--) {
						const fl = flights[fi];
						if (fl.phase === "out") { fl.p += dt / OUT; if (fl.p >= 1) { fl.p = 1; fl.phase = "hold"; fl.holdT = 0; } }
						else if (fl.phase === "hold") { fl.holdT += dt; if (fl.holdT >= HOLD) { fl.phase = "return"; fl.r = 0; } }
						else if (fl.phase === "return") {
							fl.r += dt / RETURN;
							if (fl.r >= 1) {
								for (const q of fl.particles) q.fly = null;
								flights.splice(fi, 1);
							}
						}
					}
					// 每 7 秒：固定 3 颗从外部边框飞入，绕立方体做电子式螺旋运动，每颗速度随机（力度=速度成正比）；
					// 起飞时刻按 STRIKE_GAP 错峰（延迟随机打乱 → 先后击中顺序随机），螺旋末段才接近立方体，命中窗口 < STRIKE_GAP，故绝不会同时击中；
					// 同一颗粒子可被后续粒子再次先后命中（只要不同时），每次命中都产生新一波涟漪（环大小/亮度/冲击随力度变化）
					strikeTimer += dt;
					if (!strike && waves.length === 0 && strikeTimer >= STRIKE_EVERY) {
						const delays = [0, STRIKE_GAP, STRIKE_GAP * 2].sort(() => Math.random() - 0.5);
						const mk = () => {
							const nx = Math.random() * 2 - 1, ny = Math.random() * 2 - 1, nz = Math.random() * 2 - 1;
							const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
							const n = { x: nx / nl, y: ny / nl, z: nz / nl };
							const ref = Math.abs(n.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
							let ux = n.y * ref.z - n.z * ref.y, uy = n.z * ref.x - n.x * ref.z, uz = n.x * ref.y - n.y * ref.x;
							const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1; ux /= ul; uy /= ul; uz /= ul;
							const vx = n.y * uz - n.z * uy, vy = n.z * ux - n.x * uz, vz = n.x * uy - n.y * ux;
							return { t: 0, R0: BORDER_R, w: 5 + Math.random() * 3, th0: Math.random() * Math.PI * 2,
								u: { x: ux, y: uy, z: uz }, v: { x: vx, y: vy, z: vz },
								striker: { x: 0, y: 0, z: 0 }, active: true, trail: [],
								spd: 0.8 + Math.random() * 0.9 }; // 撞击速度随机（0.8~1.7 倍），力度 = 速度，成正比
						};
						const strikers = [];
						for (let i = 0; i < 3; i++) { const s = mk(); s.delay = delays[i]; strikers.push(s); }
						strike = { strikers };
						strikeTimer = 0;
					}
					if (strike) {
						const hitR = CONTACT * cubeRef.current;
						for (const s of strike.strikers) {
							if (!s.active) continue;
							s.t += dt;
							if (s.t < s.delay) continue; // 错峰：还没到该粒子的起飞时刻
							const p = s.striker;
							const k = Math.min(1, (s.t - s.delay) / (STRIKE_IN / s.spd)); // 越快（spd 大）→ 越早到达
							const r = s.R0 * (1 - k * k);   // 螺旋向内
							const th = s.th0 + s.w * s.spd * s.t;   // 环绕运动（随速度加快）
							const cr = r * Math.cos(th), sr = r * Math.sin(th);
							p.x = s.u.x * cr + s.v.x * sr;
							p.y = s.u.y * cr + s.v.y * sr;
							p.z = s.u.z * cr + s.v.z * sr;
							// 记录飞行轨迹点（按全局时间，命中后残留也会逐渐消失）
							s.trail.push({ x: p.x, y: p.y, z: p.z, t });
							if (s.trail.length > TRAIL_MAX) s.trail.shift();
							// 接触判定：碰到的第一颗粒子（随机角度/速度 → 螺旋路径 → 命中点）
							let hit = -1;
							for (let i = 0; i < particles.length; i++) {
								const q = particles[i];
								const dx = q.ox - p.x, dy = q.oy - p.y, dz = q.oz - p.z;
								if (dx * dx + dy * dy + dz * dz < hitR * hitR) { hit = i; break; }
							}
							if (hit < 0 && k >= 1) { // 兜底：到中心仍未命中 → 命中最近粒子
								let best = 0, bd = Infinity;
								for (let i = 0; i < particles.length; i++) {
									const q = particles[i];
									const dx = q.ox - p.x, dy = q.oy - p.y, dz = q.oz - p.z;
									const d = dx * dx + dy * dy + dz * dz;
									if (d < bd) { bd = d; best = i; }
								}
								hit = best;
							}
							if (hit >= 0) {
								s.active = false; // 命中即消失
								// 每次命中都产生一波传导涟漪（即使前一波还未结束，多波并行传播、同方向速度叠加）
								const sp = particles[hit];
								const b = bfs(hit);
								waves.push({ level: 0, t: 0, maxLevel: b.maxLevel, levels: b.levels, sx: sp.ox, sy: sp.oy, sz: sp.oz, force: s.spd });
							}
						}
						// 全部命中且轨迹淡出完毕后结束（命中后残留轨迹继续逐渐消失；按最新点年龄判断，避免提前清空）
						if (strike.strikers.every((x) => !x.active && (!x.trail.length || t - x.trail[x.trail.length - 1].t > TRAIL_LIFE))) strike = null;
					}
					// 传导：多波并行，每跳（HOP 时间）把力传给下一级相邻粒子，强度均匀、不再逐级衰减
					for (let wi = waves.length - 1; wi >= 0; wi--) {
						const wave = waves[wi];
						wave.t += dt;
						if (wave.t >= HOP) {
							wave.t = 0;
							const lvl = wave.level;
							for (let i = 0; i < particles.length; i++) {
								if (wave.levels[i] !== lvl) continue;
								const p = particles[i];
								const dx = p.ox - wave.sx, dy = p.oy - wave.sy, dz = p.oz - wave.sz;
								const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
								const f = WAVE_STR * wave.force; // 力度=速度：越快，传导冲击越强
								p.vx += (dx / d) * f; p.vy += (dy / d) * f; p.vz += (dz / d) * f;
							}
							wave.level++;
							if (wave.level > wave.maxLevel) waves.splice(wi, 1);
						}
					}
					// 更新粒子位置
					for (const p of particles) {
						if (p.fly) {
							const fl = p.fly.fl;
							if (fl.phase === "out") { const k = ease(fl.p); p.x = lerp(p.fly.home.x, p.fly.far.x, k); p.y = lerp(p.fly.home.y, p.fly.far.y, k); p.z = lerp(p.fly.home.z, p.fly.far.z, k); }
							else if (fl.phase === "return") {
								const k = ease(fl.r);
								// far → land（线性）+ 绕 Y 轴按随机角度环绕一圈
								const bx = lerp(p.fly.far.x, p.fly.land.x, k), by = lerp(p.fly.far.y, p.fly.land.y, k), bz = lerp(p.fly.far.z, p.fly.land.z, k);
								const ang = fl.orbit * k;
								p.x = bx * Math.cos(ang) + bz * Math.sin(ang);
								p.y = by;
								p.z = -bx * Math.sin(ang) + bz * Math.cos(ang);
							}
							// hold 阶段保持在 far（小立方体）
						} else {
							p.x += p.vx; p.vx *= 0.96; p.x += (p.ox - p.x) * 0.05;
							p.y += p.vy; p.vy *= 0.96; p.y += (p.oy - p.y) * 0.05;
							p.z += p.vz; p.vz *= 0.96; p.z += (p.oz - p.z) * 0.05;
						}
					}
					// 投影绘制
					ctx.clearRect(0, 0, W, H);
					const ccx = W / 2, ccy = H / 2;
					const drawn = [];
					for (const p of particles) {
						let px, py, pz, col = null;
						if (p.fly) { px = p.x; py = p.y; pz = p.z; col = p.fly.fl.color; }
						else {
							const x1 = p.x * Math.cos(ay) + p.z * Math.sin(ay);
							const z1 = -p.x * Math.sin(ay) + p.z * Math.cos(ay);
							px = x1; py = p.y * Math.cos(ax) - z1 * Math.sin(ax); pz = p.y * Math.sin(ax) + z1 * Math.cos(ax);
						}
						drawn.push({ px, py, pz, p, isFly: !!p.fly, col });
					}
					drawn.sort((a, b) => b.pz - a.pz);
					const pscale = 0.5 + 0.5 * cubeRef.current; // 粒子体积缩小 = 整体缩小的 1/2
					for (const q of drawn) {
						const s = FOCAL / Math.max(0.8, DIST + q.pz);
						const sx = ccx + q.px * s, sy = ccy + q.py * s;
						const depth = Math.max(0, Math.min(1, (q.pz + 1.2) / 2.4));
						if (q.isFly) { ctx.globalAlpha = 0.9; ctx.fillStyle = q.col; ctx.beginPath(); ctx.arc(sx, sy, 3.0 * pscale, 0, Math.PI * 2); ctx.fill(); }
						else { const ci = Math.floor((t * 0.4 + q.p.id) % 6); ctx.globalAlpha = 0.25 + 0.75 * depth; ctx.fillStyle = RUBIK[ci]; ctx.beginPath(); ctx.arc(sx, sy, (2.4 + 2.7 * depth) * pscale, 0, Math.PI * 2); ctx.fill(); }
					}
					// 外部轰击粒子（3 颗，绕立方体电子式螺旋，命中即消失）＋ 逐渐消失的长线飞行轨迹
					if (strike) {
						for (const s of strike.strikers) {
							// 飞行轨迹：逐段描线，越靠近尾部越淡越细，命中后残留仍会淡出
							if (s.trail.length >= 2) {
								for (let i = 0; i < s.trail.length - 1; i++) {
									const a = s.trail[i], b = s.trail[i + 1];
									const age = t - a.t;
									const alive = 1 - age / TRAIL_LIFE;
									if (alive <= 0) continue;
									const ax1 = a.x * Math.cos(ay) + a.z * Math.sin(ay);
									const az1 = -a.x * Math.sin(ay) + a.z * Math.cos(ay);
									const apx = ax1, apy = a.y * Math.cos(ax) - az1 * Math.sin(ax), apz = a.y * Math.sin(ax) + az1 * Math.cos(ax);
									const as = FOCAL / Math.max(0.8, DIST + apz);
									const bx1 = b.x * Math.cos(ay) + b.z * Math.sin(ay);
									const bz1 = -b.x * Math.sin(ay) + b.z * Math.cos(ay);
									const bpx = bx1, bpy = b.y * Math.cos(ax) - bz1 * Math.sin(ax), bpz = b.y * Math.sin(ax) + bz1 * Math.cos(ax);
									const bs = FOCAL / Math.max(0.8, DIST + bpz);
									ctx.globalAlpha = 0.55 * alive;
									ctx.strokeStyle = "#ffffff";
									ctx.lineWidth = 0.6 + 2.4 * alive;
									ctx.beginPath();
									ctx.moveTo(ccx + apx * as, ccy + apy * as);
									ctx.lineTo(ccx + bpx * bs, ccy + bpy * bs);
									ctx.stroke();
								}
							}
							// 头部粒子（仅飞行中显示）
							if (s.active && s.t >= s.delay) {
								const sp = s.striker;
								const x1 = sp.x * Math.cos(ay) + sp.z * Math.sin(ay);
								const z1 = -sp.x * Math.sin(ay) + sp.z * Math.cos(ay);
								const px = x1, py = sp.y * Math.cos(ax) - z1 * Math.sin(ax), pz = sp.y * Math.sin(ax) + z1 * Math.cos(ax);
								const ss = FOCAL / Math.max(0.8, DIST + pz);
								const sx = ccx + px * ss, sy = ccy + py * ss;
								ctx.globalAlpha = 0.95; ctx.fillStyle = "#ffffff";
								ctx.beginPath(); ctx.arc(sx, sy, 3.3, 0, Math.PI * 2); ctx.fill();
							}
						}
					}
					// 传导波前（每波从受击粒子处随级数外扩的圆环提示，多波并行；双层描边 + 命中点闪光，更醒目）
					for (const wave of waves) {
						const x1 = wave.sx * Math.cos(ay) + wave.sz * Math.sin(ay);
						const z1 = -wave.sx * Math.sin(ay) + wave.sz * Math.cos(ay);
						const wpx = x1, wpy = wave.sy * Math.cos(ax) - z1 * Math.sin(ax), wpz = wave.sy * Math.sin(ax) + z1 * Math.cos(ax);
						const wss = FOCAL / Math.max(0.8, DIST + wpz);
						const wsx = ccx + wpx * wss, wsy = ccy + wpy * wss;
						const rs = FOCAL / DIST;
						const prog = wave.level + wave.t / HOP;
						const fade = Math.max(0, 1 - prog / (wave.maxLevel + 1));
						// 力度 = 撞击速度（成正比）：决定环的最大半径与亮度，上限不超过画面窗口尺寸的 42%
						const fN = Math.min(1, wave.force / 1.7);
						const ringMax = DISP * 0.42 * fN;
						const rad = Math.min(prog / (wave.maxLevel + 1), 1) * ringMax * (0.7 + 0.3 * cubeRef.current);
						const boost = 0.55 + 0.45 * fN;
						// 外圈柔光（宽而淡的晕，随力度增强）
						ctx.globalAlpha = 0.30 * boost * fade;
						ctx.strokeStyle = "#ffffff";
						ctx.lineWidth = 8;
						ctx.beginPath(); ctx.arc(wsx, wsy, rad, 0, Math.PI * 2); ctx.stroke();
						// 内圈亮线（细而实的波前，随力度增强）
						ctx.globalAlpha = 0.85 * boost * fade;
						ctx.lineWidth = 2.5;
						ctx.beginPath(); ctx.arc(wsx, wsy, rad, 0, Math.PI * 2); ctx.stroke();
						// 命中点闪光（随波淡出，随力度放大增亮）
						ctx.globalAlpha = 0.9 * boost * fade;
						ctx.fillStyle = "#ffffff";
						ctx.beginPath(); ctx.arc(wsx, wsy, 0.16 * rs * (0.5 + 0.5 * cubeRef.current) * (0.7 + 0.3 * fN), 0, Math.PI * 2); ctx.fill();
					}
					ctx.globalAlpha = 1;
					raf = requestAnimationFrame(tick);
				};
				raf = requestAnimationFrame(tick);
				return () => { if (flightTimer.current) { clearTimeout(flightTimer.current); flightTimer.current = null; } alive = false; cancelAnimationFrame(raf); canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onUp); };
			}, [variant]);
			// 立方体大小随余额比例变化：满额=全尺寸(1)，余额低→最小 1/5(0.2)
			React.useEffect(() => {
				const sc = 0.2 + 0.8 * Math.min(1, Math.max(0, typeof cube === 'number' ? cube : 1));
				cubeRef.current = sc;
				if (particlesRef.current) for (const p of particlesRef.current) { p.ox = p.bx * sc; p.oy = p.by * sc; p.oz = p.bz * sc; }
			}, [cube]);

			return React.createElement("canvas", { ref: canvasRef, style: { position: "fixed", left: pos.x, top: pos.y, zIndex: 2147483000, width: DISP, height: DISP, cursor: mode === "move" ? "move" : "grab", touchAction: "none", userSelect: "none", borderRadius: 12, background: mode === "move" ? "rgba(10,12,18,.25)" : "transparent" } });
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
			const rootRef = React.useRef(null);
			const titleRef = React.useRef(null);
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
			const balRatio = balOk && bal.total > 0 ? Math.min(1, Math.max(0, bal.total / cap)) : 1; // 满额=1 → 立方体全尺寸
			const balTime = fmtTime(s && s.balanceUpdatedAt);
			const last = s && s.lastCompression;
			const pred = s && s.predictions;

			return React.createElement("div", { ref: rootRef, style: { position: "relative", padding: "8px 4px", fontSize: 12, lineHeight: 1.5 } },
				React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 } },
					React.createElement(ParticleCat, { variant, cube: balRatio, anchorEl: rootRef, anchorTitle: titleRef }),
					React.createElement("div", null,
						React.createElement("div", { ref: titleRef, style: { fontWeight: 700, letterSpacing: 0.5 } }, "TOKEN Cat"),
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
