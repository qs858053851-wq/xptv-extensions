// ============================================================================
//  黄果短剧  huangguoai.com   ——   XPTV 专属增强版源
//  version: 2.0.1
// ============================================================================
//
//  【一、主页乱码修复】
//    站点在客户端声明 Accept-Encoding: br 时返回 Brotli 压缩流，
//    而 XPTV 的 $fetch 不解 Brotli → 首页整片乱码。
//    实测：Accept-Encoding: br     → content-encoding: br    (37630 B 乱码)
//          Accept-Encoding: gzip   → content-encoding: gzip
//          Accept-Encoding: identity → 明文 UTF-8           (151482 B 正常)
//    因此 HEADERS 里强制 identity，从根上不要压缩体。
//
//  【二、封面图解密】
//    站点封面图是 AES-128-CBC 加密字节，key/iv 取自站点前端 crypto-worker.js：
//      key = "f5d965df75336270"   iv = "97b60394abc2fbe1"
//      注意是这 16 个字符本身的 ASCII 字节（16 bytes），不是 hex 解码
//      （hex 解码只有 8 bytes，AES-128 会报 Invalid key length；
//        初版注释里的 CryptoJS.enc.Hex.parse 写法是错的，别照抄）
//    解密后为 PNG / JPEG 明文（实测 4 张封面，PKCS7 padding 均合法）：
//      PNG 89 50 4e 47… / JPEG ff d8 ff db… / 静态图未加密则原样放行
//    XPTV 端拿不到解密能力，所以图片走外部解密代理：
//      → worker/huangguo-img.js  （Cloudflare Worker，部署后把地址填到下面 IMG_PROXY）
//    留空 IMG_PROXY 时回退「剥掉 auth_key 的原始直链」——链接稳定但封面仍是花图。
//
//  【三、其他修正 vs 初版】
//    * vod_remarks 之前会把 <i class="hg-ep-time__at">10小时前</i> 原样吐给 XPTV，
//      现在统一 stripTags。
//    * 排行榜原来会拼出 /ranks/hot/2/ → 站点 404（实测），现在排行榜固定单页。
//    * 剧集列表改为全页扫描 data-ep-id（原来靠 ep-grid 的 </div> 截断，站点一改就漏集）。
//
// ============================================================================

// 解密代理地址。三种格式都认：
//   'https://xxx.workers.dev/?u='          （推荐，带查询参数）
//   'https://xxx.workers.dev/?url='        （旧版 Worker 的参数名）
//   'https://xxx.workers.dev/hg'           （Worker 路由，会自己接 ?u=）
const IMG_PROXY = 'https://huangguo-img.qs858053851.workers.dev/?u='

const VERSION = '2.0.1'

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const SITE = 'https://huangguoai.com'

const HEADERS = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    // ↓↓↓ 乱码修复的关键：不要向站点声明 br/deflate/gzip
    'Accept-Encoding': 'identity',
    Referer: SITE + '/',
}

const TABS = [
    { name: '首页', id: 'home' },
    { name: 'AI成人短剧', id: 'ai-duanju' },
    { name: 'AI成人漫剧', id: 'ai-manju' },
    { name: 'AI换脸', id: 'ai-huanlian' },
    { name: 'AI魔改', id: 'ai-mogai' },
    { name: '排行榜', id: 'ranks/hot' },
]

// ---------- 工具 ----------
function fix(u) {
    if (!u) return ''
    if (u.indexOf('//') === 0) return 'https:' + u
    if (u.indexOf('/') === 0) return SITE + u
    return u
}

function stripTags(s) {
    return String(s || '')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim()
}

// 封面地址：优先走解密代理；无代理则剥掉会过期的 auth_key（实测无 auth_key 仍 200）
function pic(u) {
    u = fix(u || '')
    if (!u) return ''
    if (u.indexOf('http') !== 0) return u
    if (IMG_PROXY) {
        const joiner = IMG_PROXY.indexOf('?') !== -1 ? '' : '?u='
        return IMG_PROXY + joiner + encodeURIComponent(u)
    }
    return u.replace(/\?.*/, '')
}

async function fetchHtml(url, referer) {
    const headers = referer ? Object.assign({}, HEADERS, { Referer: referer }) : HEADERS
    const resp = await $fetch.get(url, { headers })
    const data = resp && resp.data
    if (typeof data === 'string') return data
    if (data == null) return ''
    return JSON.stringify(data)
}

// ---------- 卡片解析 ----------
function gridSlices(html, allGrids) {
    // .hg-card-grid 區塊；allGrids=true 取全部，否則只取第一個（主列表）
    const re = /<div\s+class="[^"]*\bhg-card-grid\b[^"]*"[^>]*>/g
    const starts = []
    let m
    while ((m = re.exec(html)) !== null) starts.push(m.index + m[0].length)
    if (!starts.length) return []
    const slices = []
    const n = allGrids ? starts.length : Math.min(1, starts.length)
    for (let i = 0; i < n; i++) {
        const to = i + 1 < starts.length ? starts[i + 1] : html.length
        slices.push(html.slice(starts[i], to))
    }
    return slices
}

function cardBlocks(slice) {
    const re = /<div\s+class="[^"]*\bhg-drama-card\b[^"]*"[^>]*>/g
    const starts = []
    let m
    while ((m = re.exec(slice)) !== null) starts.push(m.index + m[0].length)
    const blocks = []
    for (let i = 0; i < starts.length; i++) {
        const to = i + 1 < starts.length ? starts[i + 1] : slice.length
        blocks.push(slice.slice(starts[i], to))
    }
    return blocks
}

function parseCardBlock(block) {
    const a = block.match(/href="[^"]*\/detail\/(\d+)\/[^"]*"/)
    if (!a) return null
    const vid = a[1]
    const imgM = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+)"/)
    let title = ''
    const t = block.match(/hg-drama-card__title[^>]*>([\s\S]*?)<\/a>/)
    if (t) title = stripTags(t[1])
    if (!title) {
        const tt = block.match(/<a[^>]+href="[^"]*\/detail\/\d+\/"[^>]*>([\s\S]*?)<\/a>/)
        if (tt) title = stripTags(tt[1])
    }
    if (!title) return null
    const ep = block.match(/hg-drama-card__episode[^>]*>([\s\S]*?)<\/span>/)
    const score = block.match(/hg-drama-card__score[^>]*>([\s\S]*?)<\/span>/)
    const rem = ep ? stripTags(ep[1]) : ''
    const sc = score ? stripTags(score[1]) : ''
    let remarks = ''
    if (rem && sc) remarks = rem + ' · ' + sc
    else remarks = rem || sc
    return {
        vod_id: vid,
        vod_name: title,
        vod_pic: pic(imgM ? imgM[1] : ''),
        vod_remarks: remarks,
        ext: { id: vid },
    }
}

function parseGridCards(html, allGrids) {
    if (!html) return []
    const list = []
    const seen = {}
    const slices = gridSlices(html, allGrids)
    for (const slice of slices) {
        for (const block of cardBlocks(slice)) {
            try {
                const item = parseCardBlock(block)
                if (!item || seen[item.vod_id]) continue
                seen[item.vod_id] = true
                list.push(item)
            } catch (e) {}
        }
    }
    return list
}

// ---------- 排行榜解析 ----------
function parseRanks(html) {
    if (!html) return []
    const listM = html.match(/<div\s+class="[^"]*\bhg-rank-list\b[^"]*"[^>]*>/)
    const from = listM ? listM.index + listM[0].length : 0
    const slice = html.slice(from)
    const re = /<div\s+class="[^"]*\bhg-rank-item\b[^"]*"[^>]*>/g
    const starts = []
    let m
    while ((m = re.exec(slice)) !== null) starts.push(m.index + m[0].length)
    const list = []
    const seen = {}
    for (let i = 0; i < starts.length; i++) {
        const to = i + 1 < starts.length ? starts[i + 1] : slice.length
        const block = slice.slice(starts[i], to)
        try {
            const a = block.match(/href="[^"]*\/detail\/(\d+)\/[^"]*"/)
            if (!a || seen[a[1]]) continue
            seen[a[1]] = true
            const imgM = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+)"/)
            let title = ''
            const t = block.match(/hg-rank-item__title[^>]*>([\s\S]*?)<\/h2>/)
            if (t) title = stripTags(t[1])
            if (!title) {
                const tt = block.match(/<a[^>]+href="[^"]*\/detail\/\d+\/"[^>]*>([\s\S]*?)<\/a>/)
                if (tt) title = stripTags(tt[1])
            }
            if (!title) continue
            const tags = block.match(/hg-rank-item__tags[^>]*>([\s\S]*?)<\/div>/)
            const rank = block.match(/hg-rank-item__no[^>]*>([\s\S]*?)<\/span>/)
            const rk = rank ? stripTags(rank[1]) : ''
            const tg = tags ? stripTags(tags[1]).replace(/^\s*[·|]\s*/, '').replace(/\s*·\s*/g, ' · ') : ''
            let remarks = tg
            if (rk) remarks = rk + ' · ' + tg
            list.push({
                vod_id: a[1],
                vod_name: title,
                vod_pic: pic(imgM ? imgM[1] : ''),
                vod_remarks: remarks,
                ext: { id: a[1] },
            })
        } catch (e) {}
    }
    return list
}

// ---------- 介面 ----------
async function getLocalInfo() {
    return jsonify({ ver: 1, name: '黄果短剧', api: 'csp_huangguo', type: 3 })
}

async function getConfig() {
    return jsonify({
        ver: 1,
        title: '黄果短剧',
        site: SITE,
        tabs: TABS.map((t) => ({ name: t.name, ext: { id: t.id } })),
    })
}

async function getCards(ext) {
    ext = argsify(ext)
    const id = String(ext.id || 'home').replace(/^\//, '')
    const page = Math.max(1, parseInt(ext.page) || 1)
    try {
        if (id === 'home') {
            const html = await fetchHtml(SITE + '/')
            return jsonify({ list: parseGridCards(html, true), page: page })
        }
        // 排行榜无分页：/ranks/hot/2/ 实测 404
        if (id.indexOf('rank') !== -1) {
            const rhtml = await fetchHtml(SITE + '/' + id + '/')
            return jsonify({ list: parseRanks(rhtml), page: 1 })
        }
        const url = SITE + '/' + id + '/' + (page > 1 ? page + '/' : '')
        const html = await fetchHtml(url)
        return jsonify({ list: parseGridCards(html, false), page: page })
    } catch (e) {
        console.error('getCards error:', e)
        return jsonify({ list: [], page: page })
    }
}

async function getTracks(ext) {
    ext = argsify(ext)
    const id = ext.id || ''
    if (!id) return jsonify({ list: [] })
    try {
        const html = await fetchHtml(SITE + '/detail/' + id + '/')
        const tracks = []
        const seen = {}
        // 全页扫描 data-ep-id，避免 ep-grid 的 </div> 截断导致漏集
        const are = /<a\b[^>]*data-ep-id="([^"]*)"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>|<a\b[^>]*href="([^"]+)"[^>]*data-ep-id="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g
        let m
        while ((m = are.exec(html)) !== null) {
            const eid = m[1] != null ? m[1] : m[5]
            const href = m[2] != null ? m[2] : m[4]
            if (!href || seen[href]) continue
            if (href.indexOf('/video/') === -1) continue
            seen[href] = true
            const name = eid ? '第' + eid + '集' : stripTags(m[3] || m[6]) || '第' + (tracks.length + 1) + '集'
            tracks.push({ name: name, ext: { url: fix(href), ep: eid || '' } })
        }
        if (!tracks.length) {
            const playM = html.match(/<a\b[^>]*class="[^"]*\bhg-web-detail__play\b[^"]*"[^>]*href="([^"]+)"/)
            if (playM) tracks.push({ name: '第1集', ext: { url: fix(playM[1]), ep: '1' } })
        }
        if (!tracks.length) return jsonify({ list: [] })
        return jsonify({ list: [{ title: '黄果短剧', tracks: tracks }] })
    } catch (e) {
        console.error('getTracks error:', e)
        return jsonify({ list: [] })
    }
}

async function getPlayinfo(ext) {
    ext = argsify(ext)
    const url = ext.url || ''
    const ep = String(ext.ep || '1')
    if (!url) return jsonify({ urls: [] })
    try {
        const html = await fetchHtml(url, SITE)
        let play = ''
        const m = html.match(/id="videoInitialData"[^>]*>([\s\S]*?)<\/script>/)
        if (m) {
            try {
                const data = JSON.parse(m[1])
                const srcs = (data && data.epPlaySrcs) || {}
                play = srcs[ep] || (data && data.videoSrc) || ''
            } catch (e) {}
        }
        if (play) {
            play = play.replace(/\\u0026/g, '&')
            if (play.indexOf('http') !== 0) {
                const mm = play.match(/(https?:\/\/[^\s"']+)/)
                play = mm ? mm[1] : ''
            }
        }
        if (!play) return jsonify({ urls: [] })
        return jsonify({
            urls: [play],
            headers: [{ 'User-Agent': UA, Referer: SITE + '/' }],
        })
    } catch (e) {
        console.error('getPlayinfo error:', e)
        return jsonify({ urls: [] })
    }
}

async function search(ext) {
    ext = argsify(ext)
    const kw = String(ext.text || ext.wd || '').trim()
    if (!kw) return jsonify({ list: [], page: 1 })
    try {
        const html = await fetchHtml(SITE + '/search/video/' + encodeURIComponent(kw) + '/')
        return jsonify({ list: parseGridCards(html, false), page: 1 })
    } catch (e) {
        console.error('search error:', e)
        return jsonify({ list: [], page: 1 })
    }
}
