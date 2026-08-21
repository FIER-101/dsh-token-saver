<div align="center">

# DSH Token 管家

**为 DeepSeek Harness 节省 token：工具输出智能压缩 + 用量监控**

在 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai) 会话中，对超长工具结果做智能压缩，并提供当前会话的 token 用量统计，帮助控制上下文开销。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Plugin: Cordis](https://img.shields.io/badge/Cordis-Dynamic%20Plugin-4a90d9)](#)
[![Language: JavaScript](https://img.shields.io/badge/JS-ES2020-f1e05a?logo=javascript&logoColor=000)](#)

</div>

---

## ✨ 特性

- **工具输出智能压缩**：工具结果超过 8000 字符时自动 head/middle/tail 压缩，大幅减少每次请求的 token。
- **排除名单**：`read`、`cordis_inspect_self` 等需要完整查看源码/诊断的工具**不被压缩**。
- **用量监控**：`token_usage` 工具查看当前会话总 token、上下文占用、开销最高节点。
- **可开关**：压缩可在对话中开启/关闭。

## 📥 安装（Install）

一键部署（profile bundle，符合 DSH 设计）：

```bash
# 1. 先确保 pnpm 可用（corepack enable / 或安装 pnpm）
# 2. 一键安装到你的 DSH profile（默认 web）：
dsh plugin --profile web add @dsh-plugins/token-saver

# 3. 重启 dsh 生效
```

安装后出现在 **设置 → 插件** 列表，所有会话永久可用。也支持本地开发安装：`dsh plugin --profile web add <本仓库路径>`。

## 🛠 工具

| 工具名 | 说明 |
| --- | --- |
| `token_usage` | 查看当前会话 token 用量统计与压缩开关状态 |
| `token_switch` | 开启 / 关闭工具输出智能压缩（传 `enabled: true/false`） |
| `token_cases_query` | 查询本地正反馈案例库（top30% 高分案例 + 第一性原理规则） |
| `token_remind` | 类比优化提醒：思路是否出错 / 更好方法 / 已有能力未发现 |

## 🔒 数据与隐私

- **本地持久化**：每日基线 `data/token-saver-state.json`、正反馈案例 `data/token-cases.jsonl`、用量历史 `data/token-saver-history.jsonl`（本地副本）。
- **远端推送默认关闭**：只有显式设置环境变量 `TOKEN_SAVER_PUSH_REMOTE=on` 才把统计/历史推送到数据仓库（默认不推送任何数据）。

## 🗂 结构

```
.
├── src/
│   └── standard-host.js   # 标准 Cordis Host 插件
├── README.md
├── CHANGELOG.md
└── LICENSE                # MIT
```

## 📄 许可证

[MIT](LICENSE) © [FIER-101](https://github.com/FIER-101)
