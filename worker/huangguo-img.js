/**
 * 黄果短剧封面解密代理 —— Cloudflare Worker
 * ---------------------------------------------------------------------------
 * 站点封面图（pic.tuafjz.cn）是 AES-128-CBC 加密字节，XPTV 端解不了，
 * 由本 Worker 在边缘侧解密后原样吐给 XPTV。
 *
 *   key = "f5d965df75336270"   iv = "97b60394abc2fbe1"
 *   —— 注意：是这 16 个字符本身的 ASCII 字节（16 bytes），不是 hex 解码（那是 8 bytes，
 *      AES-128 会直接报 Invalid key length）。初版注释里写的 CryptoJS.enc.Hex.parse 是错的。
 *   明文为 PNG / JPEG，PKCS7 padding，Web Crypto 的 AES-CBC 自带解 padding。
 *
 * 用法：
 *   https://<你的域名>/?u=<encodeURIComponent(原始图片URL)>
 *
 * 部署：
 *   npx wrangler deploy worker/huangguo-img.js --name huangguo-img
 *   或在 Cloudflare Dashboard → Workers & Pages → 创建 Worker → 粘贴本文件 → 部署
 *
 * 部署后把地址填进 js/huangguo.js 顶部的 IMG_PROXY，例如：
 *   const IMG_PROXY = 'https://huangguo-img.<你的子域>.workers.dev/?u='
 */

const KEY_HEX = 'f5d965df75336270'
const IV_HEX = '97b60394abc2fbe1'

// 只允许代理这几个图床，避免被当成公开代理刷
const ALLOW_HOSTS = ['pic.tuafjz.cn', 'huangguoai.com', 'www.huangguoai.com']

const CACHE_TTL = 86400

const enc = new TextEncoder()
const KEY = enc.encode(KEY_HEX) // 16 bytes ASCII
const IV = enc.encode(IV_HEX)   // 16 bytes ASCII

function sniffMime(b) {
  if (!b || b.length < 12) return 'application/octet-stream'
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  return 'application/octet-stream'
}

function isImageMagic(b) {
  return sniffMime(b) !== 'application/octet-stream'
}

async function decryptImage(bytes) {
  // 长度非 16 倍数 → 源图没加密，原样返回
  if (!bytes || bytes.length === 0 || bytes.length % 16 !== 0) return bytes

  const key = await crypto.subtle.importKey(
    'raw', KEY, { name: 'AES-CBC' }, false, ['decrypt']
  )

  let plain
  try {
    plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-CBC', iv: IV }, key, bytes)
    )
  } catch (e) {
    // padding 非法 → 不是这座站的加密图，原样返回
    return bytes
  }

  if (!isImageMagic(plain)) return bytes
  return plain
}

export default {
  async fetch(request, env, ctx) {
    const reqUrl = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      })
    }

    // 同时认 /?u=xxx 和 /hg?u=xxx 两种写法
    const raw = reqUrl.searchParams.get('u') || reqUrl.searchParams.get('url')

    // 没带参数时给一个自检页，方便部署后确认 Worker 活着
    if (!raw) {
      return new Response(
        'huangguo-img worker is up.\nusage: /?u=<encodeURIComponent(imageUrl)>\n',
        { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } }
      )
    }

    let target
    try {
      target = decodeURIComponent(raw)
    } catch (e) {
      target = raw
    }

    let tUrl
    try {
      tUrl = new URL(target)
    } catch (e) {
      return new Response('bad url', { status: 400 })
    }
    if (tUrl.protocol !== 'https:' && tUrl.protocol !== 'http:') {
      return new Response('bad scheme', { status: 400 })
    }
    if (ALLOW_HOSTS.indexOf(tUrl.hostname) === -1) {
      return new Response('host not allowed', { status: 403 })
    }

    // 上游图片是加密字节、且 URL 带会过期的 auth_key，
    // 用 URL 整体做缓存键即可：同一张图在同一次 auth_key 有效期内复用缓存。
    // Cloudflare 边缘缓存；非 CF 运行时（本地自测）自动跳过
    // 缓存键剥掉 query：auth_key 每次都变，但同一路径的图片内容是稳定的，
    // 不剥 query 会导致永远不命中缓存（每张封面 1.6~2.7 MB，很痛）。
    const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null
    const cacheKeyUrl = reqUrl.origin + reqUrl.pathname + '?u=' + encodeURIComponent(tUrl.origin + tUrl.pathname)
    const cacheKey = new Request(cacheKeyUrl, { method: 'GET' })
    if (cache) {
      const hit = await cache.match(cacheKey)
      if (hit) return hit
    }

    const upstream = await fetch(tUrl.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://huangguoai.com/',
        'Accept-Encoding': 'identity',
      },
      cf: { cacheEverything: true, cacheTtl: CACHE_TTL },
    })

    if (!upstream.ok) {
      return new Response('upstream ' + upstream.status, { status: 502 })
    }

    const buf = new Uint8Array(await upstream.arrayBuffer())
    const out = await decryptImage(buf)

    const resp = new Response(out, {
      status: 200,
      headers: {
        'content-type': sniffMime(out),
        'cache-control': 'public, max-age=' + CACHE_TTL + ', immutable',
        'access-control-allow-origin': '*',
        'x-hg-decrypted': out !== buf && out.length !== buf.length ? '1' : '0',
        'x-hg-size': String(out.length),
      },
    })

    if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, resp.clone()))
    return resp
  },
}
