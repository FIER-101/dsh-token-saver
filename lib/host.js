// Token 管家 —— 标准 Cordis 插件（Host 半区，持久化版）
// 由动态插件改写而来：
//  - 命名导出 { name, inject, apply }
//  - ctx.on('tools/post-execute') 对超长文本工具结果做 head/middle/tail 压缩
//  - ctx.tools.register(defineTool(...)) 注册 token_usage 工具
// 注意：这是进程内状态插件，Client 卡片（设置页/引导卡片）不在此文件。
import { defineTool } from '@deepseek-ai/dsh-tools';

const name = 'dsh-token-saver';
const inject = ['tools', 'tokenMeter', 'sessions'];

async function apply(ctx) {
  const tm = ctx.get('tokenMeter');
  const sessions = ctx.get('sessions');

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

  // 开关 RPC（供对话区卡片调用；标准插件下通过 registry 事件提供，或由模型工具切换）
  ctx.on('internal/config', (_config, next) => next());

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
