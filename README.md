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

## 📥 安装

持久化安装（标准 Cordis 插件）：
1. 将 `src/standard-host.js` 放入你的 agent preset 的 `plugins/` 目录。
2. 在 `agent.cordis.yml` 加一行：
   ```yaml
   - id: token-saver
     name: './plugins/token-saver.js'
   ```
3. 确保 preset 的 `node_modules/@deepseek-ai` 可解析 `@deepseek-ai/dsh-tools`（可将预设目录下建 junction 指向 DSH 的 node_modules）。

## 🛠 工具

| 工具名 | 说明 |
| --- | --- |
| `token_usage` | 查看当前会话 token 用量统计与压缩开关状态 |

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
