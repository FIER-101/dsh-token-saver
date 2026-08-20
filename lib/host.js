// Token 管家（TOKEN Cat）—— 标准 Cordis 插件（Host 半区，持久化版）
// 功能：
//  - 工具输出智能压缩（head/middle/tail）＋ 压缩节省统计（字符/token/¥）
//  - 错误率追踪：压缩后报错/同工具重试在滚动窗口内统计；飙升则自动优化压缩算法
//  - 用量统计：余额（官方 /user/balance）、当日花费（官方余额差值）、本次花费、当前任务进程
//  - 启发式预测：高花费风险触发模型确认 → 全自动给出最优策略 + 成本预警
//  - 实时推送统计/历史到专用数据仓库（FIER-101/dsh-token-data）
//  - 侧边栏小组件 RPC（/dsh-token-widget）
import { defineTool } from '@deepseek-ai/dsh-tools';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const name = 'dsh-token-saver';
const inject = ['tools', 'tokenMeter', 'sessions', 'connection', 'credentials', 'systemPrompt', 'sessionProjections'];

// ─── 配置（可按需调整） ───
const PRICE_PER_1M = 2;              // ¥ / 百万 token（估算价）
const CHARS_PER_TOKEN = 2;           // 字符 → token 粗估（CJK 场景）
const ERROR_WINDOW = 50;             // 错误率滚动窗口（压缩事件数）
const MIN_COMPRESSIONS = 5;          // 至少多少次压缩才评估错误率
const ERROR_RATE_THRESHOLD = 0.25;   // 错误率阈值：超过则自动优化
const RETRY_WINDOW_MS = 20000;       // 压缩后同工具在此窗口内重试 → 记为压缩低效
const MAX_OPTIMIZATIONS = 3;         // 最多自动优化次数
const RISK_MEDIUM_PCT = 0.3;         // 当日花费占余额 30% → medium
const RISK_HIGH_PCT = 0.6;           // 60% → high
const PREDICT_MODEL = 'deepseek-chat'; // 预测用模型
const PREDICT_COOLDOWN_MS = 5 * 60 * 1000; // 预测冷却
const DATA_REPO = 'FIER-101/dsh-token-data'; // 数据推送仓库
const PUSH_INTERVAL_MS = 60 * 1000;  // 推送间隔
const HISTORY_CAP = 500;             // 历史快照条数上限

// ─── 本地案例库（小模型）：top30% 正反馈案例 + 第一性原理规则 ───
const dshHome = (typeof process !== 'undefined' && process.env && process.env.DSH_HOME)
  || ((process.env.HOME || process.env.USERPROFILE || '') + '/.dsh');
const casesDir = dshHome + '/data';
const casesFile = casesDir + '/token-cases.jsonl';
let caseBase = [];   // 仅保留 top30% 高分案例
let caseRules = [];  // 提炼的规则（第一性原理）

function loadCases() {
  try {
    if (!existsSync(casesFile)) return [];
    return readFileSync(casesFile, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch (e) { return []; }
}
function saveCases(list) {
  try { mkdirSync(casesDir, { recursive: true }); writeFileSync(casesFile, list.map((c) => JSON.stringify(c)).join('\n') + '\n', 'utf8'); } catch (e) { /* 存储失败静默 */ }
}
// 综合分：大额 / 省时 / 高效果（越大越好）
function caseScore(c) {
  const saved = (c.outcome && c.outcome.savedTokens) || 0;
  const timeMin = Math.max(0.1, ((c.outcome && c.outcome.timeMs) || 60000) / 60000);
  const effect = (c.outcome && c.outcome.effect) || 1;
  return saved * effect / timeMin;
}
// 从最优方案提炼"第一性原理"规则（底层原因，而非表面模板）
function distillRule(rec) {
  const s = rec || '';
  if (/拆分|分步|拆|batch|逐/i.test(s)) return '将大任务拆为可检查点的小步，逐步确认，避免单步失控';
  if (/检查点|checkpoint|确认|停止|暂停/i.test(s)) return '高风险先建检查点并向用户确认，不盲目推进';
  if (/收敛|减少|精简|范围|聚焦/i.test(s)) return '收敛任务范围，去掉冗余与重复，聚焦核心目标';
  if (/缓存|复用|增量|重用|cache/i.test(s)) return '优先复用已缓存/已有结果，做增量而非全量重算';
  return '收敛范围、减少冗长中间步骤，先检查点再继续';
}
function recordCase(c) {
  try {
    c.id = 'case_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    c.ts = Date.now();
    c.score = caseScore(c);
    c.principle = 'first-principles';
    caseBase.push(c);
    caseBase.sort((a, b) => b.score - a.score);
    const keep = Math.max(3, Math.ceil(caseBase.length * 0.3));
    caseBase = caseBase.slice(0, keep);
    saveCases(caseBase);
    distillSummary();
  } catch (e) { /* 忽略 */ }
}
function distillSummary() {
  const freq = new Map();
  for (const c of caseBase) { const r = c.rule || distillRule(c.plan && c.plan.recommendation); freq.set(r, (freq.get(r) || 0) + 1); }
  caseRules = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([rule, count]) => ({ rule, count, principle: 'first-principles' }));
}
// 读取 Vault 数据库的蒸馏/设计产出，作为"更好更快方法"提醒的补充数据源
function loadVaultDistilRules() {
  try {
    const f = dshHome + '/data/dsh-vault/vault.json';
    if (!existsSync(f)) return [];
    const v = JSON.parse(readFileSync(f, 'utf8'));
    if (!v || !Array.isArray(v.entries)) return [];
    const rules = [];
    for (const e of v.entries) {
      if (e.type === 'distil' && e.content) {
        try { const c = JSON.parse(e.content); if (c && c.final) rules.push(String(c.final).slice(0, 140)); } catch (e2) { if (e.title) rules.push(String(e.title).slice(0, 140)); }
      } else if (e.type === 'design' && e.content && typeof e.content === 'string' && e.content.length < 300) {
        rules.push(String(e.content).slice(0, 140));
      }
    }
    return rules.slice(0, 5);
  } catch (e) { return []; }
}
function queryCases(task, topK) {
  const k = topK || 3;
  let ranked = caseBase.slice();
  if (task) {
    const toks = String(task).toLowerCase().split(/[\s,，。;；.、/]+/).filter(Boolean);
    ranked = ranked.map((c) => {
      const hay = (((c.plan && c.plan.recommendation) || '') + ' ' + ((c.scenario && c.scenario.forecast) || '') + ' ' + ((c.rule) || '')).toLowerCase();
      let hit = 0; for (const t of toks) if (t && hay.includes(t)) hit++;
      return { c, hit };
    }).sort((a, b) => (b.hit - a.hit) || (b.c.score - a.c.score)).map((x) => x.c);
  }
  return {
    principle: '第一性原理：先回到需求本质与最小必要成本，再以历史正反馈案例为证据而非模板',
    rules: caseRules,
    top: ranked.slice(0, k),
  };
}

// ─── 每日基线持久化：重启不重置当日花费/用量 ───
const STATE_FILE = dshHome + '/data/token-saver-state.json';
function loadPersistedState() {
  try { if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch (e) {}
  return {};
}
function savePersistedState(state) {
  try { mkdirSync(dshHome + '/data', { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8'); } catch (e) {}
}

async function apply(ctx) {
  const tm = ctx.get('tokenMeter');
  const sessions = ctx.get('sessions');
  const connection = ctx.get('connection');
  const creds = ctx.get('credentials');
  const systemPrompt = ctx.get('systemPrompt');

  // 压缩开关（内存态）
  let enabled = true;
  // 排除名单：这些工具的结果通常需要完整查看，跳过压缩。
  const EXCLUDE = new Set([
    'read', 'write', 'edit', 'glob', 'grep',
    'cordis_inspect_self', 'cordis_inspect_query', 'cordis_inspect_list',
    'github_read_file', 'token_usage',
  ]);

  // 压缩参数（自动优化会动态调整）
  let textLimit = 8000;
  let headRatio = 0.4;
  let tailRatio = 0.25;

  // 压缩事件窗口（错误率）
  const compressEvents = []; // { at, tool, errored }
  let recentCompression = null;
  let compressionErrors = 0;
  let agentsRunning = 0; // 运行中的 agent 数（任务结束判定）
  let taskSteps = 0;     // 当前任务已执行步骤数
  // 通用工具结果窗口：实时错误率（"思路出错"代理，随任务自然波动）
  const toolOutcomes = []; // { at, ok }
  // 压缩专用错误率（供 maybeOptimize 自动优化）
  let compressionErrRate = 0;

  // 实时统计（供侧边栏小组件读取）
  const stats = {
    enabled,
    totalTokens: 0,
    surfaceTokens: 0,
    nodeCount: 0,
    logRevision: 0,
    compressedCount: 0,
    lastCompression: null,
    updatedAt: 0,
    // 分区 UI
    balance: { available: false, total: 0, currency: '' },
    balanceUpdatedAt: 0,
    todayTokens: 0,
    todaySpend: 0,       // 当日花费（官方余额差值，与官网同步）
    sessionTokens: 0,    // 本次（当前最活跃会话）token
    sessionSpend: 0,     // 本次花费 ¥
    contextUsagePct: 0,  // 当前任务进程（最活跃会话上下文占用 %）
    contextSurface: 0,   // 当前任务上下文增量（自任务开始）
    contextWindow: 131072,
    tasks: [],           // 每个活跃任务的进度（一个任务一根进度条）
    taskCount: 0,        // 活跃任务数
    balanceCap: 100,
    // 节省 / 错误率 / 风险
    savedChars: 0,
    savedTokens: 0,
    savedMoney: 0,
    errorRate: 0,
    risk: 'low', // low | medium | high
    predictions: null,
    optimizationCount: 0,
    lastOptimize: null,
    // 智能节省（正反馈机制）
    providerCacheSaved: 0,   // 缓存命中真实节省（provider cacheRead，与底部同源）
    planSavedTokens: 0,      // 最优方案预计节省（累计，正反馈记功）
    smartSavedTokens: 0,     // = savedTokens(压缩) + providerCacheSaved + planSavedTokens
    smartSavedMoney: 0,      // 智能节省对应金额 ¥
    lastPlanSaved: null,     // 最近一次正反馈记功记录
    caseRules: [],           // 提炼规则（第一性原理）
    caseCount: 0,            // 案例库条目数（top30%）
    skillCount: 0,           // 已装 skill 数（类比提醒用）
    skillNames: [],          // 部分 skill 名（类比提醒用）
  };

  // 自然日基线 / 余额缓存 / 当日余额起点
  let dayKey = localDayKey();
  let baselineTokens = null;
  let dayStartBalance = null;
  let balanceCache = { at: 0 };

  // 载入持久化每日基线：重启后当日花费/用量不归零
  const persistedState = loadPersistedState();
  if (persistedState && persistedState.dayKey === localDayKey()) {
    if (typeof persistedState.baselineTokens === 'number') baselineTokens = persistedState.baselineTokens;
    if (typeof persistedState.dayStartBalance === 'number') dayStartBalance = persistedState.dayStartBalance;
    if (persistedState.dayKey) dayKey = persistedState.dayKey;
  }

  // 每个任务(会话)一条进度条：新用户消息(新任务)到来时重置该任务基线
  const taskBaselines = new Map(); // sessionId -> 任务开始时的 surface
  ctx.on('session/event', (session, event) => {
    if (event && event.type === 'user/message' && session && tm) {
      try { const m = tm.measure(session); taskBaselines.set(session.id, m ? (m.surfaceTokens ?? 0) : 0); } catch (e) { /* ignore */ }
    }
  });

  // 历史快照（内存 + 推送）
  const history = [];
  let historyPushed = 0; // 已推送仓库的条数游标（增量追加用）

  // 最优方案正反馈：预测给出 high_spend + 预计节省 → 风险收敛后记功
  let pendingPlan = null; // { savedTokens, anchorSpend, at }

  // 本地案例库（小模型）：载入历史正反馈案例
  caseBase = loadCases();
  distillSummary();

  // 已装 skill 目录：供"已有能力未发现"提醒
  const skillsSvc = ctx.get('skills');
  if (skillsSvc && typeof skillsSvc.list === 'function') {
    skillsSvc.list({}).then((list) => {
      if (Array.isArray(list)) { stats.skillCount = list.length; stats.skillNames = list.slice(0, 8).map((s) => (s && s.name) || '').filter(Boolean); }
    }).catch(() => { /* 忽略 */ });
  }

  // 缓存命中真实节省：订阅与对话框底部同源的 tokenUsage 投影（provider 口径）
  // 取"自本插件启动以来的增量"，避免把整段会话累计值当成节省
  const sp = ctx.get('sessionProjections');
  let providerCacheBase = null;
  if (sp && typeof sp.onChanged === 'function') {
    sp.onChanged((_session, key, value, _seq) => {
      if (key === 'tokenUsage' && value && typeof value.cacheReadTokens === 'number') {
        if (providerCacheBase === null) providerCacheBase = value.cacheReadTokens;
        stats.providerCacheSaved = Math.max(0, value.cacheReadTokens - providerCacheBase);
      }
    });
  }

  function localDayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function totalTokensAllSessions() {
    if (!tm || !sessions || typeof sessions.list !== 'function') return 0;
    let sum = 0;
    for (const s of sessions.list()) {
      try { const m = tm.measure(s); if (m) sum += (m.totalTokens ?? 0); } catch (e) { /* ignore */ }
    }
    return sum;
  }

  function refreshToday() {
    const now = localDayKey();
    if (dayKey !== now) { dayKey = now; baselineTokens = null; dayStartBalance = null; }
    const total = totalTokensAllSessions();
    if (baselineTokens === null) baselineTokens = total;
    stats.todayTokens = Math.max(0, total - baselineTokens);
    // 当日花费：优先用官方余额差值（与官网同步）；余额不可用时回退 token 估算
    const balTotal = (stats.balance && stats.balance.total) || 0;
    if (balTotal > 0) {
      if (dayStartBalance === null) dayStartBalance = balTotal;
      stats.todaySpend = Math.max(0, Math.round((dayStartBalance - balTotal) * 100) / 100);
    } else {
      stats.todaySpend = Math.round(stats.todayTokens / 1e6 * PRICE_PER_1M * 100) / 100;
    }
    savePersistedState({ dayKey, baselineTokens, dayStartBalance });
  }

  async function refreshBalance() {
    if (!creds) { stats.balance = { available: false, total: 0, currency: '' }; return; }
    // 无论成功失败都推进冷却：避免失败时每 2s 高频重试官方余额 API
    if (Date.now() - balanceCache.at < 60000) return;
    balanceCache = { at: Date.now() };
    try {
      const r = await creds.resolve('DEEPSEEK_API_KEY');
      const key = r && r.value;
      if (!key) { stats.balance = { available: false, total: 0, currency: '' }; return; }
      const res = await fetch('https://api.deepseek.com/user/balance', {
        headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return;
      const data = await res.json();
      const info = (data && Array.isArray(data.balance_infos) && data.balance_infos[0]) || null;
      stats.balance = info ? {
        available: data.is_available !== false,
        total: Number(info.total_balance) || 0,
        currency: info.currency || 'CNY',
      } : { available: false, total: 0, currency: '' };
      stats.balanceUpdatedAt = Date.now();
    } catch (e) { /* 失败保留旧值；冷却已推进，60s 后再试 */ }
  }

  // ─── 压缩（带节省统计） ───
  ctx.on('tools/post-execute', (exec, result, next) => {
    try {
      if (enabled && exec && !EXCLUDE.has(exec.name)
          && result && result.isError === false && Array.isArray(result.content)) {
        let total = 0;
        let hasText = false;
        for (const b of result.content) {
          if (b && b.type === 'text' && typeof b.text === 'string') { total += b.text.length; hasText = true; }
        }
        if (hasText && total > textLimit) {
          const pruned = result.content.map((b) => {
            if (b && b.type === 'text' && typeof b.text === 'string' && b.text.length > textLimit) {
              const t = b.text;
              const headLen = Math.floor(t.length * headRatio);
              const tailLen = Math.floor(t.length * tailRatio);
              const kept = headLen + tailLen;
              const placeholder = '\n\n[已智能压缩：' + t.length + ' 字符 → 保留 ' + kept + ' 字符，省略中间 ' + (t.length - kept) + ' 字符]\n\n';
              stats.compressedCount += 1;
              stats.lastCompression = { at: Date.now(), tool: exec.name, original: t.length, kept, skipped: t.length - kept };
              const charsSaved = t.length - kept;
              stats.savedChars += charsSaved;
              stats.savedTokens += Math.round(charsSaved / CHARS_PER_TOKEN);
              stats.savedMoney = Math.round(stats.savedTokens / 1e6 * PRICE_PER_1M * 100) / 100;
              const ev = { at: Date.now(), tool: exec.name, errored: false };
              compressEvents.push(ev);
              if (compressEvents.length > ERROR_WINDOW) compressEvents.shift();
              recentCompression = ev;
              return { ...b, text: t.slice(0, headLen) + placeholder + t.slice(t.length - tailLen) };
            }
            return b;
          });
          return Promise.resolve({ kind: 'accept', content: pruned });
        }
      }
    } catch (e) { /* 压缩失败放行 */ }
    return next();
  });

  // 通用工具结果窗口 + 压缩归因
  ctx.on('tools/result', (_exec, result) => {
    try {
      const ok = !(result && result.isError === true);
      toolOutcomes.push({ at: Date.now(), ok });
      if (toolOutcomes.length > ERROR_WINDOW) toolOutcomes.shift();
    } catch (e) { /* ignore */ }
    // 错误归因 A：工具结果报错且 30s 内有压缩 → 压缩相关错误
    if (result && result.isError && recentCompression && Date.now() - recentCompression.at < 30000) {
      if (!recentCompression.errored) { recentCompression.errored = true; compressionErrors += 1; }
    }
  });

  // 错误归因 B：压缩过的工具在窗口内又被调用（疑似丢信息重试）→ 压缩低效
  ctx.on('tools/pre-execute', (exec, next) => {
    try {
      if (exec && exec.name && recentCompression && recentCompression.tool === exec.name
          && Date.now() - recentCompression.at < RETRY_WINDOW_MS && !recentCompression.errored) {
        recentCompression.errored = true;
        compressionErrors += 1;
      }
    } catch (e) { /* ignore */ }
    return next();
  });

  // 任务进度：agent 运行状态。任一 agent 运行=任务进行中；全部空闲=任务结束 → 100%
  ctx.on('agent/status', (payload) => {
    try {
      const st = payload && payload.status;
      if (st === 'running') { if (agentsRunning === 0) taskSteps = 0; agentsRunning += 1; }
      else if (st === 'idle') { agentsRunning = Math.max(0, agentsRunning - 1); }
    } catch (e) { /* ignore */ }
  });
  // 每执行一步推进任务进度（waterfall：必须调用并返回 next）
  ctx.on('agent/pre-step', (payload, next) => {
    try { taskSteps += 1; } catch (e) { /* ignore */ }
    return next();
  });

  function computeErrorRate() {
    // 通用工具错误率（实时）：统计最近若干次工具调用的失败占比
    if (toolOutcomes.length >= 3) {
      const err = toolOutcomes.filter((o) => !o.ok).length;
      stats.errorRate = Math.round(err / toolOutcomes.length * 100) / 100;
    } else {
      stats.errorRate = 0;
    }
    // 压缩专用错误率（供 maybeOptimize 自动优化）
    compressionErrRate = compressEvents.length >= MIN_COMPRESSIONS
      ? Math.round(compressEvents.filter((e) => e.errored).length / compressEvents.length * 100) / 100
      : 0;
  }

  // 错误率飙升 → 自动优化压缩算法（全自动）
  function maybeOptimize() {
    if (compressEvents.length < MIN_COMPRESSIONS || stats.optimizationCount >= MAX_OPTIMIZATIONS) return;
    if (compressionErrRate > ERROR_RATE_THRESHOLD) {
      textLimit = Math.min(textLimit * 2, 64000);
      headRatio = Math.min(headRatio + 0.1, 0.6);
      tailRatio = Math.min(tailRatio + 0.1, 0.4);
      const tool = recentCompression && recentCompression.tool;
      if (tool) EXCLUDE.add(tool);
      stats.optimizationCount += 1;
      stats.lastOptimize = { at: Date.now(), errorRate: stats.errorRate, textLimit, headRatio, tailRatio, excludedTool: tool || null };
      compressEvents.length = 0;
      compressionErrors = 0;
      stats.errorRate = 0;
    }
  }

  // ─── 启发式风险（当日花费占余额比例） ───
  function heuristicRisk() {
    const total = (stats.balance && stats.balance.total) || 0;
    if (total <= 0) return 'low';
    const ratio = stats.todaySpend / total;
    if (ratio >= RISK_HIGH_PCT) return 'high';
    if (ratio >= RISK_MEDIUM_PCT) return 'medium';
    return 'low';
  }

  // ─── 模型确认预测（启发式触发 + 冷却防刷） ───
  function buildPredictionPrompt() {
    const bal = stats.balance && stats.balance.available ? stats.balance.total : '未知';
    const recent = history.slice(-5).map((h) => '  ' + new Date(h.at).toISOString() + ' spend=' + h.todaySpend + ' total=' + h.totalTokens + ' err=' + h.errorRate).join('\n');
    return [
      '当前会话用量与账户信息：',
      '- 余额：' + bal + ' ' + (stats.balance && stats.balance.currency || ''),
      '- 当日已花费：¥' + stats.todaySpend + '（' + stats.todayTokens + ' tokens）',
      '- 当前会话（本次）：' + stats.sessionTokens + ' tokens，上下文 ' + stats.surfaceTokens + '/' + stats.contextWindow,
      '- 压缩节省：' + stats.savedTokens + ' tokens（约 ¥' + stats.savedMoney + '），压缩错误率 ' + (stats.errorRate * 100).toFixed(1) + '%',
      '- 压缩自动优化次数：' + stats.optimizationCount,
      '最近历史：\n' + (recent || '  暂无'),
      '请判断当前任务是否可能高花费，并给出最省钱的最优策略。',
    ].join('\n');
  }

  async function predictWithModel() {
    if (!creds) return;
    const lastAt = (stats.predictions && stats.predictions.at) || 0;
    if (Date.now() - lastAt < PREDICT_COOLDOWN_MS) return;
    try {
      const r = await creds.resolve('DEEPSEEK_API_KEY');
      const key = r && r.value;
      if (!key) return;
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({
          model: PREDICT_MODEL,
          max_tokens: 200,
          messages: [
            { role: 'system', content: '你是 DSH Token 管家的成本预测助手。基于用户提供的会话用量与历史，判断当前任务是否可能高花费，并给出最省钱的最优策略。只返回 JSON：{"high_spend": 布尔, "forecast": "剩余花费估计说明", "recommendation": "一句话最优策略", "saved_tokens_estimate": 数字(若采纳该最优方案、预计可节省的 token 数；无法估计则 0)}' },
            { role: 'user', content: buildPredictionPrompt() },
          ],
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return;
      const data = await res.json();
      const txt = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      let parsed = null;
      if (txt) { try { parsed = JSON.parse(txt.replace(/```(?:json)?|```/g, '').trim()); } catch (e) { /* 不解析则仅记录原文 */ } }
      const highSpend = !!(parsed && parsed.high_spend);
      stats.predictions = {
        at: Date.now(),
        high_spend: highSpend,
        forecast: (parsed && parsed.forecast) || null,
        recommendation: (parsed && parsed.recommendation) || null,
      };
      // 正反馈：高风险 → 记下最优方案预计节省；预测转低风险 → 视为已收敛，记功
      if (highSpend) {
        const est = parsed && Number.isFinite(Number(parsed.saved_tokens_estimate)) ? Math.max(0, Number(parsed.saved_tokens_estimate)) : 0;
        pendingPlan = { savedTokens: Math.round(est), anchorSpend: stats.todaySpend, at: Date.now() };
      } else if (pendingPlan) {
        creditPlan();
      }
    } catch (e) { /* 预测失败不影响主流程 */ }
  }

  // ─── 正反馈记功：采纳最优方案并收敛后，把预计节省记上账 ───
  function creditPlan() {
    // 取出即清空：即使 refreshStats(2s) 与 predictWithModel 双触发，也只记一次功
    const plan = pendingPlan;
    pendingPlan = null;
    if (!plan || plan.savedTokens <= 0) return;
    const saved = Math.round(plan.savedTokens);
    const timeMs = Math.max(1, Date.now() - (plan.at || Date.now()));
    stats.planSavedTokens += saved;
    stats.lastPlanSaved = { at: Date.now(), savedTokens: saved, anchorSpend: plan.anchorSpend, timeMs };
    // 记录正反馈案例（大额 + 省时 + 高效果），进入本地小模型库
    recordCase({
      scenario: { risk: 'high', forecast: (stats.predictions && stats.predictions.forecast) || null },
      plan: { recommendation: (stats.predictions && stats.predictions.recommendation) || null, savedEstimate: saved },
      outcome: { savedTokens: saved, providerCache: stats.providerCacheSaved, timeMs, effect: 1 },
      rule: distillRule((stats.predictions && stats.predictions.recommendation) || null),
    });
  }

  // ─── 历史快照 + 推送数据仓库 ───
  function pushHistory() {
    history.push({
      at: Date.now(),
      totalTokens: stats.totalTokens,
      todayTokens: stats.todayTokens,
      todaySpend: stats.todaySpend,
      sessionSpend: stats.sessionSpend,
      savedTokens: stats.savedTokens,
      savedMoney: stats.savedMoney,
      providerCacheSaved: stats.providerCacheSaved,
      planSavedTokens: stats.planSavedTokens,
      smartSavedTokens: stats.smartSavedTokens,
      smartSavedMoney: stats.smartSavedMoney,
      errorRate: stats.errorRate,
      risk: stats.risk,
      balance: stats.balance && stats.balance.total || 0,
    });
    if (history.length > HISTORY_CAP) history.shift();
  }

  async function ghGet(url, tok) {
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json', 'User-Agent': 'dsh' }, signal: AbortSignal.timeout(20000) });
    return res.ok ? await res.json() : null;
  }
  async function ghPut(url, content, tok, sha) {
    const body = { message: 'token stats update ' + new Date().toISOString(), content: Buffer.from(content, 'utf8').toString('base64') };
    if (sha) body.sha = sha;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json', 'User-Agent': 'dsh', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    return res.ok;
  }

  async function pushToRepo() {
    if (!creds) return;
    try {
      const r = await creds.resolve('GITHUB_TOKEN');
      const tok = r && r.value;
      if (!tok) return;
      const base = 'https://api.github.com/repos/' + DATA_REPO + '/contents/';
      const statsContent = JSON.stringify({ updatedAt: Date.now(), ...stats }, null, 2);
      let sha = null;
      const existing = await ghGet(base + 'stats.json', tok);
      if (existing && existing.sha) sha = existing.sha;
      await ghPut(base + 'stats.json', statsContent, tok, sha);
      // 增量追加：只推送自上次游标以来的新条目，避免全量覆盖丢远端历史
      if (historyPushed < history.length) {
        const delta = history.slice(historyPushed).map((h) => JSON.stringify(h)).join('\n');
        let hsha = null;
        let tail = '';
        const he = await ghGet(base + 'history.jsonl', tok);
        if (he && he.sha) hsha = he.sha;
        if (he && he.content && he.encoding === 'base64') tail = Buffer.from(he.content, 'base64').toString('utf8');
        const histContent = (tail ? tail.replace(/\s+$/, '') + '\n' : '') + delta + '\n';
        await ghPut(base + 'history.jsonl', histContent, tok, hsha);
        historyPushed = history.length;
      }
    } catch (e) { /* 推送失败静默；游标未推进，下次重试 */ }
  }

  // ─── 类比优化提醒：模型占 80%，管家仅"提醒"三点（更好方法/思路出错/已有能力未发现） ───
  function buildAnalogyReminders() {
    const parts = [];
    // 1) 思路可能出错
    if (stats.errorRate > 0.15) {
      parts.push('【思路提醒】近期错误率 ' + Math.round(stats.errorRate * 100) + '%，可能思路有偏或方法不适用。建议停下来重新审视当前做法，勿在错误路径上硬试。');
    }
    // 2) 更好更快的方法（本地案例库 / Vault 知识库）
    let rules = caseRules.slice(0, 2).map((r) => r.rule);
    if (!rules.length) rules = loadVaultDistilRules();
    if (rules.length) parts.push('【方法提醒】历史证明更优的做法：' + rules.join('；') + '。若当前做法与此不同，可考虑切换。');
    // 3) 已有能力/官方思路未被发现
    const skills = stats.skillCount ? '（已装 ' + stats.skillCount + ' 个 skill' + (stats.skillNames.length ? '：' + stats.skillNames.join('、') : '') + '）' : '';
    parts.push('【能力提醒】环境已具备可调用的 skill' + skills + ' 与多个工具（token_usage/token_cases_query/token_remind 等）。若当前任务与已有能力相关，请先调用既有 skill/工具与官方思路，勿手写或臆造；先检索是否已有更省事的现成方案。');
    return parts;
  }

  // ─── 成本预警：全自动优化 + 不盲目跑 ───
  if (systemPrompt && typeof systemPrompt.section === 'function') {
    systemPrompt.section({
      name: 'token-saver-cost-warning',
      order: -50,
      text: () => {
        if (stats.risk === 'high') {
          const rec = stats.predictions && stats.predictions.recommendation;
          return '⚠️【TOKEN Cat 成本预警】当前任务预计会消耗较多余额。请先收敛范围、减少冗长中间步骤，必要时先做检查点或停下来与用户确认，不要盲目继续。'
            + (rec ? ' 最优策略建议：' + rec : '');
        }
        if (stats.risk === 'medium') {
          return '⚠️【TOKEN Cat 成本提醒】当日花费已超过余额 30%，请留意成本。优先收敛任务范围、减少冗余中间步骤，若可预测高花费先与用户确认。';
        }
        return '';
      },
    });
  }

  // 类比优化提醒注入（每轮给模型"提醒"，不替模型决策）
  if (systemPrompt && typeof systemPrompt.section === 'function') {
    systemPrompt.section({
      name: 'token-saver-analogy-reminder',
      order: -40,
      text: () => buildAnalogyReminders().map((t) => '· ' + t).join('\n'),
    });
  }

  // ─── 周期任务 ───
  const refreshStats = () => {
    const taskDone = agentsRunning === 0; // 任务结束判定（全 agent 空闲）
    // 收集每个活跃会话(任务)的上下文进度 → 一个任务一根进度条
    const tasks = [];
    let session = null;
    let maxSurf = -1;
    let sessionTotal = 0;
    if (sessions && typeof sessions.list === 'function' && tm) {
      for (const s of sessions.list()) {
        try {
          const m = tm.measure(s);
          if (m) {
            const surf = m.surfaceTokens ?? 0;
            const base = taskBaselines.has(s.id) ? taskBaselines.get(s.id) : surf;
            const csurf = Math.max(0, surf - base);
            // 任务进度：结束=100%；进行中按步骤推进（软上限，避免停在个位数）
            const pct = taskDone
              ? 100
              : Math.min(88, Math.max(Math.round(csurf / stats.contextWindow * 100), 8 + taskSteps * 4));
            tasks.push({
              sessionId: s.id,
              surface: surf,
              contextSurface: csurf,
              contextUsagePct: pct,
              totalTokens: m.totalTokens ?? 0,
            });
            if (surf > maxSurf) { maxSurf = surf; session = s; sessionTotal = m.totalTokens ?? 0; }
          }
        } catch (e) { /* ignore */ }
      }
    }
    // 按活动度排序，最多展示 8 个任务
    tasks.sort((a, b) => b.contextSurface - a.contextSurface);
    stats.tasks = tasks.slice(0, 8);
    stats.taskCount = tasks.length;
    if (session) {
      const main = tasks.find((t) => t.sessionId === session.id) || tasks[0] || null;
      stats.totalTokens = sessionTotal;
      stats.surfaceTokens = main ? main.surface : maxSurf;
      stats.sessionTokens = sessionTotal;
      stats.sessionSpend = Math.round(sessionTotal / 1e6 * PRICE_PER_1M * 100) / 100;
      stats.contextSurface = main ? main.contextSurface : 0;
      stats.contextUsagePct = main ? main.contextUsagePct : 0;
      // 任务进度：任务结束(全 agent 空闲)=100%；进行中按步骤推进（软上限，避免停在个位数）
      stats.taskRunning = !taskDone;
      stats.taskSteps = taskSteps;
      stats.contextUsagePct = taskDone
        ? 100
        : Math.max(stats.contextUsagePct, Math.min(88, 8 + taskSteps * 4));
      try {
        const m = tm.measure(session);
        if (m) {
          stats.nodeCount = Array.isArray(m.nodes) ? m.nodes.length : 0;
          stats.logRevision = m.logRevision ?? 0;
        }
      } catch (e) { /* ignore */ }
      stats.updatedAt = Date.now();
    }
    void refreshBalance();
    refreshToday();
    computeErrorRate();
    maybeOptimize();
    stats.risk = heuristicRisk();
    // 正反馈收敛判定：曾给最优方案，如今风险非 high → 记功
    if (pendingPlan && stats.risk !== 'high') creditPlan();
    // 智能节省合计
    stats.smartSavedTokens = (stats.savedTokens || 0) + (stats.providerCacheSaved || 0) + (stats.planSavedTokens || 0);
    stats.smartSavedMoney = Math.round(stats.smartSavedTokens / 1e6 * PRICE_PER_1M * 100) / 100;
    stats.caseRules = caseRules;
    stats.caseCount = caseBase.length;
    if (stats.risk === 'high') void predictWithModel();
  };
  refreshStats();
  const timer = ctx.get('timer');
  if (timer && typeof timer.interval === 'function') {
    timer.interval(refreshStats, 2000);
    timer.interval(() => { pushHistory(); void pushToRepo(); }, PUSH_INTERVAL_MS);
  }

  // ─── 暴露给侧边栏小组件 ───
  if (connection && connection.rpc && typeof connection.rpc.handle === 'function') {
    try { connection.rpc.handle(
      '/dsh-token-widget',
      (_endpoint, _payload) => ({
        ...stats,
        enabled,
        balance: stats.balance,
        balanceUpdatedAt: stats.balanceUpdatedAt,
        todayTokens: stats.todayTokens,
        todaySpend: stats.todaySpend,
        sessionTokens: stats.sessionTokens,
        sessionSpend: stats.sessionSpend,
        contextUsagePct: stats.contextUsagePct,
        contextWindow: stats.contextWindow,
        balanceCap: stats.balanceCap,
        savedChars: stats.savedChars,
        savedTokens: stats.savedTokens,
        savedMoney: stats.savedMoney,
        errorRate: stats.errorRate,
        risk: stats.risk,
        predictions: stats.predictions,
        optimizationCount: stats.optimizationCount,
        lastOptimize: stats.lastOptimize,
        providerCacheSaved: stats.providerCacheSaved,
        planSavedTokens: stats.planSavedTokens,
        smartSavedTokens: stats.smartSavedTokens,
        smartSavedMoney: stats.smartSavedMoney,
        lastPlanSaved: stats.lastPlanSaved,
        caseRules: stats.caseRules,
        caseCount: stats.caseCount,
      }),
      { authority: 'loopback' },
    );
      } catch (e) { /* 通道注册失败不阻断启动 */ }
  }

  // ─── 本地案例库查询（类比优化数据源，第一性原理优先） ───
  if (connection && connection.rpc && typeof connection.rpc.handle === 'function') {
    try { connection.rpc.handle(
      '/dsh-token-cases',
      (_endpoint, payload) => queryCases(payload && payload.task, payload && payload.topK),
      { authority: 'loopback' },
    );
      } catch (e) { /* 通道注册失败不阻断启动 */ }
  }

  // ─── token_usage 工具 ───
  ctx.tools.register(defineTool({
    name: 'token_usage',
    description: '查看当前会话的 token 用量统计（总用量、上下文占用、开销最大的节点）、压缩节省、错误率、成本风险以及压缩是否开启。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_a, exec) {
      let session;
      if (exec && exec.agent && exec.agent.session) session = exec.agent.session;
      // 直接拿到 session 对象则用之；否则退回用 session.id 从 sessions 服务重新解析规范会话
      if (!session && sessions && exec && exec.agent && exec.agent.session && exec.agent.session.id) session = sessions.get(exec.agent.session.id);
      if (!session || !tm) return { available: false, message: '无法定位会话或 tokenMeter 未启用' };
      const m = tm.measure(session);
      const top = m.nodes.slice().sort((a, b) => b.tokens - a.tokens).slice(0, 10);
      return {
        available: true,
        enabled,
        totalTokens: m.totalTokens,
        surfaceTokens: m.surfaceTokens,
        logRevision: m.logRevision,
        nodeCount: m.nodes.length,
        contextUsagePct: stats.contextUsagePct,
        savedTokens: stats.savedTokens,
        savedMoney: stats.savedMoney,
        errorRate: stats.errorRate,
        risk: stats.risk,
        predictions: stats.predictions,
        smartSavedTokens: stats.smartSavedTokens,
        smartSavedMoney: stats.smartSavedMoney,
        providerCacheSaved: stats.providerCacheSaved,
        planSavedTokens: stats.planSavedTokens,
        caseRules: stats.caseRules,
        caseCount: stats.caseCount,
        topNodes: top.map((n) => ({ seq: n.seq, tokens: n.tokens })),
      };
    },
  }));

  // ─── token_cases_query 工具：类比优化数据源（第一性原理优先） ───
  ctx.tools.register(defineTool({
    name: 'token_cases_query',
    description: '查询本地正反馈案例库（top30% 高分案例 + 第一性原理规则）。给当前任务描述，返回最相似的历史案例与提炼规则，作为处理任务"正确选择"的类比优化依据。最高原则：先回到需求本质（第一性原理），再以案例为证据。',
    parameters: { task: { type: 'string' }, topK: { type: 'number' } },
    output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    async execute(args) { return queryCases(args && args.task, args && args.topK); },
  }));

  // ─── token_remind 工具：类比优化提醒（模型决策前自查） ───
  ctx.tools.register(defineTool({
    name: 'token_remind',
    description: '返回 token 管家的"类比优化提醒"：①思路是否出错 ②是否有更好更快的方法 ③是否已有相似功能/官方思路未被发现。模型在决策/动手前可调用自查；管家只提醒、不替模型决策（模型权重 80%）。',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    async execute() { return { modelWeight: '0.8', reminders: buildAnalogyReminders() }; },
  }));
}

export { name, inject, apply };
