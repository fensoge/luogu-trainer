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
