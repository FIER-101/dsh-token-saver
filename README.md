<div align="center">

# DSH Token 管家（TOKEN Cat）

**为 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai) 量身定做的 token 管家：省 token、控成本、会"提醒"而非"替你做决定"**

一个把「压缩省 token」与「类比优化数据源」深度结合的 Cordis 插件（profile bundle，Host 半区）。它不抢模型的判断权，而是用一套可沉淀的正反馈机制，在关键处给模型**提醒**，让每一分 token 都花得有价值。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Plugin: Cordis](https://img.shields.io/badge/Cordis-Profile%20Bundle-4a90d9)](#)
[![Language: JavaScript](https://img.shields.io/badge/JS-ES2020-f1e05a?logo=javascript&logoColor=000)](#)

</div>

---

## 🧠 设计思路（Design Philosophy）

> **「模型占 80%，管家只提醒，永远不做决策。」**

这套插件最核心的定位不是"替模型省事"，而是**只提供提醒与数据，把决策权还给模型**。它围绕三条主线展开：

### 1. 省 token 的三条腿（智能节省 `smartSaved`）

```
smartSavedTokens = 工具输出压缩节省 + 缓存命中真实节省 + 最优方案预计节省
```

| 来源 | 含义 |
| --- | --- |
| **工具输出压缩** | 超长工具结果 head/middle/tail 压缩，且带**错误率自优化**（压缩后报错/同工具重试会触发算法自动调整） |
| **缓存命中真实节省** | 读取 `sessionProjections` 的 `tokenUsage` 投影（**与对话框底部同一数据源**），把 provider 的 `cacheReadTokens` 记为真实省下的 token |
| **最优方案预计节省** | 见下方「正反馈数字化机制」 |

### 2. 正反馈数字化机制（系统↔用户正确选择）

管家**主动探求最优解**：成本风险高时，调用预测模型给出「最优方案 + 预计能省多少」（`saved_tokens_estimate`）。当模型/用户**正确选择**、让高风险任务收敛后，管家就把这预计节省**记功**累计进 `planSavedTokens`。

> 这是一套**正反馈的数字化表达**：系统越早给出好方案、用户越早做对选择，账面上「省下的 token」就越清晰可见，形成正向循环。

### 3. 类比优化数据源（本地案例库小模型 + 第一性原理）

每次正反馈记功都会沉淀成一条**案例**（场景 / 最优方案 / 结果 / 耗时 / 效果）。用

```
score = 节省 × 效果 / 耗时
```

只保留 **top 30% 高分案例**，并从方案里提炼**「第一性原理」规则**（拆小步 / 先检查点 / 收敛范围 / 复用缓存等底层原因，而非表面模板），落到本地数据库。查询时按当前任务**类比检索**，返回最相似的案例与规则。

### 4. 三点提醒（只提醒，不决策）

管家通过 `systemPrompt.section` **每轮注入**最多三类提醒——这是它「提醒」的落点，决策权重始终在模型（80%）：

| 提醒 | 触发依据 |
| --- | --- |
| **① 思路是否出错** | 错误率 > 15%（近期压缩后报错/重试偏高），提醒"勿在错误路径上硬试" |
| **② 是否有更好更快的方法** | 本地案例库 + Vault 蒸馏出的历史最优做法 |
| **③ 是否已有相似功能/官方思路未发现** | 实时扫描已装 skill 目录 + 工具列表，提醒"先调用既有能力，勿手写臆造" |

> 第 ③ 点尤其关键：很多浪费源于模型不知道环境里**已经有现成的 skill / 工具 / 官方思路**。

---

## ✨ 特性总览

- **工具输出智能压缩**（可开关 + 排除名单 + 错误率自优化）
- **用量统计**：总 token / 上下文占用 / 开销最高节点 / 当日花费（官方余额差值） / 余额
- **成本预警与预测**：高花费风险触发模型确认，给出最优策略 + 成本预警注入
- **智能节省正反馈**：压缩 + 缓存命中 + 最优方案预计，统一记账
- **本地案例库小模型**：top30% 高分案例 + 第一性原理规则，类比检索
- **类比优化提醒**：三点机制，深度接入本地数据库
- **实时推送**：统计与历史推送到专用数据仓库（`FIER-101/dsh-token-data`）
- **侧边栏小组件** RPC：`/dsh-token-widget`、`/dsh-token-cases/query`

## 🛠 工具

| 工具名 | 说明 |
| --- | --- |
| `token_usage` | 当前会话 token 用量统计（含智能节省、错误率、风险） |
| `token_cases_query` | 查询本地案例库（top30% 高分案例 + 第一性原理规则），类比检索 |
| `token_remind` | 返回三点「类比优化提醒」，模型决策前可自查（`modelWeight: 0.8`） |

## 🗂 数据位置

```
$DSH_HOME/data/token-cases.jsonl      # 本地案例库（top30% 高分案例）
$DSH_HOME/data/dsh-vault/vault.json   # 与 Vault 插件共享的蒸馏/设计知识库
```

## 📥 安装（Install）

一键部署（profile bundle，符合 DSH 设计）：

```bash
dsh plugin --profile web add @dsh-plugins/token-saver
# 重启 dsh 生效
```

安装后出现在 **设置 → 插件** 列表，所有会话永久可用。也支持本地开发安装：`dsh plugin --profile web add <本仓库路径>`。

## 🧩 配套生态

- [dsh-vault](https://github.com/FIER-101/dsh-vault) — 可移植知识库：为 token 管家提供蒸馏/设计数据源，并支持一键迁移环境。
- [dsh-github-integration](https://github.com/FIER-101/dsh-github-integration) — GitHub 集成。

## 🗂 结构

```
.
├── lib/host.js              # 标准 Cordis Host 插件（实际加载）
├── src/standard-host.js     # 简化参考版本
├── README.md
├── CHANGELOG.md
└── LICENSE                  # MIT
```

## 📄 许可证

[MIT](LICENSE) © [FIER-101](https://github.com/FIER-101)
