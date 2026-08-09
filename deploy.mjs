// 临时部署脚本：用 undici ProxyAgent 走本地代理上传 Worker（复刻 wrangler 的 multipart 请求）
import { ProxyAgent } from 'undici';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN = process.env.CF_TOKEN;
const ACCOUNT = process.env.CF_ACCOUNT;
if (!TOKEN || !ACCOUNT) { console.error('need CF_TOKEN & CF_ACCOUNT env'); process.exit(1); }

const proxy = new ProxyAgent('http://127.0.0.1:7897');
const fd = new FormData();
fd.append('metadata', new Blob(
  [JSON.stringify({ main_module: 'worker.js', compatibility_date: '2026-07-01' })],
  { type: 'application/json' }
));
fd.append('script', new Blob([readFileSync(join(HERE, 'worker.js'))], { type: 'application/javascript+module' }), 'worker.js');

const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/luogu-trainer-proxy`;
const res = await fetch(url, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${TOKEN}` },
  body: fd,
  dispatcher: proxy,
});
const text = await res.text();
console.log('http', res.status);
console.log(text.slice(0, 900));
