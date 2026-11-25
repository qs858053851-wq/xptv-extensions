# XPTV 个人专属增强扩展与订阅源

本项目用于托管个人的 **XPTV**（iOS / iPadOS / macOS / Apple TV）专属视频解析扩展与一键订阅源。

---

## 📺 已支持站点

### 1. Jable TV（增强版 Spider JS）
- 💡 顶部常驻 **「最新更新」**、**「熱門排行」**、**「新作上映」** 三大主分类。
- 📚 动态同步各大精选主题标签与分类。
- 🔍 支持全站番號（如 `START-602`, `SSIS-123`）与关键词搜索。
- ⚡ 直连提取原画 1080P/4K HLS (`.m3u8`) 视频流。
- 🛡️ 自动附带 `Referer: https://jable.tv/` 防盗链请求头。

### 2. 黄果短剧（增强版 Spider JS）`v3.0.0`
- 🗂 首页 / AI成人短剧 / AI成人漫剧 / AI换脸 / AI魔改 / 排行榜 六个分类页，均支持翻页。
- 🔍 关键词搜索、剧集列表、`.m3u8` 播放地址直取。
- 🆕 **v3.0.0 适配 2026-11 站点改版**：
  - 详情页 `/detail/{id}/` → `/video/{id}/`（旧路径 410）。
  - 播放改为 `POST /api/videos/{id}/episodes/{ep}/playback`，取 `data.streams.main`；旧版 `videoInitialData.epPlaySrcs` 已变成空对象。
  - 列表/详情/搜索优先走站点 JSON API，HTML 解析只做兜底。
  - 剧集按钮改为解析 `a.hg-web-play__ep[data-ep-id]`。
- 🐛 **历史修复**：

| 问题 | 根因 | 处理 |
| --- | --- | --- |
| 主页整片乱码 | 站点在客户端声明 `Accept-Encoding: br` 时返回 Brotli，XPTV 的 `$fetch` 不解 br | 请求头强制 `Accept-Encoding: identity`，服务端直接返回明文 UTF-8 |
| 封面显示不出来 | 封面是 AES-128-CBC 加密字节，XPTV 端无解密能力 | 走外部解密代理（见下方 Worker），详见 `worker/huangguo-img.js` |
| 排行榜翻页 404 | 脚本会拼出 `/ranks/hot/2/`，站点实测返回 404 | 排行榜固定单页，不再翻页 |
| `vod_remarks` 漏 HTML | 站点在集数里嵌了 `<i class="hg-ep-time__at">` | 统一 `stripTags` |

### 3. 红果短剧（增强版 Spider JS）`v1.0.0`
- 🗂 首页 / 全部短剧 / 热播榜 / 新剧榜 / 古装 / 喜剧 六个分类页。
- 🔍 关键词搜索、剧集列表、播放页 `player_aaaa` 直取 `.m3u8`。
- 🌐 使用红果短剧网页聚合站 `https://www.hongguoapp.cn/`（苹果 CMS / conch 模板），不走需要 `X-Argus / X-Gorgon` 签名的官方 App 接口。
- 💡 如播放页提示「请使用中国大陆网络访问」，把 `hongguoapp.cn`、`fengbao8.com`、`bfllvip.com` 等域名设为直连或使用大陆出口。

---

## 🚀 导入使用方式

### 方式 A：一键订阅链接（推荐）

在 XPTV **「订阅管理」** 中点击添加订阅，填入：

```text
https://ghp.xptvhelper.link/https://raw.githubusercontent.com/qs858053851-wq/xptv-extensions/main/xptv.json
```

*(海外网络或直连用户可去掉 `https://ghp.xptvhelper.link/` 前缀)*

### 方式 B：单源导入

在 XPTV 中依次点击：**「设置」** → **「扩展」** / **「源管理」** → 右上角 **`+`（添加源）**，类型选 `JS 扩展`：

| 站点 | 名称 | 标识 (API) | 扩展链接 (Ext) |
| --- | --- | --- | --- |
| Jable TV | `Jable TV` | `csp_jable` | `.../main/js/jable.js` |
| 黄果短剧 | `黄果短剧` | `csp_huangguo` | `.../main/js/huangguo.js?v=3.0.0` |
| 红果短剧 | `红果短剧` | `csp_hongguo` | `.../main/js/hongguo.js?v=1.0.0` |

完整链接（把 `js/xxx.js` 拼在下面这个前缀后面）：

```text
https://ghp.xptvhelper.link/https://raw.githubusercontent.com/qs858053851-wq/xptv-extensions/main/js/
```

---

## 🖼 黄果封面解密 Worker（必做，否则封面是花图）

密文本体（站点 `pic.tuafjz.cn`）用 AES-128-CBC 加密：

```text
key = "f5d965df75336270"    iv = "97b60394abc2fbe1"
```

> ⚠️ 这两个值是 **16 个字符本身的 ASCII 字节（16 bytes）**，不是 hex 解码。
> hex 解码只有 8 bytes，AES-128 会直接报 `Invalid key length`。

### 部署

> ✅ **已经部署好了**，不用再动：
> `https://huangguo-img.qs858053851.workers.dev/?u=`
> 已写进 `js/huangguo.js` 顶部的 `IMG_PROXY`，实测返回 `image/jpeg` / `image/png`。

```bash
# 方式一：CLI
npx wrangler deploy worker/huangguo-img.js --name huangguo-img

# 方式二：Cloudflare Dashboard → Workers & Pages → 创建 Worker → 粘贴 worker/huangguo-img.js → 部署
```

部署后访问 `https://<你的域名>/?u=<encodeURIComponent(图片地址)>`，返回 `image/png` / `image/jpeg` 即成功。

### 接线

把地址填进 `js/huangguo.js` 顶部的 `IMG_PROXY`，例如：

```js
const IMG_PROXY = 'https://huangguo-img.<你的子域>.workers.dev/?u='
```

留空 `IMG_PROXY` 时脚本会回退到「剥掉 `auth_key` 的原始直链」——链接稳定，但封面仍是加密花图。

Worker 已内置：只放行 `pic.tuafjz.cn` / `huangguoai.com` 图床、`caches.default` 边缘缓存 24h、CORS `*`、
未加密的静态图原样放行（靠 magic bytes 判断，不误伤）。

---

## ⚠️ 注意事项

- **首次 Cloudflare 验证**：Jable 启用了 Cloudflare 保护。如果初次加载提示 `Just a moment...`，XPTV 会调起 Safari 验证一次，完成后凭据会自动共享给 XPTV。
- **XPTV 强缓存**：改完脚本后光刷新没用，XPTV 对已加载的列表、卡片、封面缓存很顽固。更新源时的标准动作：
  1. 改完发版时把 `xptv.json` 里的 `?v=` 号 +1（`?v=3.0.0`），URL 变了 XPTV 才会重新拉取；
  2. 或在 XPTV 里删掉该源重新添加；
  3. 实在没反应就杀掉 XPTV 进程重开。
- **播放网络**：`.m3u8` 的 `auth_key` 是**带时间戳的**（形如 `1790003482-...`），会过期。播放地址是播放时实时解析的，属正常。
- 封面原图偏大（PNG 可达 2.7 MB），Worker 侧有 24h 边缘缓存，第二次起秒开。

---

## 📁 目录

```text
xptv-extensions/
├── xptv.json                  # 订阅源清单（Jable + 黄果 + 红果）
├── js/
│   ├── jable.js               # Jable TV 扩展
│   ├── huangguo.js            # 黄果短剧扩展 v3.0.0
│   └── hongguo.js             # 红果短剧扩展 v1.0.0
└── worker/
    └── huangguo-img.js        # 黄果封面 AES 解密代理（Cloudflare Worker）
```
