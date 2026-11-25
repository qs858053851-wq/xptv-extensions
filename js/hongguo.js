// ============================================================================
//  红果短剧  hongguoapp.cn   ——   XPTV 增强版源
//  version: 1.0.0  (2026-11-11)
// ============================================================================
//
//  【说明】
//    红果短剧官方 App（com.phoenix.read）的接口需要 X-Argus / X-Gorgon 签名，
//    XPTV 里没法直接复用。本源使用的是红果短剧的网页版聚合站
//    https://www.hongguoapp.cn/（苹果 CMS / conch 模板），同样提供：
//      * 分类列表：/index.php/ajax/data?mid=1&tid=51&page=N
//      * 搜索建议：/index.php/ajax/suggest?mid=1&wd=关键词
//      * 详情页：  /voddetail/{id}.html
//      * 播放页：  /vodplay/{id}-1-{ep}.html
//    播放页里的 player_aaaa 直接带 m3u8 地址，XPTV 可直接播放。
//
//  【提示】如果播放页提示“请使用中国大陆网络访问”，需要把
//    hongguoapp.cn / fengbao8.com / bfllvip.com 等域名走直连。
// ============================================================================

const VERSION = '1.0.0'
const SITE = 'https://www.hongguoapp.cn'

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const HEADERS = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Accept-Encoding': 'identity',
    Referer: SITE + '/',
}

const TABS = [
    { name: '首页', id: 'home' },
    { name: '全部短剧', id: 'all' },
    { name: '热播榜', id: 'hits' },
    { name: '新剧榜', id: 'time' },
    { name: '古装', id: 'class:古装' },
    { name: '喜剧', id: 'class:喜剧' },
]

// ---------- 工具 ----------

function safeExt(ext) {
    if (!ext) return {}
    if (typeof ext === 'object') return ext
    if (typeof ext === 'string') {
        try {
            const obj = JSON.parse(ext)
            return obj && typeof obj === 'object' ? obj : {}
        } catch (e) {
            return {}
        }
    }
    return {}
}

function fix(u) {
    if (!u) return ''
    u = String(u).trim()
    if (!u) return ''
    if (u.indexOf('//') === 0) return 'https:' + u
    if (/^https?:\/\//i.test(u)) return u
    if (u.indexOf('/') === 0) return SITE + u
    return SITE + '/' + u.replace(/^\.\//, '')
}

function decodeHtml(s) {
    if (!s) return ''
    return String(s)
        .replace(/<span[^>]*class="[^"]*sr-only[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '')
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function readAttr(html, name) {
    if (!html) return ''
    const re = new RegExp('\\b' + name + '\\s*=\\s*(["\'])([\\s\\S]*?)\\1', 'i')
    const m = String(html).match(re)
    return m ? m[2] : ''
}

function imgSrc(u) {
    u = fix(u || '')
    if (u.indexOf('http') === 0 && u.indexOf('?') !== -1) {
        u = u.replace(/\?.*/, '')
    }
    return u
}

async function fetchHtml(url, referer) {
    const headers = referer ? Object.assign({}, HEADERS, { Referer: referer }) : HEADERS
    const resp = await $fetch.get(url, { headers: headers })
    const data = resp && resp.data !== undefined ? resp.data : resp
    return typeof data === 'string' ? data : data == null ? '' : JSON.stringify(data)
}

async function apiGet(path) {
    const resp = await $fetch.get(SITE + path, {
        headers: Object.assign({}, HEADERS, { Accept: 'application/json, text/plain, */*' }),
    })
    let data = resp && resp.data !== undefined ? resp.data : resp
    if (typeof data === 'string') {
        try {
            data = JSON.parse(data)
        } catch (e) {
            return null
        }
    }
    return data && typeof data === 'object' ? data : null
}

// ---------- 卡片 ----------

function apiCard(item) {
    if (!item || typeof item !== 'object') return null
    const vid = String(item.vod_id || item.id || '')
    const title = decodeHtml(item.vod_name || item.name || item.title || '')
    if (!vid || !title) return null
    const remarks = decodeHtml(item.vod_remarks || '')
    return {
        vod_id: vid,
        vod_name: title,
        vod_pic: imgSrc(item.vod_pic || item.pic || item.cover || ''),
        vod_remarks: remarks,
        ext: { id: vid },
    }
}

function apiCards(list) {
    const out = []
    const seen = {}
    if (!list || !list.length) return out
    for (let i = 0; i < list.length; i++) {
        try {
            const card = apiCard(list[i])
            if (!card || seen[card.vod_id]) continue
            seen[card.vod_id] = true
            out.push(card)
        } catch (e) {}
    }
    return out
}

function parseCardsFromHtml(html) {
    if (!html) return []
    const list = []
    const seen = {}
    const re = /<li\b[^>]*class="[^"]*\bhl-list-item\b[^"]*"[^>]*>/gi
    const starts = []
    let m
    while ((m = re.exec(html)) !== null) starts.push(m.index)
    if (!starts.length) {
        // 兜底：直接按详情链接抓
        const are = /<a\b[^>]*href="([^"]*\/voddetail\/(\d+)\.html)"[^>]*>/gi
        while ((m = are.exec(html)) !== null) {
            const id = m[2]
            if (seen[id]) continue
            seen[id] = true
            const title = decodeHtml(readAttr(m[0], 'title')) || '红果短剧'
            list.push({ vod_id: id, vod_name: title, vod_pic: '', vod_remarks: '', ext: { id: id } })
        }
        return list
    }
    for (let i = 0; i < starts.length; i++) {
        const to = i + 1 < starts.length ? starts[i + 1] : html.length
        const block = html.slice(starts[i], to)
        try {
            const a = block.match(/href="([^"]*\/voddetail\/(\d+)\.html)"/i)
            if (!a) continue
            const vid = a[2]
            if (seen[vid]) continue
            seen[vid] = true
            let title = decodeHtml(readAttr(block, 'title'))
            if (!title) {
                const tm = block.match(/hl-item-title[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)
                if (tm) title = decodeHtml(tm[1])
            }
            if (!title) continue
            let pic = readAttr(block, 'data-original') || readAttr(block, 'data-src') || readAttr(block, 'src')
            const rm = block.match(/class="[^"]*\bremarks\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
            const remarks = rm ? decodeHtml(rm[1]) : ''
            list.push({
                vod_id: vid,
                vod_name: title,
                vod_pic: imgSrc(pic),
                vod_remarks: remarks,
                ext: { id: vid },
            })
        } catch (e) {}
    }
    return list
}

// ---------- 接口 ----------

async function getLocalInfo() {
    return jsonify({ ver: 2, name: '红果短剧', api: 'csp_qs_hongguo', type: 3 })
}

async function getConfig() {
    return jsonify({
        ver: 2,
        title: '红果短剧',
        site: SITE,
        tabs: TABS.map(function (t) {
            return { name: t.name, ext: { id: t.id } }
        }),
    })
}

async function getCards(ext) {
    ext = safeExt(ext)
    const id = String(ext.id || 'home')
    const page = Math.max(1, parseInt(ext.page) || 1)

    try {
        // 首页：最新短剧第一页
        if (id === 'home') {
            if (page > 1) return jsonify({ list: [], page: page })
            const d = await apiGet('/index.php/ajax/data?mid=1&limit=20&tid=51&page=1')
            let list = apiCards(d && d.list)
            if (!list.length) list = parseCardsFromHtml(await fetchHtml(SITE + '/'))
            return jsonify({ list: list, page: 1 })
        }

        // 全部短剧：JSON 接口
        if (id === 'all') {
            const d = await apiGet('/index.php/ajax/data?mid=1&limit=20&tid=51&page=' + page)
            let list = apiCards(d && d.list)
            if (!list.length && page === 1) list = parseCardsFromHtml(await fetchHtml(SITE + '/vodshow/51-----------.html'))
            const pagecount = d && d.pagecount ? parseInt(d.pagecount) : page + 1
            return jsonify({ list: list, page: page, pagecount: pagecount })
        }

        // 热播榜 / 新剧榜 / 分类：HTML 页面
        let path = '/vodshow/51-----------.html'
        if (id === 'hits') path = '/vodshow/51--hits---------.html'
        else if (id === 'time') path = '/vodshow/51--time---------.html'
        else if (id.indexOf('class:') === 0) {
            path = '/vodshow/51---' + encodeURIComponent(id.slice(6)) + '--------.html'
        }
        const url = SITE + path + (page > 1 ? '?page=' + page : '')
        const html = await fetchHtml(url)
        const list = parseCardsFromHtml(html)
        return jsonify({ list: list, page: page, pagecount: list.length ? page + 1 : page })
    } catch (e) {
        console.error('getCards error:', e)
        return jsonify({ list: [], page: page })
    }
}

async function getTracks(ext) {
    ext = safeExt(ext)
    let id = String(ext.id || '')
    const pageUrl = fix(ext.url || '')
    if (!id && pageUrl) {
        const m = pageUrl.match(/\/voddetail\/(\d+)\.html/)
        if (m) id = m[1]
    }
    if (!id) return jsonify({ list: [] })

    try {
        const html = await fetchHtml(SITE + '/voddetail/' + id + '.html')
        const tracks = []
        const seen = {}
        let scope = html
        const ulM = html.match(/<ul\b[^>]*id="hl-plays-list"[^>]*>([\s\S]*?)<\/ul>/i)
        if (ulM) scope = ulM[1]

        const are = /<a\b[^>]*href="([^"]*\/vodplay\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
        let m
        while ((m = are.exec(scope)) !== null) {
            const href = m[1]
            const rawName = decodeHtml(m[2])
            if (!rawName || rawName.indexOf('立即免费播放') !== -1) continue
            const epM = href.match(/-1-(\d+)\.html/) || href.match(/-(\d+)\.html/)
            let ep = epM ? epM[1] : ''
            if (!ep) ep = String(tracks.length + 1)
            if (seen[ep]) continue
            seen[ep] = true
            tracks.push({
                name: rawName || '第' + ep + '集',
                ext: { id: id, ep: ep, url: fix(href) },
            })
        }
        if (!tracks.length) return jsonify({ list: [] })
        return jsonify({ list: [{ title: '红果短剧', tracks: tracks }] })
    } catch (e) {
        console.error('getTracks error:', e)
        return jsonify({ list: [] })
    }
}

async function getPlayinfo(ext) {
    ext = safeExt(ext)
    let id = String(ext.id || '')
    let ep = String(ext.ep || '1')
    let pageUrl = fix(ext.url || '')
    if (!id && pageUrl) {
        const m = pageUrl.match(/\/voddetail\/(\d+)\.html/)
        if (m) id = m[1]
    }
    if (!ep || ep === '全集') ep = '1'
    if (!pageUrl && id) {
        pageUrl = SITE + '/vodplay/' + id + '-1-' + ep + '.html'
    }
    if (!pageUrl) return jsonify({ urls: [] })

    try {
        const html = await fetchHtml(pageUrl, SITE)
        let play = ''
        const pm = html.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\})\s*<\/script>/i)
        if (pm) {
            try {
                const data = JSON.parse(pm[1])
                play = data && (data.url || data.url_next || '')
            } catch (e) {}
        }
        if (!play) {
            const m = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i)
            if (m) play = m[0]
        }
        if (!play) return jsonify({ urls: [] })
        play = String(play).replace(/\\u0026/g, '&')
        if (play.indexOf('//') === 0) play = 'https:' + play
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
    ext = safeExt(ext)
    const kw = String(ext.text || ext.wd || '').trim()
    if (!kw) return jsonify({ list: [], page: 1 })
    try {
        const d = await apiGet('/index.php/ajax/suggest?mid=1&wd=' + encodeURIComponent(kw))
        let list = apiCards(d && d.list)
        if (!list.length) {
            const html = await fetchHtml(SITE + '/vodshow/51-----------.html?wd=' + encodeURIComponent(kw))
            list = parseCardsFromHtml(html)
        }
        return jsonify({ list: list, page: 1 })
    } catch (e) {
        console.error('search error:', e)
        return jsonify({ list: [], page: 1 })
    }
}
