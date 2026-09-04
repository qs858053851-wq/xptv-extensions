// Jable TV - XPTV 专属增强版播放源扩展 (Enhanced JS Spider)
// 支持: 💡最新更新 / 🔥热门排行 / 🆕新作上市 / 📚主题分类 / 🔍全局番号搜索 / 4K·1080P HLS直链提取

const cheerio = createCheerio();

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15';

let appConfig = {
    ver: 2,
    title: 'Jable TV',
    site: 'https://jable.tv',
    tabs: [
        {
            name: '💡 最新更新',
            ext: {
                url: 'https://jable.tv/latest-updates/',
                type: 'list'
            },
            ui: 1
        },
        {
            name: '🔥 熱門排行',
            ext: {
                url: 'https://jable.tv/hot/',
                type: 'list'
            },
            ui: 1
        },
        {
            name: '🆕 新作上映',
            ext: {
                url: 'https://jable.tv/new-release/',
                type: 'list'
            },
            ui: 1
        }
    ]
};

async function getConfig() {
    let config = { ...appConfig };
    try {
        let classurl = `${appConfig.site}/categories/?mode=async&function=get_block&block_id=list_categories_video_categories_list&sort_by=avg_videos_popularity`;
        const { data } = await $fetch.get(classurl, {
            headers: { 'User-Agent': UA }
        });
        if (data && !data.includes('Just a moment...')) {
            const $ = cheerio.load(data);
            $('.container .col-6.col-sm-4.col-lg-3').each((_, e) => {
                const name = $(e).find('h4').text().trim();
                const href = $(e).find('a').attr('href');
                if (name && href && !name.includes('首页')) {
                    config.tabs.push({
                        name: name,
                        ext: {
                            typeurl: href,
                            type: 'category'
                        },
                        ui: 1
                    });
                }
            });
        }
    } catch (err) {
        $print(`[jable] getConfig error: ${err}`);
    }
    return jsonify(config);
}

async function getCards(ext) {
    ext = argsify(ext);
    let cards = [];
    let { page = 1, type = 'list', url, typeurl } = ext;

    let targetUrl = '';
    if (type === 'category' && typeurl) {
        targetUrl = `${typeurl}?mode=async&function=get_block&block_id=list_videos_common_videos_list&sort_by=post_date&from=${page}&_=${Date.now()}`;
    } else {
        const baseUrl = (url || 'https://jable.tv/latest-updates/').replace(/\/+$/, '');
        targetUrl = page === 1 ? `${baseUrl}/` : `${baseUrl}/${page}/`;
    }

    const { data } = await $fetch.get(targetUrl, {
        headers: {
            'User-Agent': UA,
            'Cookie': 'language=cn_CN'
        }
    });

    if (data && data.includes('Just a moment...')) {
        $utils.openSafari(targetUrl, UA);
        return jsonify({ list: [] });
    }

    const $ = cheerio.load(data);

    // 适配普通列表与异步 block_id 返回结构
    const items = $('.video-img-box').length > 0 
        ? $('.video-img-box') 
        : $('#list_videos_common_videos_list .container .row > div');

    items.each((_, element) => {
        const $el = $(element);
        const aTitle = $el.find('.title a');
        const href = aTitle.attr('href') || $el.find('.img-box a').attr('href');
        const title = aTitle.text().trim();
        const img = $el.find('.img-box img');
        const cover = img.attr('data-src') || img.attr('src');
        const duration = $el.find('.label').text().trim();
        const views = $el.find('.sub-title').text().trim();

        if (href && title) {
            cards.push({
                vod_id: href,
                vod_name: title,
                vod_pic: cover,
                vod_duration: duration,
                vod_remarks: duration || views,
                ext: {
                    url: href.startsWith('http') ? href : `${appConfig.site}${href}`
                }
            });
        }
    });

    return jsonify({
        list: cards
    });
}

async function getTracks(ext) {
    ext = argsify(ext);
    let tracks = [];
    let url = ext.url;

    const { data } = await $fetch.get(url, {
        headers: {
            'User-Agent': UA
        }
    });

    if (data && data.includes('Just a moment...')) {
        $utils.openSafari(url, UA);
        return jsonify({ list: [] });
    }

    // 正则精准匹配详情页中的 hlsUrl 直链
    let playUrl = '';
    const hlsMatch = data.match(/var\s+hlsUrl\s*=\s*['"]([^'"]+)['"]/i) || data.match(/hlsUrl\s*=\s*['"]([^'"]+)['"]/i);
    if (hlsMatch) {
        playUrl = hlsMatch[1];
    } else {
        const m3u8Match = data.match(/(https?:\/\/[^'"]+\.m3u8[^'"]*)/i);
        if (m3u8Match) {
            playUrl = m3u8Match[1];
        }
    }

    if (playUrl) {
        tracks.push({
            name: '原画 1080P/4K (HLS)',
            pan: '',
            ext: {
                url: playUrl
            }
        });
    }

    return jsonify({
        list: [
            {
                title: '默认直连',
                tracks
            }
        ]
    });
}

async function getPlayinfo(ext) {
    ext = argsify(ext);
    const url = ext.url;

    return jsonify({
        urls: [url],
        headers: [
            {
                'User-Agent': UA,
                'Referer': 'https://jable.tv/'
            }
        ]
    });
}

async function search(ext) {
    ext = argsify(ext);
    let cards = [];
    let text = encodeURIComponent(ext.text || '');
    let page = ext.page || 1;

    let url = `${appConfig.site}/search/${text}/${page}/`;

    const { data } = await $fetch.get(url, {
        headers: {
            'User-Agent': UA
        }
    });

    if (data && data.includes('Just a moment...')) {
        $utils.openSafari(url, UA);
        return jsonify({ list: [] });
    }

    const $ = cheerio.load(data);
    const items = $('.video-img-box').length > 0 
        ? $('.video-img-box') 
        : $('#list_videos_videos_list_search_result .container .row > div');

    items.each((_, element) => {
        const $el = $(element);
        const aTitle = $el.find('.title a');
        const href = aTitle.attr('href') || $el.find('.img-box a').attr('href');
        const title = aTitle.text().trim();
        const img = $el.find('.img-box img');
        const cover = img.attr('data-src') || img.attr('src');
        const duration = $el.find('.label').text().trim();

        if (href && title) {
            cards.push({
                vod_id: href,
                vod_name: title,
                vod_pic: cover,
                vod_duration: duration,
                vod_remarks: duration,
                ext: {
                    url: href.startsWith('http') ? href : `${appConfig.site}${href}`
                }
            });
        }
    });

    return jsonify({
        list: cards
    });
}
