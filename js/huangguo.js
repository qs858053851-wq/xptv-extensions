// ============================================================================
//  黄果短剧  huangguoai.com   ——   XPTV 增强版源
//  version: 3.0.0  (2026-11-11)
// ============================================================================
//
//  【为什么旧版突然不能播】
//    站点 2026-11 改版：
//      1. 详情页从 /detail/{id}/ 改成 /video/{id}/（旧路径现在返回 410）；
//      2. 详情页 videoInitialData.epPlaySrcs 现在是空对象 {}；
//      3. 真实播放地址改由 POST /api/videos/{id}/episodes/{ep}/playback 返回
//         data.streams.main（m3u8，带临时 auth_key）；
//      4. 剧集按钮从 hg-web-detail__ep-grid 改为 a.hg-web-play__ep[data-ep-id]。
//    旧脚本仍读 epPlaySrcs / detail 路径，所以列表能出、点开无剧集或播放为空。
//
//  【本版做法（与 HGhub 1.2.1 同一套接口）】
//    * 列表/详情/搜索优先走站点 JSON API：
//        GET /api/videos?page=&size=
//        GET /api/videos/category/{id}?page=&size=
//        GET /api/ranks/{kind}
//        GET /api/videos/{id}
//        GET /api/search?q=&page=&size=
//      页面 HTML 解析只做兜底。
//    * 播放：POST /api/videos/{id}/episodes/{ep}/playback，body 为 {}，
//      取 data.streams.main（回退 hevc / preview / video_url）。
//    * 封面仍走解密代理（AES-128-CBC，站点封面是加密二进制）。
//
//  【XPTV 缓存】更新后记得把 xptv.json 里的 ?v= 加一，否则会继续用旧缓存。
// ============================================================================

// 封面解密代理（Cloudflare Worker，参数名 url）
const IMG_PROXY = 'https://hg-img-decrypt.qs858053851.workers.dev/?url='

const VERSION = '3.0.0'

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const SITE = 'https://huangguoai.com'

const HEADERS = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    // 旧版实测：不声明 br/gzip，站点直接回明文，避免 XPTV 的 $fetch 不解 Brotli
    'Accept-Encoding': 'identity',
    Referer: SITE + '/',
}

const JSON_HEADERS = Object.assign({}, HEADERS, {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
})

const TABS = [
    { name: '首页', id: 'home' },
    { name: 'AI成人短剧', id: 'ai-duanju' },
    { name: 'AI成人漫剧', id: 'ai-manju' },
    { name: 'AI换脸', id: 'ai-huanlian' },
    { name: 'AI魔改', id: 'ai-mogai' },
    { name: '排行榜', id: 'ranks/hot' },
]

// ---------- 基础工具 ----------

function fix(u) {
    if (!u) return ''
    if (u.indexOf('//') === 0) return 'https:' + u
    if (u.indexOf('/') === 0) return SITE + u
    return u
}

// 兼容旧缓存里的 /detail/ 链接
function fixPage(u) {
    return fix(u || '').replace('/detail/', '/video/')
}

// argsify 在部分 XPTV 版本遇到 undefined 会抛异常，这里彻底兜住
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

function imgSrc(u) {
    u = fix(u || '')
    if (!u) return ''
    if (u.indexOf('http') === 0 && u.indexOf('?') !== -1) {
        u = u.replace(/\?.*/, '')
    }
    if (IMG_PROXY && u.indexOf('http') === 0) {
        return IMG_PROXY + encodeURIComponent(u)
    }
    return u
}

// ---------- 网络 ----------

function unwrap(resp) {
    let data = resp && resp.data !== undefined ? resp.data : resp
    if (typeof data === 'string') {
        try {
            data = JSON.parse(data)
        } catch (e) {
            return null
        }
    }
    if (!data || typeof data !== 'object') return null
    if (data.status === 1) return data.data
    if (data.status !== undefined && data.status !== 1) return null
    return data
}

async function apiGet(path) {
    const resp = await $fetch.get(SITE + path, { headers: JSON_HEADERS })
    return unwrap(resp)
}

async function apiPost(path, body) {
    const resp = await $fetch.post(SITE + path, body || {}, { headers: JSON_HEADERS })
    return unwrap(resp)
}

async function fetchHtml(url, referer) {
    const headers = referer ? Object.assign({}, HEADERS, { Referer: referer }) : HEADERS
    const resp = await $fetch.get(url, { headers: headers })
    const data = resp && resp.data !== undefined ? resp.data : resp
    return typeof data === 'string' ? data : data == null ? '' : JSON.stringify(data)
}

// ---------- JSON API 卡片 ----------

function apiRemarks(item) {
    if (!item || typeof item !== 'object') return ''
    const parts = []
    const ep = parseInt(item.episode_count || 0)
    const total = parseInt(item.total_episodes || 0)
    if (item.is_finished) {
        if (total || ep) parts.push('全' + (total || ep) + '集')
        else parts.push('已完结')
    } else if (ep) {
        parts.push('更新至' + ep + '集')
    }
    if (item.score !== undefined && item.score !== null && item.score !== '') {
        parts.push(String(item.score) + '分')
    }
    if (!parts.length && item.metric_label && item.metric_value !== undefined) {
        parts.push(String(item.metric_label) + ' ' + String(item.metric_value))
    }
    return parts.join(' · ')
}

function apiCard(item) {
    if (!item || typeof item !== 'object') return null
    const vid = String(item.id || item.video_id || '')
    const title = decodeHtml(item.title || '')
    if (!vid || !title) return null
    return {
        vod_id: vid,
        vod_name: title,
        vod_pic: imgSrc(item.cover || ''),
        vod_remarks: apiRemarks(item),
        ext: { id: vid },
    }
}

function apiCards(items) {
    const out = []
    const seen = {}
    if (!items || !items.length) return out
    for (let i = 0; i < items.length; i++) {
        try {
            const card = apiCard(items[i])
            if (!card || seen[card.vod_id]) continue
            seen[card.vod_id] = true
            out.push(card)
        } catch (e) {}
    }
    return out
}

// ---------- HTML 兜底解析 ----------

function parseCardBlock(block) {
    const vidM =
        block.match(/data-track-id="(\d+)"/) ||
        block.match(/data-track-item-id="(\d+)"/) ||
        block.match(/href="[^"]*\/(?:detail|video)\/(\d+)\/[^"]*"/)
    if (!vidM) return null
    const vid = vidM[1]

    let title = ''
    const dtM = block.match(/data-track-title="([^"]+)"/)
    if (dtM) {
        title = decodeHtml(dtM[1])
    } else {
        const th = block.match(/hg-drama-card__title[^>]*>([\s\S]*?)<\/h3>/)
        if (th) title = decodeHtml(th[1])
        if (!title) {
            const a = block.match(/<a[^>]+href="[^"]*\/(?:detail|video)\/\d+\/"[^>]*>([\s\S]*?)<\/a>/)
            if (a) title = decodeHtml(a[1])
        }
    }
    if (!title) return null

    const imgM = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+)"/)
    let pic = imgM ? imgM[1] : ''
    if (pic.indexOf('cover-placeholder') !== -1) {
        const ds = block.match(/data-src="([^"]+)"/)
        if (ds) pic = ds[1]
    }

    let epText = ''
    const epBaseM = block.match(/data-ep-base="([^"]+)"/)
    if (epBaseM) {
        epText = decodeHtml(epBaseM[1])
    } else {
        const epTagM = block.match(/hg-drama-card__episode[^>]*>([\s\S]*?)<\/span>/)
        if (epTagM) epText = decodeHtml(epTagM[1].replace(/<i\b[^>]*>[\s\S]*?<\/i>/g, ''))
    }
    const scM = block.match(/hg-drama-card__score[^>]*>([\s\S]*?)<\/span>/)
    const scText = scM ? decodeHtml(scM[1]) : ''
    const remarks = [epText, scText].filter(Boolean).join(' · ')

    return {
        vod_id: vid,
        vod_name: title,
        vod_pic: imgSrc(pic),
        vod_remarks: remarks,
        ext: { id: vid },
    }
}

function parseCardsFromHtml(html) {
    if (!html) return []
    let bodyHtml = html
    const headerEnd = html.indexOf('</header>')
    if (headerEnd !== -1) bodyHtml = html.slice(headerEnd)
    const re = /<div\s+class="[^"]*\bhg-drama-card\b[^"]*"[^>]*>/g
    const starts = []
    let m
    while ((m = re.exec(bodyHtml)) !== null) starts.push(m.index)
    const list = []
    const seen = {}
    for (let i = 0; i < starts.length; i++) {
        const to = i + 1 < starts.length ? starts[i + 1] : bodyHtml.length
        try {
            const item = parseCardBlock(bodyHtml.slice(starts[i], to))
            if (!item || seen[item.vod_id]) continue
            seen[item.vod_id] = true
            list.push(item)
        } catch (e) {}
    }
    return list
}

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
        try {
            const block = slice.slice(starts[i], to)
            const a = block.match(/href="[^"]*\/(?:detail|video)\/(\d+)\/[^"]*"/)
            if (!a || seen[a[1]]) continue
            seen[a[1]] = true
            const imgM = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+)"/)
            let title = ''
            const t = block.match(/hg-rank-item__title[^>]*>([\s\S]*?)<\/h2>/)
            if (t) title = decodeHtml(t[1])
            if (!title) {
                const tt = block.match(/<a[^>]+href="[^"]*\/(?:detail|video)\/\d+\/"[^>]*>([\s\S]*?)<\/a>/)
                if (tt) title = decodeHtml(tt[1])
            }
            if (!title) continue
            const tags = block.match(/hg-rank-item__tags[^>]*>([\s\S]*?)<\/div>/)
            const rank = block.match(/hg-rank-item__no[^>]*>([\s\S]*?)<\/span>/)
            const rk = rank ? decodeHtml(rank[1]) : ''
            const tg = tags ? decodeHtml(tags[1]).replace(/^\s*[·|]\s*/, '').replace(/\s*·\s*/g, ' · ') : ''
            list.push({
                vod_id: a[1],
                vod_name: title,
                vod_pic: imgSrc(imgM ? imgM[1] : ''),
                vod_remarks: [rk, tg].filter(Boolean).join(' · '),
                ext: { id: a[1] },
            })
        } catch (e) {}
    }
    return list
}

// ---------- 接口 ----------

async function getLocalInfo() {
    return jsonify({ ver: 2, name: '黄果短剧', api: 'csp_huangguo', type: 3 })
}

async function getConfig() {
    return jsonify({
        ver: 2,
        title: '黄果短剧',
        site: SITE,
        tabs: TABS.map(function (t) {
            return { name: t.name, ext: { id: t.id } }
        }),
    })
}

async function getCards(ext) {
    ext = safeExt(ext)
    const id = String(ext.id || 'home').replace(/^\//, '')
    const page = Math.max(1, parseInt(ext.page) || 1)

    try {
        let data = null
        let list = []
        if (id === 'home') {
            data = await apiGet('/api/videos?page=' + page + '&size=24')
        } else if (id.indexOf('rank') !== -1) {
            const kind = id.split('/')[1] || 'hot'
            data = await apiGet('/api/ranks/' + encodeURIComponent(kind))
        } else {
            data = await apiGet('/api/videos/category/' + encodeURIComponent(id) + '?page=' + page + '&size=24')
        }
        if (data && data.items) list = apiCards(data.items)

        // JSON API 失败或空结果时回退 HTML
        if (!list.length) {
            if (id === 'home') {
                list = parseCardsFromHtml(await fetchHtml(SITE + '/'))
            } else if (id.indexOf('rank') !== -1) {
                list = parseRanks(await fetchHtml(SITE + '/' + id + '/'))
            } else {
                list = parseCardsFromHtml(await fetchHtml(SITE + '/' + id + '/' + (page > 1 ? page + '/' : '')))
            }
        }
        return jsonify({ list: list, page: page })
    } catch (e) {
        console.error('getCards error:', e)
        return jsonify({ list: [], page: page })
    }
}

async function getTracks(ext) {
    ext = safeExt(ext)
    let id = String(ext.id || '')
    const pageUrl = fixPage(ext.url || '')
    if (!id && pageUrl) {
        const m = pageUrl.match(/\/video\/(\d+)/)
        if (m) id = m[1]
    }
    if (!id) return jsonify({ list: [] })

    const tracks = []
    try {
        // 1) JSON 详情：/api/videos/{id} -> data.episodes
        const data = await apiGet('/api/videos/' + id)
        if (data && data.episodes && data.episodes.length) {
            for (let i = 0; i < data.episodes.length; i++) {
                const e = data.episodes[i]
                const n = parseInt(e.ep_num || 0)
                if (!n) continue
                tracks.push({
                    name: '第' + n + '集',
                    ext: {
                        id: id,
                        ep: String(n),
                        url: SITE + '/video/' + id + '/' + (n > 1 ? 'ep-' + n + '/' : ''),
                    },
                })
            }
        }

        // 2) HTML 兜底：新版 a.hg-web-play__ep[data-ep-id]
        let html = ''
        if (!tracks.length) {
            html = await fetchHtml(SITE + '/video/' + id + '/')
            const re = /<a\b[^>]*class="[^"]*\bhg-web-play__ep\b[^"]*"[^>]*>[\s\S]*?<\/a>/g
            let m
            const seen = {}
            while ((m = re.exec(html)) !== null) {
                const block = m[0]
                const h = block.match(/href="([^"]+)"/)
                if (!h) continue
                const eidM = block.match(/data-ep-id="([^"]*)"/)
                const eid = eidM ? eidM[1] : ''
                if (seen[h[1]]) continue
                seen[h[1]] = true
                tracks.push({
                    name: eid ? '第' + eid + '集' : decodeHtml(block) || '第' + (tracks.length + 1) + '集',
                    ext: { id: id, ep: eid || String(tracks.length + 1), url: fixPage(h[1]) },
                })
            }
        }

        // 3) 更老的 ep-grid 兜底
        if (!tracks.length && html.indexOf('hg-web-detail__ep-grid') !== -1) {
            const grid = html.match(/<div\s+class="[^"]*\bhg-web-detail__ep-grid\b[^"]*"[^>]*>([\s\S]*?)<\/div>/)
            if (grid) {
                const re = /<a\b[^>]*>[\s\S]*?<\/a>/g
                let m
                while ((m = re.exec(grid[1])) !== null) {
                    const block = m[0]
                    const h = block.match(/href="([^"]+)"/)
                    if (!h) continue
                    const eidM = block.match(/data-ep-id="([^"]*)"/)
                    const eid = eidM ? eidM[1] : ''
                    tracks.push({
                        name: eid ? '第' + eid + '集' : decodeHtml(block) || '第' + (tracks.length + 1) + '集',
                        ext: { id: id, ep: eid || String(tracks.length + 1), url: fixPage(h[1]) },
                    })
                }
            }
        }

        if (!tracks.length) return jsonify({ list: [] })
        return jsonify({ list: [{ title: '黄果短剧', tracks: tracks }] })
    } catch (e) {
        console.error('getTracks error:', e)
        return jsonify({ list: [] })
    }
}

async function getPlayinfo(ext) {
    ext = safeExt(ext)
    const pageUrl = fixPage(ext.url || '')
    let id = String(ext.id || '')
    let ep = String(ext.ep || '')
    if (!id && pageUrl) {
        const m = pageUrl.match(/\/video\/(\d+)/)
        if (m) id = m[1]
    }
    if (!ep && pageUrl) {
        const m = pageUrl.match(/\/ep-(\d+)/)
        if (m) ep = m[1]
    }
    if (!ep) ep = '1'
    if (!id) return jsonify({ urls: [] })

    try {
        let play = ''

        // 1) 新播放接口：POST /api/videos/{id}/episodes/{ep}/playback
        try {
            const data = await apiPost('/api/videos/' + id + '/episodes/' + ep + '/playback', {})
            if (data) {
                const streams = data.streams || {}
                play = streams.main || streams.hevc || streams.preview || data.video_url || data.video_url_hevc || ''
            }
        } catch (e) {
            console.error('playback api error:', e)
        }

        // 2) 旧接口兜底（目前 video_url 多为空，保留以防回滚）
        if (!play) {
            try {
                const legacy = await apiGet('/api/videos/' + id + '/play?ep=' + ep + '&page_texts=0')
                if (legacy) play = legacy.video_url || legacy.video_url_hevc || ''
            } catch (e) {}
        }

        // 3) 页面 videoInitialData 兜底（旧版结构）
        if (!play && pageUrl) {
            const html = await fetchHtml(pageUrl, SITE)
            const m = html.match(/id="videoInitialData"[^>]*>([\s\S]*?)<\/script>/)
            if (m) {
                try {
                    const data = JSON.parse(m[1])
                    const srcs = (data && data.epPlaySrcs) || {}
                    play = srcs[ep] || (data && data.videoSrc) || ''
                } catch (e) {}
            }
        }

        if (!play) return jsonify({ urls: [] })
        play = String(play).replace(/\\u0026/g, '&')
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
        let list = []
        const data = await apiGet('/api/search?q=' + encodeURIComponent(kw) + '&page=1&size=24')
        if (data && data.items) list = apiCards(data.items)
        if (!list.length) {
            list = parseCardsFromHtml(await fetchHtml(SITE + '/search/video/' + encodeURIComponent(kw) + '/'))
        }
        return jsonify({ list: list, page: 1 })
    } catch (e) {
        console.error('search error:', e)
        return jsonify({ list: [], page: 1 })
    }
}
