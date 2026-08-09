/**
 * LUOGU TRAINER · Cloudflare Worker 代理
 * ----------------------------------------------------------------
 * 作用：
 *   1. 解决浏览器跨域（CORS）——为所有响应加上 Access-Control-Allow-Origin
 *   2. 携带洛谷登录 Cookie 获取题解页（思路 + 参考代码）
 *
 * 部署步骤：
 *   1. 注册 https://dash.cloudflare.com （免费）
 *   2. Workers & Pages → 创建 Worker → 粘贴本文件 → 部署
 *   3. 部署后在 设置→域名和路由 可绑定自定义域名（可选）
 *   4. 把 Worker 地址填进工具「高级设置 → Worker 代理地址」
 *
 * 调用方式：
 *   GET  https://<你的-worker>.workers.dev/?url=<目标URL编码>
 *   可选请求头 X-Luogu-Cookie: __client_id=xxx; _uid=xxx; ...（原样转发为 Cookie）
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // 目标地址：?url= 参数，未提供则把 Worker 自身路径原样转发到洛谷
    let target = url.searchParams.get('url');
    if (!target) {
      // 直接访问 Worker 根路径：返回使用说明，而不是转发洛谷首页
      if (url.pathname === '/' || url.pathname === '') {
        return new Response(
          '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>Luogu Trainer 代理</title>' +
          '<meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<style>body{font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;background:#0a0e14;color:#e6edf7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}code{background:#111826;padding:2px 8px;border-radius:6px;border:1px solid #2b3b55}.card{max-width:640px;padding:40px;border:1px solid #2b3b55;border-radius:16px;background:#111826}h1{font-size:22px;color:#4de68c}p{line-height:1.8;color:#8b9bb4}a{color:#4de68c}</style>' +
          '</head><body><div class="card">' +
          '<h1>Luogu Trainer · Cloudflare Worker 代理</h1>' +
          '<p>这是 <b>洛谷刷题训练舱</b> 的后端代理（解决 CORS + 携带登录 Cookie 获取题解），不是工具本身。</p>' +
          '<p>工具前端：<a href="https://fensoge.github.io/luogu-trainer/" target="_blank" rel="noopener">fensoge.github.io/luogu-trainer/</a></p>' +
          '<p>调用方式：<code>/?url=&lt;洛谷地址URL编码&gt;</code>，可选请求头 <code>X-Luogu-Cookie</code>。</p>' +
          '</div></body></html>',
          { status: 200, headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
      target = 'https://www.luogu.com.cn' + url.pathname + url.search;
    }

    // 安全：只允许访问洛谷相关域名，防止代理被滥用
    const host = (() => { try { return new URL(target).hostname; } catch (e) { return ''; } })();
    if (!host.endsWith('luogu.com.cn') && !host.endsWith('cdn.luogu.com.cn')) {
      return new Response(JSON.stringify({ error: 'proxy only for luogu.com.cn' }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const cookie = request.headers.get('X-Luogu-Cookie') || url.searchParams.get('cookie') || '';

    const headers = {
      'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'text/html,application/json,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Referer': 'https://www.luogu.com.cn/',
    };
    if (cookie) headers['Cookie'] = cookie;

    try {
      const resp = await fetch(target, {
        headers,
        redirect: 'follow',
        cf: { cacheTtl: 0 },
      });
      const body = await resp.arrayBuffer();
      const out = new Response(body, { status: resp.status });
      out.headers.set('Access-Control-Allow-Origin', '*');
      out.headers.set('Cache-Control', 'no-store');
      const ct = resp.headers.get('Content-Type');
      if (ct) out.headers.set('Content-Type', ct);
      return out;
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  },
};
