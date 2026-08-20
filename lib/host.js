// Token 管家 —— 标准 Cordis 插件（Host 半区，持久化版）
// 由动态插件改写而来：
//  - 命名导出 { name, inject, apply }
//  - ctx.on('tools/post-execute') 对超长文本工具结果做 head/middle/tail 压缩
//  - ctx.tools.register(defineTool(...)) 注册 token_usage 工具
//  - ctx.connection.rpc.handle('/dsh-token-widget') 暴露实时统计，
//    供侧边栏 client 小组件轮询（浏览器端直接 fetch）。
import { defineTool } from '@deepseek-ai/dsh-tools';

const name = 'dsh-token-saver';
const inject = ['tools', 'tokenMeter', 'sessions', 'connection', 'credentials'];

async function apply(ctx) {
  const tm = ctx.get('tokenMeter');
  const sessions = ctx.get('sessions');
  const connection = ctx.get('connection');
  const creds = ctx.get('credentials');

  // 压缩开关（内存态）
  let enabled = true;
  // 排除名单：这些工具的结果通常需要完整查看（源码、诊断、文件内容），跳过压缩。
  const EXCLUDE = new Set([
    'read', 'write', 'edit', 'glob', 'grep',
    'cordis_inspect_self', 'cordis_inspect_query', 'cordis_inspect_list',
    'github_read_file', 'token_usage',
  ]);

  const TEXT_LIMIT = 8000;
  const HEAD_RATIO = 0.4;
  const TAIL_RATIO = 0.25;

  // 实时统计（供侧边栏小组件读取）
  const stats = {
    enabled,
    totalTokens: 0,
    surfaceTokens: 0,
    nodeCount: 0,
    logRevision: 0,
    compressedCount: 0,
    lastCompression: null, // { at, tool, original, kept, skipped }
    updatedAt: 0,
    // —— 分区 UI 新增 ——
    balance: { available: false, total: 0, currency: '' }, // DeepSeek 账号余额
    todayTokens: 0,      // 今日已消耗 token（估算）
    todaySpend: 0,       // 今日花费 ¥（估算）
    contextUsagePct: 0,  // 当前会话上下文占用百分比
    contextWindow: 131072, // 模型上下文窗口(token)，任务进度条上限
    balanceCap: 100,     // 余额进度条可视化上限(¥)
  };

  // —— 分区 UI 需要的常量 / 状态 ——
  // 估算单价：¥ / 百万 token（deepseek 混合价，仅估算；可自行调整）
  const PRICE_PER_1M = 2;
  let dayKey = localDayKey();     // 当前自然日
  let baselineTokens = null;      // 当日起点累计 token
  let balanceCache = { at: 0 };   // 余额接口 TTL 缓存

  function localDayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  // 所有在线会话的累计 token 总数（当日花费的分子）
  function totalTokensAllSessions() {
    if (!tm || !sessions || typeof sessions.list !== 'function') return 0;
    let sum = 0;
    for (const s of sessions.list()) {
      try { const m = tm.measure(s); if (m) sum += (m.totalTokens ?? 0); } catch (e) { /* 单个会话失败忽略 */ }
    }
    return sum;
  }

  // 刷新当日 token / 花费（跨自然日重置基线）
  function refreshToday() {
    const now = localDayKey();
    if (dayKey !== now) { dayKey = now; baselineTokens = null; }
    const total = totalTokensAllSessions();
    if (baselineTokens === null) baselineTokens = total;
    stats.todayTokens = Math.max(0, total - baselineTokens);
    stats.todaySpend = Math.round(stats.todayTokens / 1e6 * PRICE_PER_1M * 100) / 100;
  }

  // 刷新 DeepSeek 账号余额（TTL 60s，失败保留旧值并置不可用）
  async function refreshBalance() {
    stats.balance = { available: false, total: 0, currency: '' };
    if (!creds) return;
    if (Date.now() - balanceCache.at < 60000 && balanceCache.data) {
      stats.balance = balanceCache.data;
      return;
    }
    try {
      const r = await creds.resolve('DEEPSEEK_API_KEY');
      const key = r && r.value;
      if (!key) return;
      const res = await fetch('https://api.deepseek.com/user/balance', {
        headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return;
      const data = await res.json();
      const info = (data && Array.isArray(data.balance_infos) && data.balance_infos[0]) || null;
      const bal = info ? {
        available: data.is_available !== false,
        total: Number(info.total_balance) || 0,
        currency: info.currency || 'CNY',
      } : { available: false, total: 0, currency: '' };
      balanceCache = { at: Date.now(), data: bal };
      stats.balance = bal;
    } catch (e) { /* 余额获取失败：保留不可用状态 */ }
  }

  // 工具输出智能压缩（waterfall）
  ctx.on('tools/post-execute', (exec, result, next) => {
    try {
      if (enabled && exec && !EXCLUDE.has(exec.name)
          && result && result.isError === false && Array.isArray(result.content)) {
        let total = 0;
        let hasText = false;
        for (const b of result.content) {
          if (b && b.type === 'text' && typeof b.text === 'string') {
            total += b.text.length;
            hasText = true;
          }
        }
        if (hasText && total > TEXT_LIMIT) {
          const pruned = result.content.map((b) => {
            if (b && b.type === 'text' && typeof b.text === 'string' && b.text.length > TEXT_LIMIT) {
              const t = b.text;
              const headLen = Math.floor(t.length * HEAD_RATIO);
              const tailLen = Math.floor(t.length * TAIL_RATIO);
              const kept = headLen + tailLen;
              const placeholder = '\n\n[已智能压缩：' + t.length + ' 字符 → 保留 ' + kept + ' 字符，省略中间 ' + (t.length - kept) + ' 字符]\n\n';
              stats.compressedCount += 1;
              stats.lastCompression = {
                at: Date.now(),
                tool: exec.name,
                original: t.length,
                kept,
                skipped: t.length - kept,
              };
              return { ...b, text: t.slice(0, headLen) + placeholder + t.slice(t.length - tailLen) };
            }
            return b;
          });
          return Promise.resolve({ kind: 'accept', content: pruned });
        }
      }
    } catch (e) { /* 压缩失败时原样放行 */ }
    return next();
  });

  // 定期刷新 token 用量到 stats（供小组件轮询），失败则保留旧值
  // 用 ctx.timer 而非全局 setInterval：定时器随插件 fiber 自动清理
  const refreshStats = () => {
    if (!tm) return;
    try {
      let session;
      if (sessions && typeof sessions.list === 'function') {
        const all = sessions.list();
        if (all && all.length > 0) session = all[all.length - 1];
      }
      if (!session) return;
      const m = tm.measure(session);
      if (m) {
        stats.totalTokens = m.totalTokens ?? 0;
        stats.surfaceTokens = m.surfaceTokens ?? 0;
        stats.nodeCount = Array.isArray(m.nodes) ? m.nodes.length : 0;
        stats.logRevision = m.logRevision ?? 0;
        stats.contextUsagePct = Math.min(100, Math.round((m.surfaceTokens ?? 0) / stats.contextWindow * 100));
        stats.updatedAt = Date.now();
      }
    } catch (e) { /* 测量失败保持旧值 */ }
    refreshToday();
    void refreshBalance();
  };
  refreshStats();
  const timer = ctx.get('timer');
  if (timer && typeof timer.interval === 'function') timer.interval(refreshStats, 2000);

  // 暴露实时统计给侧边栏 client 小组件
  if (connection && connection.rpc && typeof connection.rpc.handle === 'function') {
    connection.rpc.handle(
      '/dsh-token-widget',
      (_endpoint, _payload) => ({
        ...stats,
        enabled,
        balance: stats.balance,
        todayTokens: stats.todayTokens,
        todaySpend: stats.todaySpend,
        contextUsagePct: stats.contextUsagePct,
        contextWindow: stats.contextWindow,
        balanceCap: stats.balanceCap,
      }),
      { authority: 'loopback' },
    );
  }

  // token_usage 工具
  ctx.tools.register(defineTool({
    name: 'token_usage',
    description: '查看当前会话的 token 用量统计（总用量、上下文占用、开销最大的节点）以及压缩是否开启。',
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
        topNodes: top.map((n) => ({ seq: n.seq, tokens: n.tokens })),
      };
    },
  }));
}

export { name, inject, apply };
