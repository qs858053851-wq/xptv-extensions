# XPTV 个人专属增强扩展与订阅源

本项目用于托管个人的 **XPTV**（iOS / iPadOS / macOS / Apple TV）专属视频解析扩展与一键订阅源。

---

## 📺 已支持站点

### 1. Jable TV（增强版 Spider JS）
- **特点**：
  - 💡 顶部常驻 **「最新更新」**、**「熱門排行」**、**「新作上映」** 三大主分类。
  - 📚 动态同步各大精选主题标签与分类。
  - 🔍 支持全站番號（如 `START-602`, `SSIS-123`）与关键词搜索。
  - ⚡ 直连提取原画 1080P/4K HLS (`.m3u8`) 视频流，硬件解码秒开秒播。
  - 🛡️ 自动附带 `Referer: https://jable.tv/` 防盗链请求头。

---

## 🚀 导入使用方式

### 方式 A：单源导入（推荐）
在 XPTV 中依次点击：**「设置」** -> **「扩展」** / **「源管理」** -> 右上角 **`+` (添加源)**：
- **类型**：选择 `JS 扩展`（或 `VOD` / `Spider`）
- **名称**：`Jable TV`
- **标识 (API)**：`csp_jable`
- **扩展链接 (Ext)**：
  ```text
  https://ghp.xptvhelper.link/https://raw.githubusercontent.com/qs858053851-wq/xptv-extensions/main/js/jable.js
  ```

---

### 方式 B：一键订阅链接（支持后续多源自动聚合）
在 XPTV **「订阅管理」** 中点击添加订阅，填入以下链接：
```text
https://ghp.xptvhelper.link/https://raw.githubusercontent.com/qs858053851-wq/xptv-extensions/main/xptv.json
```
*(海外网络或直连用户亦可直接去掉 `https://ghp.xptvhelper.link/` 前缀)*

---

## ⚠️ 注意事项
- **首次 Cloudflare 验证**：Jable 启用了 Cloudflare 保护。如果初次加载提示 `Just a moment...`，XPTV 会调起 Safari 验证一次，完成后凭据会自动共享给 XPTV。
- **播放网络**：建议配合代理使用，确保切片解析顺畅。
