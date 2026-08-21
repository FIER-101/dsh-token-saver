# 更新日志

## [v1.0.1]

- 修复：模块顶层 `dshHome` 在声明前被引用（TDZ：Cannot access 'dshHome' before initialization），导致插件加载失败、`dsh web` 无法启动。将 `const dshHome = ...` 上移到首次使用（`HISTORY_FILE`）之前。

## [v1.0.0]

- 工具输出智能压缩（>8000 字符 head/middle/tail）。
- 源码/诊断类工具排除名单。
- `token_usage` 工具查询会话 token 用量。
- 标准 Cordis Host 插件（可持久化安装）。
