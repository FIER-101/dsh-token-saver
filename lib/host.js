// Token 管家（TOKEN Cat）—— 标准 Cordis 插件（Host 半区，持久化版）
// 功能：
//  - 工具输出智能压缩（head/middle/tail）＋ 压缩节省统计（字符/token/¥）
//  - 错误率追踪：压缩后报错/同工具重试在滚动窗口内统计；飙升则自动优化压缩算法
//  - 用量统计：余额（官方 /user/balance）、当日花费（官方余额差值）、本次花费、当前任务进程
//  - 启发式预测：高花费风险触发模型确认 → 全自动给出最优策略 + 成本预警
//  - 实时推送统计/历史到专用数据仓库（FIER-101/dsh-token-data）
//  - 侧边栏小组件 RPC（/dsh-token-widget）
import { defineTool } from '@deepseek-ai/dsh-tools';

const name = 'dsh-token-saver';
const inject = ['tools', 'tokenMeter', 'sessions', 'connection', 'credentials', 'systemPrompt'];

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
    contextWindow: 131072,
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
  };

  // 自然日基线 / 余额缓存 / 当日余额起点
  let dayKey = localDayKey();
  let baselineTokens = null;
  let dayStartBalance = null;
  let balanceCache = { at: 0 };

  // 历史快照（内存 + 推送）
  const history = [];

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
  }

  async function refreshBalance() {
    if (!creds) { stats.balance = { available: false, total: 0, currency: '' }; return; }
    if (Date.now() - balanceCache.at < 60000) return; // 用缓存（stats.balance 已最新）
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
      balanceCache = { at: Date.now() };
    } catch (e) { /* 失败保留旧值 */ }
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

  // 错误归因 A：工具结果报错且 30s 内有压缩 → 压缩相关错误
  ctx.on('tools/result', (_exec, result) => {
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

  function computeErrorRate() {
    if (compressEvents.length < MIN_COMPRESSIONS) { stats.errorRate = 0; return; }
    const err = compressEvents.filter((e) => e.errored).length;
    stats.errorRate = Math.round(err / compressEvents.length * 100) / 100;
  }

  // 错误率飙升 → 自动优化压缩算法（全自动）
  function maybeOptimize() {
    if (compressEvents.length < MIN_COMPRESSIONS || stats.optimizationCount >= MAX_OPTIMIZATIONS) return;
    if (stats.errorRate > ERROR_RATE_THRESHOLD) {
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
            { role: 'system', content: '你是 DSH Token 管家的成本预测助手。基于用户提供的会话用量与历史，判断当前任务是否可能高花费，并给出最省钱的最优策略。只返回 JSON：{"high_spend": 布尔, "forecast": "剩余花费估计说明", "recommendation": "一句话最优策略"}' },
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
      stats.predictions = {
        at: Date.now(),
        high_spend: !!(parsed && parsed.high_spend),
        forecast: (parsed && parsed.forecast) || null,
        recommendation: (parsed && parsed.recommendation) || null,
      };
    } catch (e) { /* 预测失败不影响主流程 */ }
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
      const histContent = history.map((h) => JSON.stringify(h)).join('\n') + '\n';
      let hsha = null;
      const he = await ghGet(base + 'history.jsonl', tok);
      if (he && he.sha) hsha = he.sha;
      await ghPut(base + 'history.jsonl', histContent, tok, hsha);
    } catch (e) { /* 推送失败静默 */ }
  }

  // ─── 成本预警：全自动优化 + 不盲目跑 ───
  if (systemPrompt && typeof systemPrompt.section === 'function') {
    systemPrompt.section({
      name: 'token-saver-cost-warning',
      order: -50,
      text: () => {
        if (stats.risk !== 'high') return '';
        const rec = stats.predictions && stats.predictions.recommendation;
        return '⚠️【TOKEN Cat 成本预警】当前任务预计会消耗较多余额。请先收敛范围、减少冗长中间步骤，必要时先做检查点或停下来与用户确认，不要盲目继续。'
          + (rec ? ' 最优策略建议：' + rec : '');
      },
    });
  }

  // ─── 周期任务 ───
  const refreshStats = () => {
    // 选"最活跃"会话（上下文占用最高者）作为当前任务进程的依据
    let session = null;
    let maxSurf = -1;
    let sessionTotal = 0;
    if (sessions && typeof sessions.list === 'function' && tm) {
      for (const s of sessions.list()) {
        try {
          const m = tm.measure(s);
          if (m) {
            const surf = m.surfaceTokens ?? 0;
            if (surf > maxSurf) { maxSurf = surf; session = s; sessionTotal = m.totalTokens ?? 0; }
          }
        } catch (e) { /* ignore */ }
      }
    }
    if (session) {
      stats.totalTokens = sessionTotal;
      stats.surfaceTokens = maxSurf;
      stats.sessionTokens = sessionTotal;
      stats.sessionSpend = Math.round(sessionTotal / 1e6 * PRICE_PER_1M * 100) / 100;
      stats.contextUsagePct = Math.min(100, Math.round(maxSurf / stats.contextWindow * 100));
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
    connection.rpc.handle(
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
      }),
      { authority: 'loopback' },
    );
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
      if (!session && sessions && exec && exec.agent && exec.agent.session) session = sessions.get(exec.agent.session.id);
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
        topNodes: top.map((n) => ({ seq: n.seq, tokens: n.tokens })),
      };
    },
  }));
}

export { name, inject, apply };
