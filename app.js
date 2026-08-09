'use strict';
/* ============================================================
   LUOGU TRAINER · 核心逻辑
   数据源：洛谷匿名接口（lentille-context）+ 可配置代理
   ============================================================ */

/* ---------- 常量 ---------- */
const DIFFS = [
  { id: 0, name: '暂无评定', cfLo: 0,  cfHi: 800 },
  { id: 1, name: '入门',     cfLo: 0,  cfHi: 800 },
  { id: 2, name: '普及−',     cfLo: 800, cfHi: 1200 },
  { id: 3, name: '普及',     cfLo: 1200, cfHi: 1600 },
  { id: 4, name: '普及+/提高−', cfLo: 1600, cfHi: 1900 },
  { id: 5, name: '提高',     cfLo: 1900, cfHi: 2200 },
  { id: 6, name: '提高+/省选−', cfLo: 2200, cfHi: 2500 },
  { id: 7, name: '省选/NOI−', cfLo: 2500, cfHi: 3000 },
  { id: 8, name: 'NOI/NOI+/CTSC', cfLo: 3000, cfHi: 9999 },
];
const DIFF_COLOR = ['var(--d0)','var(--d1)','var(--d2)','var(--d3)','var(--d4)','var(--d5)','var(--d6)','var(--d7)','var(--d8)'];
const LANG_MAP = {
  cpp:   ['cpp','c++','c','cc','cxx'],
  py:    ['python','py','python3','pypy'],
  java:  ['java'],
};
const LS_SETTINGS = 'lt.settings.v1';
const LS_SESSION  = 'lt.session.v1';

/* ---------- 状态 ---------- */
const S = {
  // 配置
  diffMode: 'luogu',        // luogu | cf
  diffs: new Set(),         // 已选洛谷难度 id
  cfLo: 1200, cfHi: 1600,   // CF 区间
  tags: new Set(),          // 已选 tag id
  keyword: '',
  n: 4,
  t1: 45, t2: 25,           // 分钟
  lang: 'cpp',              // cpp | py | any
  goal: '',
  cookie: '',
  proxyMode: 'auto',
  workerUrl: '',
  // 运行期
  allTags: [],              // 全部算法标签
  tagNames: {},             // id -> name
  session: null,            // 当前训练会话
  timer: null,              // interval id
  pausedRemain: 0,
  bgQueue: null,
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

function toast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.hidden = false;
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.hidden = true; }, type === '' ? 2600 : 4200);
}

/* ---------- 本地持久化 ---------- */
function saveSettings() {
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify({
      diffMode: S.diffMode, diffs: [...S.diffs], cfLo: S.cfLo, cfHi: S.cfHi,
      tags: [...S.tags], keyword: S.keyword, n: S.n, t1: S.t1, t2: S.t2,
      lang: S.lang, goal: S.goal, cookie: S.cookie, proxyMode: S.proxyMode, workerUrl: S.workerUrl,
    }));
  } catch (e) { /* localStorage 不可用时忽略 */ }
}
function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return;
    const d = JSON.parse(raw);
    S.diffMode = d.diffMode || 'luogu';
    S.diffs = new Set(d.diffs || []);
    if (d.cfLo != null) S.cfLo = d.cfLo;
    if (d.cfHi != null) S.cfHi = d.cfHi;
    S.tags = new Set(d.tags || []);
    S.keyword = d.keyword || '';
    if (d.n) S.n = d.n;
    if (d.t1) S.t1 = d.t1;
    if (d.t2) S.t2 = d.t2;
    S.lang = d.lang || 'cpp';
    S.goal = d.goal || '';
    S.cookie = d.cookie || '';
    S.proxyMode = d.proxyMode || 'auto';
    S.workerUrl = d.workerUrl || '';
  } catch (e) { /* 忽略损坏的配置 */ }
}

/* ============================================================
   网络层：代理链
   直连 → allorigins → 自定义 Worker，逐级降级；cookie 仅走 Worker
   ============================================================ */
const PROXY_LIST = [
  { key: 'direct', label: '直连', wrap: (u) => u, headers: () => ({}) },
  {
    key: 'jina', label: 'jina',
    wrap: (u) => 'https://r.jina.ai/' + encodeURIComponent(u),
    headers: () => ({ 'X-Return-Format': 'html' }),
  },
  {
    key: 'allorigins', label: 'allorigins',
    wrap: (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    headers: () => ({}),
  },
  {
    key: 'worker', label: 'Worker',
    wrap: (u) => (S.workerUrl ? S.workerUrl + '?url=' + encodeURIComponent(u) : null),
    headers: (cookie) => (cookie ? { 'X-Luogu-Cookie': cookie } : {}),
  },
];
let proxyOrder = null; // 缓存当前可用的代理顺序

async function fetchText(url, opts = {}) {
  const { cookie, timeout = 22000, workerOnly = false, expect = null } = opts;
  let order;
  if (workerOnly) {
    // 题解等需要登录态的资源：只走自定义 Worker
    order = S.workerUrl ? ['worker'] : [];
    if (!order.length) { const e = new Error('NEED_LOGIN'); e.code = 'NEED_LOGIN'; throw e; }
  } else if (S.proxyMode === 'direct') order = ['direct'];
  else if (S.proxyMode === 'allorigins') order = ['allorigins'];
  else if (S.proxyMode === 'worker') order = ['worker'];
  else {
    // 自动：优先可用代理缓存；无缓存时按内容类型分流
    // JSON 接口（tags）jina 会包成 HTML，故 allorigins 优先；HTML 页面 jina 更稳
    if (proxyOrder && proxyOrder.length) order = proxyOrder;
    else if (expect === 'json') order = ['allorigins', 'jina', 'direct'];
    else {
      order = [];
      if (S.workerUrl) order.push('worker');
      order.push('jina', 'allorigins', 'direct');
    }
  }
  let lastErr = null;
  const maxAttempts = (key) => key === 'allorigins' ? 4 : 2;
  for (const key of order) {
    const p = PROXY_LIST.find(x => x.key === key);
    if (!p) continue;
    for (let attempt = 0; attempt < maxAttempts(key); attempt++) {
      if (attempt) await sleep(1200 + attempt * 900);
      let target;
      try { target = p.wrap(url); } catch (e) { break; }
      if (!target) break;
      try {
        const headers = p.headers(cookie);
        const res = await fetch(target, { headers, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
        if (res.status === 401) {
          const e = new Error('NEED_LOGIN');
          e.code = 'NEED_LOGIN';
          throw e;
        }
        if (!res.ok) { lastErr = new Error('HTTP ' + res.status); continue; }
        const text = await res.text();
        // 内容类型校验：代理返回的可能是错误页/验证页，需换下一个代理
        const bad = text.length < 200 && !text.includes('{');
        const badJson = expect === 'json' && !/^\s*[\[{]/.test(text);
        const badHtml = typeof expect === 'string' && expect === 'html' && !/<html|<!doctype/i.test(text) && !text.trim().startsWith('{');
        const badFn = typeof expect === 'function' && !expect(text);
        if (bad || badJson || badHtml || badFn) { lastErr = new Error('响应格式异常'); continue; }
        if (S.proxyMode === 'auto') proxyOrder = [key, ...order.filter(k => k !== key)];
        return text;
      } catch (e) {
        lastErr = e;
        if (e.code === 'NEED_LOGIN') break;
      }
    }
  }
  if (lastErr && lastErr.code === 'NEED_LOGIN') throw lastErr;
  throw lastErr || new Error('所有代理均失败');
}

/* ============================================================
   洛谷数据层
   ============================================================ */
function extractLentille(html) {
  const m = html.match(/<script id="lentille-context" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

async function fetchTags() {
  const html = await fetchText('https://www.luogu.com.cn/_lfe/tags/zh-CN', { timeout: 15000, expect: 'json' });
  const d = JSON.parse(html);
  S.allTags = (d.tags || []).filter(t => t.type === 2).sort((a, b) => (a.name || '').localeCompare(b.name, 'zh'));
  S.tagNames = {};
  for (const t of d.tags || []) S.tagNames[t.id] = t.name;
}

// 获取一页题目（服务端按 difficulty / 单个 tag / keyword 筛选）
async function fetchListPage(page, { difficulty, tag, keyword } = {}) {
  const q = new URLSearchParams({ page: String(page) });
  if (difficulty != null) q.set('difficulty', String(difficulty));
  if (tag) q.set('tag', String(tag));
  if (keyword) q.set('keyword', keyword);
  const html = await fetchText('https://www.luogu.com.cn/problem/list?' + q.toString(), { timeout: 25000, expect: (t) => t.includes('lentille-context') });
  const d = extractLentille(html);
  if (!d || !d.data || !d.data.problems) throw new Error('题目列表解析失败（可能被代理拦截）');
  return d.data.problems;
}

// 拉取足够候选并过滤
async function collectProblems(difficultyIds, tagIds, keyword, need) {
  const want = Math.max(need * 6, 24);
  const pool = [];
  const firstTag = tagIds.length ? tagIds[0] : null;
  const restTags = tagIds.slice(1);
  for (const diff of difficultyIds) {
    let page = 1, got = 0, total = null;
    while (page <= 30) {
      const res = await fetchListPage(page, { difficulty: diff, tag: firstTag, keyword });
      total = res.count;
      got += res.result.length;
      for (const p of res.result) if (!pool.find(x => x.pid === p.pid)) pool.push(p);
      if (got >= total || pool.length >= want) break;
      page++;
    }
  }
  // 客户端过滤其余标签
  let matched;
  if (restTags.length) {
    matched = pool.filter(p => restTags.every(t => (p.tags || []).includes(t)));
    if (matched.length < need) {
      // 放宽为“任一”
      const relaxed = pool.filter(p => restTags.some(t => (p.tags || []).includes(t)));
      if (relaxed.length > matched.length) matched = relaxed;
    }
  } else {
    matched = pool;
  }
  matched = matched || [];
  if (!pool.length) throw new Error('没有符合条件的题目，请放宽难度/标签/关键词');
  return shuffle(matched).slice(0, need);
}
/* ---------- 题解处理：思路（去代码）+ 参考代码 ---------- */
function sanitizeHtml(html) {
  // 移除危险标签与事件属性
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  return s;
}

function langOfCodeClass(cls) {
  const m = String(cls || '').match(/language-([\w+-]+)/i);
  if (!m) return null;
  let l = m[1].toLowerCase();
  for (const [k, arr] of Object.entries(LANG_MAP)) if (arr.includes(l)) return k;
  return 'other';
}

// 将内容（旧版 HTML 字符串 / 新版结构化 markdown 对象）统一转成 HTML
function contentToHtml(content, isProblem) {
  if (typeof content === 'string') return content; // 旧格式：已是 HTML
  if (content && typeof content === 'object') {
    const fields = isProblem
      ? [['background', '题目背景'], ['description', '题目描述'], ['formatI', '输入格式'], ['formatO', '输出格式'], ['hint', '提示']]
      : [['description', '题解'], ['content', '题解'], ['hint', '提示']];
    const md = fields
      .filter(([k]) => typeof content[k] === 'string' && content[k])
      .map(([k, title]) => '## ' + title + '\n\n' + content[k])
      .join('\n\n');
    if (md) return mdToHtml(md);
    // 未知结构：原样展示
    return '<pre class="dim">' + esc(JSON.stringify(content, null, 2)) + '</pre>';
  }
  return '';
}
function mdToHtml(md) {
  if (window.marked && marked.parse) { try { return marked.parse(md); } catch (e) {} }
  return '<pre>' + esc(md) + '</pre>';
}

// 渲染增强：KaTeX 公式 + 代码高亮
function enhanceContent(root) {
  try {
    if (window.renderMathInElement) {
      renderMathInElement(root, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
        ],
        throwOnError: false,
      });
    }
  } catch (e) {}
  try {
    if (window.hljs) root.querySelectorAll('pre code').forEach(el => { try { hljs.highlightElement(el); } catch (e) {} });
  } catch (e) {}
}

// 将题解内容拆成 { thoughtHtml, codes: [{lang, text}] }
// 新版洛谷题解 content 为 markdown 文本（含 ```lang 代码围栏）；兼容旧版 HTML
function splitSolution(content) {
  if (typeof content === 'object') {
    // 结构化对象：拼成 markdown
    const parts = [];
    for (const [k, title] of [['description', '题解'], ['content', '题解'], ['hint', '提示']]) {
      if (typeof content[k] === 'string' && content[k]) parts.push('## ' + title + '\n\n' + content[k]);
    }
    content = parts.join('\n\n');
  }
  if (typeof content !== 'string' || !content.trim()) return { thoughtHtml: '', codes: [] };
  if (!content.includes('```')) {
    // 旧格式：HTML
    return splitHtmlSolution(content);
  }
  // markdown 格式：剥代码围栏
  const codes = [];
  let codeCount = 0;
  const thoughtMd = content.replace(/```([a-zA-Z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)(?:\r?\n)?```/g, (m, lang, code) => {
    codeCount++;
    const l = langOfFence(lang);
    codes.push({ lang: l, text: code.replace(/\r\n/g, '\n').trim() });
    return `<div class="code-removed">（第 ${codeCount} 段参考代码已隐藏 · ${esc(l)}）</div>`;
  });
  return { thoughtHtml: sanitizeHtml(mdToHtml(thoughtMd)), codes };
}

function langOfFence(lang) {
  const l = String(lang || '').toLowerCase();
  for (const [k, arr] of Object.entries(LANG_MAP)) if (arr.includes(l)) return k;
  return l || 'other';
}

function splitHtmlSolution(content) {
  let html = sanitizeHtml(contentToHtml(content, false) || '');
  const codes = [];
  html = html.replace(/<pre[\s\S]*?<\/pre>/gi, (block) => {
    const codeEl = block.match(/<code[^>]*>([\s\S]*?)<\/code>/i);
    const text = codeEl ? codeEl[1] : block;
    const clsMatch = block.match(/<pre[^>]*class="([^"]*)"/i) || block.match(/<code[^>]*class="([^"]*)"/i);
    const lang = langOfCodeClass(clsMatch ? clsMatch[1] : '');
    const plain = text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
    codes.push({ lang, text: plain.trim() });
    return '<div class="code-removed">（参考代码已隐藏 —— 第三阶段再解锁）</div>';
  });
  return { thoughtHtml: html, codes };
}

// 标签关键词 → 用于在题解内容中匹配"做法与所选标签一致"的题解
const TAG_ALIAS = {
  '动态规划': ['dp', '动规', '动态规划', '背包', '区间dp'],
  '单调性': ['单调', '尺取', '双指针', '二分', '单调栈', '单调队列'],
  '图论': ['图论', '最短路', 'dfs', 'bfs', '树上', '树', '图'],
  '贪心': ['贪心', '排序'],
  '数学': ['数学', '数论', '组合', 'gcd', '质数'],
  '搜索': ['搜索', 'dfs', 'bfs', '回溯', '剪枝'],
  '字符串': ['字符串', 'kmp', 'hash', '哈希', 'trie'],
  '数据结构': ['数据结构', '线段树', '树状数组', '平衡树', 'st表', '堆'],
  '模拟': ['模拟', '暴力'],
  '分治': ['分治', 'cdq', '整体二分'],
  '博弈论': ['博弈', 'sg', 'nim'],
  '计算几何': ['几何', '凸包', '扫描线'],
  '数论': ['数论', 'gcd', '质数', '逆元', '欧拉'],
  '并查集': ['并查集', 'dSU'],
  '最短路': ['最短路', 'dijkstra', 'spfa', 'floyd', 'bellman'],
  '最小生成树': ['最小生成树', 'kruskal', 'prim', 'mst'],
  '网络流': ['网络流', 'dinic', '最大流', '费用流'],
};
function buildTagKeywords(tagNames) {
  const out = [];
  for (const t of tagNames) {
    const n = String(t || '').toLowerCase();
    if (!n) continue;
    out.push(n);
    (TAG_ALIAS[n] || []).forEach(a => out.push(a.toLowerCase()));
  }
  return out;
}

async function fetchSolution(pid, tagNames = []) {
  // 题解页需要登录态，只走自定义 Worker 代理（jina/allorigins 无法携带 Cookie）
  const html = await fetchText('https://www.luogu.com.cn/problem/solution/' + pid, { cookie: S.cookie, workerOnly: true, timeout: 25000, expect: (t) => t.includes('lentille-context') });
  const d = extractLentille(html);
  if (!d) throw new Error('题解页解析失败');
  const err = d.data && (d.data.errorCode || (d.data.error && d.data.error.code));
  if (d.status === 401 || err === 401) { const e = new Error('NEED_LOGIN'); e.code = 'NEED_LOGIN'; throw e; }
  // 新版结构：data.solutions.result[]；旧版兼容：data.solution
  let sol = null;
  if (d.data && Array.isArray(d.data.solutions && d.data.solutions.result) && d.data.solutions.result.length) {
    const list = d.data.solutions.result.filter(s => s && s.content && s.content.trim().length > 30);
    if (list.length) {
      const kws = buildTagKeywords(tagNames);
      const scored = list.map(s => {
        const text = ((s.content || '') + '\n' + (s.title || '')).toLowerCase();
        const hits = kws.filter(k => text.includes(k)).length;
        // 命中一个关键词 ≈ 抵 600 赞；同分时赞多的优先
        return { s, score: (s.upvote || 0) + hits * 600, hits };
      });
      scored.sort((a, b) => b.score - a.score || (b.s.upvote || 0) - (a.s.upvote || 0));
      sol = scored[0].s;
    }
  } else if (d.data && d.data.solution) {
    sol = d.data.solution;
  }
  if (!sol) throw new Error('该题暂无可用题解');
  const content = sol.content || sol.contents || '';
  let author = '';
  if (typeof sol.author === 'string') { try { author = (JSON.parse(sol.author) || {}).name || ''; } catch (e) {} }
  else if (sol.author && typeof sol.author === 'object') author = sol.author.name || sol.author.nickname || '';
  const { thoughtHtml, codes } = splitSolution(content);
  return { pid, title: sol.title || '', author, thoughtHtml, codes, fetchedAt: Date.now() };
}

// 获取题面（惰性加载用）
async function fetchProblemContent(pid) {
  const html = await fetchText('https://www.luogu.com.cn/problem/' + pid, { timeout: 25000, expect: (t) => t.includes('lentille-context') });
  const d = extractLentille(html);
  if (!d || !d.data || !d.data.problem) throw new Error('题面解析失败');
  const pr = d.data.problem;
  let out = sanitizeHtml(contentToHtml(pr.content, true) || '');
  // 样例
  if (Array.isArray(pr.samples) && pr.samples.length) {
    const md = pr.samples.map((s, i) => {
      const inp = String(s[0] || '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
      const outp = String(s[1] || '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
      return `## 样例 #${i + 1}\n\n**输入**\n\n\`\`\`text\n${inp}\n\`\`\`\n\n**输出**\n\n\`\`\`text\n${outp}\n\`\`\``;
    }).join('\n\n');
    out += mdToHtml(md);
  }
  // 数据范围提示（limits 说明通常已在 hint 中）
  return out;
}

/* ---------- 声音与通知 ---------- */
let audioCtx = null;
function beep(seq) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    (seq || [[880, .18], [660, .18], [880, .3]]).forEach(([f, dur], i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(.0001, t0 + i * .22);
      g.gain.exponentialRampToValueAtTime(.18, t0 + i * .22 + .02);
      g.gain.exponentialRampToValueAtTime(.0001, t0 + i * .22 + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t0 + i * .22); o.stop(t0 + i * .22 + dur + .05);
    });
  } catch (e) { /* 音频不可用忽略 */ }
}
function notify(title, body) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    new Notification(title, { body });
  } catch (e) { /* ignore */ }
}

/* ============================================================
   配置面板渲染与交互
   ============================================================ */
function renderDiffChips() {
  const box = $('diffChips');
  box.innerHTML = '';
  for (const d of DIFFS) {
    const el = document.createElement('span');
    el.className = 'chip' + (S.diffs.has(d.id) ? ' on' : '');
    el.style.borderColor = S.diffs.has(d.id) ? 'transparent' : DIFF_COLOR[d.id];
    el.textContent = d.name;
    el.onclick = () => {
      S.diffs.has(d.id) ? S.diffs.delete(d.id) : S.diffs.add(d.id);
      renderDiffChips(); saveSettings();
    };
    box.appendChild(el);
  }
}

function cfToDiffs(lo, hi) {
  return DIFFS.filter(d => d.id !== 0 && d.cfLo < hi && d.cfHi > lo).map(d => d.id);
}
function renderCfResult() {
  const box = $('cfResult');
  const ids = cfToDiffs(S.cfLo, S.cfHi);
  box.hidden = false;
  box.innerHTML = ids.map(id => `<span class="chip on small">${esc(DIFFS.find(d => d.id === id).name)}</span>`).join('');
}

function renderTagChips(filter = '') {
  const box = $('tagChips');
  if (!S.allTags.length) { box.innerHTML = '<span class="chip-pending">标签加载中…</span>'; return; }
  const f = filter.trim().toLowerCase();
  const list = S.allTags.filter(t => !f || (t.name || '').toLowerCase().includes(f));
  if (!list.length) { box.innerHTML = '<span class="chip-pending">无匹配标签</span>'; return; }
  box.innerHTML = '';
  for (const t of list) {
    const el = document.createElement('span');
    el.className = 'chip small' + (S.tags.has(t.id) ? ' on' : '');
    el.textContent = t.name;
    el.onclick = () => {
      S.tags.has(t.id) ? S.tags.delete(t.id) : S.tags.add(t.id);
      renderTagChips($('tagSearch').value); saveSettings();
    };
    box.appendChild(el);
  }
}

async function loadTags() {
  const render = () => { renderTagChips($('tagSearch').value); $('tagPickHint').textContent = '已加载 ' + S.allTags.length + ' 个算法标签；多选时首个标签走服务端，其余本地过滤。'; };
  try {
    await fetchTags();
    render();
  } catch (e) {
    // 自动重试一次（公共代理偶发坏响应）
    try {
      await sleep(1500);
      await fetchTags();
      render();
      return;
    } catch (e2) { /* 落到底部错误提示 */ }
    $('tagChips').innerHTML = '<span class="chip-pending">标签加载失败：' + esc(e.message) + '（可点「网络自检」查看代理连通性，稍后重试）</span>';
  }
}

function setSeg(container, value) {
  container.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === value || b.dataset.lang === value));
}

/* ---------- 网络自检 ---------- */
async function netSelfTest() {
  const el = $('netStatus');
  el.textContent = '自检中…';
  const savedMode = S.proxyMode;
  const results = [];
  for (const p of PROXY_LIST) {
    if (p.key === 'worker' && !S.workerUrl) { results.push('Worker: 未配置'); continue; }
    try {
      S.proxyMode = p.key;
      const t = await fetchText('https://www.luogu.com.cn/_lfe/tags/zh-CN', { timeout: 12000, expect: 'json' });
      let ok = false;
      try { ok = !!(JSON.parse(t) && JSON.parse(t).tags); } catch (e) { ok = false; }
      results.push(`${p.label}: ${ok ? '✅' : '⚠️'}`);
    } catch (e) {
      results.push(`${p.label}: ${e.code === 'NEED_LOGIN' ? '需登录' : '❌'}`);
    }
  }
  S.proxyMode = savedMode;
  el.textContent = '自检完成 —— ' + results.join('　');
}
/* ============================================================
   训练会话：状态机 + 倒计时 + 后台题解抓取 + 渲染
   ============================================================ */
const PHASE_INFO = {
  solving:  { n: 'P1', label: '独立思考', badge: 'P1 · 独立思考中' },
  thinking: { n: 'P2', label: '理解实现', badge: 'P2 · 理解思路中' },
  coding:   { n: 'P3', label: '代码复盘', badge: 'P3 · 复盘完成' },
  done:     { n: '✓', label: '完成',     badge: '✓ 本轮训练完成' },
};
const RING_C = 2 * Math.PI * 100;

function saveSession() {
  try { if (S.session) localStorage.setItem(LS_SESSION, JSON.stringify(S.session)); } catch (e) {}
}
function clearSession() {
  S.session = null;
  try { localStorage.removeItem(LS_SESSION); } catch (e) {}
}

/* ---------- 倒计时 ---------- */
function stopTimer() {
  if (S.timer) { clearInterval(S.timer); S.timer = null; }
}
function tickTimer() {
  const s = S.session;
  if (!s) return;
  const endAt = s.phase === 'solving' ? s.phase1EndAt : s.phase2EndAt;
  const total = s.phase === 'solving' ? s.phase1Total : s.phase2Total;
  let remain = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
  renderTimer(remain, total, s.phase === 'solving' ? '独立思考中' : '理解后实现中');
  if (remain <= 0) {
    stopTimer();
    if (s.phase === 'solving') enterThinking();
    else enterCoding();
  }
}
function startCountdown(totalSec, endAt) {
  stopTimer();
  const s = S.session;
  if (s.phase === 'solving') { s.phase1Total = totalSec; s.phase1EndAt = endAt; }
  else { s.phase2Total = totalSec; s.phase2EndAt = endAt; }
  saveSession();
  S.timer = setInterval(tickTimer, 500);
  tickTimer();
}
function renderTimer(remain, total, label) {
  const wrap = $('timerWrap');
  const timeEl = $('timerTime');
  const mm = String(Math.floor(remain / 60)).padStart(2, '0');
  const ss = String(remain % 60).padStart(2, '0');
  timeEl.textContent = `${mm}:${ss}`;
  $('timerLabel').textContent = label;
  $('timerSub').textContent = `本轮共 ${S.session.problems.length} 题`;
  const fg = $('ringFg');
  fg.style.strokeDashoffset = String(RING_C * (1 - remain / total));
  const ratio = remain / total;
  fg.classList.toggle('amber', ratio <= 0.4 && ratio > 0.15);
  fg.classList.toggle('red', ratio <= 0.15);
  wrap.classList.toggle('warn', ratio <= 0.4 && ratio > 0.15);
  wrap.classList.toggle('red', ratio <= 0.15);
}

/* ---------- 阶段切换 ---------- */
function setPhaseBadge(phase, warn) {
  const b = $('phaseBadge');
  b.hidden = false;
  b.className = 'phase-badge ' + ({ solving: 'running', thinking: 'p2', coding: 'p3', done: 'p3' }[phase] || '');
  $('phaseBadgeText').textContent = warn ? '⚠ ' + PHASE_INFO[phase].badge : PHASE_INFO[phase].badge;
}
function renderPhaseTabs() {
  const cur = S.session ? S.session.phase : null;
  ['ph1', 'ph2', 'ph3'].forEach(id => $(id).classList.remove('active', 'warn', 'done'));
  if (cur === 'solving') $('ph1').classList.add('active');
  if (cur === 'thinking') { $('ph1').classList.add('done'); $('ph2').classList.add('active'); }
  if (cur === 'coding' || cur === 'done') { $('ph1').classList.add('done'); $('ph2').classList.add('done'); $('ph3').classList.add('active'); }
}
function setCta(text, btnText, onClick) {
  const box = $('phaseCta');
  if (!text) { box.hidden = true; return; }
  box.hidden = false;
  $('phaseCtaText').innerHTML = text;
  const btn = $('phaseCtaBtn');
  btn.textContent = btnText;
  btn.onclick = onClick;
}

/* ---------- 卡片渲染 ---------- */
function diffName(id) { const d = DIFFS.find(x => x.id === id); return d ? d.name : '未知'; }
function fmtRate(p) { return p.totalSubmit ? (100 * p.totalAccepted / p.totalSubmit).toFixed(1) + '%' : '—'; }

function cardBodyHtml(p) {
  const s = S.session;
  const phase = s.phase;
  const parts = [];
  // 题面（惰性）
  parts.push(`<div class="section-title"><span class="tag">▤</span> 题面 <a href="https://www.luogu.com.cn/problem/${esc(p.pid)}" target="_blank" rel="noopener">打开洛谷原题 ↗</a></div>`);
  parts.push(`<div id="prob-${esc(p.pid)}" class="thought"><button class="btn ghost small" onclick="toggleProblemContent('${esc(p.pid)}')">显示题面</button></div>`);
  // 思路
  const thoughtInner = p.thought ? p.thought.html
    : (p.status === 'fail'
        ? `<p class="dim">获取失败：${esc(p.error === 'NEED_LOGIN'
            ? '题解需登录洛谷：请在高级设置配置 ① Worker 代理地址 ② 洛谷 Cookie（两步教程见 README）'
            : (p.error || '未知错误'))}</p><button class="btn ghost small" onclick="retrySolution('${esc(p.pid)}')">↻ 重试获取</button>`
        : '<p class="dim">（思路尚未获取）</p>');
  const thoughtBlock = `<div class="section-title"><span class="tag">💡</span> 解题思路${p.thought && p.thought.author ? ' · ' + esc(p.thought.author) : ''}</div>
    <div class="thought">${thoughtInner}</div>`;
  // 代码
  const codeBlock = `<div class="section-title"><span class="tag">⌘</span> 参考代码</div>${codesHtml(p)}`;
  if (phase === 'solving') {
    parts.push(`<div class="section-title">💡 解题思路</div><p class="dim">第一轮倒计时结束后解锁 —— 坚持独立思考 💪</p>`);
    parts.push(`<div class="section-title">⌘ 参考代码</div><p class="dim">第二轮倒计时结束后解锁。</p>`);
  } else if (phase === 'thinking') {
    parts.push(thoughtBlock);
    parts.push(`<div class="section-title">⌘ 参考代码</div><p class="dim">本轮结束后解锁。</p>`);
  } else {
    parts.push(thoughtBlock);
    parts.push(codeBlock);
  }
  return parts.join('');
}

function codesHtml(p) {
  if (!p.codes || !p.codes.length) return '<p class="dim">该题题解未提取到代码块。</p>';
  const prefer = S.lang;
  let groups = p.codes.map((c, i) => ({ ...c, i }));
  if (prefer !== 'any') {
    const pref = groups.filter(c => c.lang === prefer);
    const rest = groups.filter(c => c.lang !== prefer);
    groups = [...pref, ...rest];
  }
  if (!groups.length) groups = p.codes.map((c, i) => ({ ...c, i }));
  // 同语言多段加序号：cpp 1 / cpp 2
  const counter = {};
  const labeled = groups.map(g => {
    counter[g.lang] = (counter[g.lang] || 0) + 1;
    const label = counter[g.lang] > 1 ? `${g.lang} ${counter[g.lang]}` : g.lang;
    return { ...g, label };
  });
  const id = 'codes-' + p.pid;
  const tabs = labeled.map((c, gi) => `<span class="code-tab${gi === 0 ? ' on' : ''}" data-lang="${c.lang}" onclick="switchCodeTab('${esc(p.pid)}',${gi})">${esc(c.label)}</span>`).join('');
  const blocks = labeled.map((c, gi) =>
    `<div class="code-block" data-tab="${gi}" ${gi === 0 ? '' : 'hidden'}>
       <button class="code-copy" onclick="copyCode('${esc(p.pid)}',${c.i})">复制</button>
       <pre><code class="language-${esc(c.lang === 'other' ? 'plaintext' : c.lang)}">${esc(c.text)}</code></pre>
     </div>`).join('');
  return `<div class="code-block-wrap" id="${id}"><div class="code-tabs">${tabs}</div>${blocks}</div>`;
}

function cardStatus(p) {
  const s = S.session;
  if (s.phase === 'solving') return { cls: 'lock', text: '⏳ 思考中' };
  if (p.status === 'fetching') return { cls: 'fetching', text: '⏳ 抓取中' };
  if (p.status === 'fail') return { cls: 'fail', text: '⚠ 题解失败' };
  if (s.phase === 'thinking') return { cls: 'ready', text: '💡 思路已解锁' };
  return { cls: 'ok', text: '✅ 代码已解锁' };
}

function renderCards() {
  const s = S.session;
  const list = $('cardList');
  list.innerHTML = '';
  for (const p of s.problems) {
    const st = cardStatus(p);
    const card = document.createElement('div');
    card.className = 'card';
    card.id = 'card-' + p.pid;
    card.innerHTML = `
      <div class="card-head" onclick="toggleCard('${esc(p.pid)}')">
        <span class="pid">${esc(p.pid)}</span>
        <span class="pname">${esc(p.name)}
          <span class="diff-tag" style="background:${DIFF_COLOR[p.difficulty] || 'var(--d0)'}22;color:${DIFF_COLOR[p.difficulty] || 'var(--d0)'}">${esc(diffName(p.difficulty))}</span>
        </span>
        <span class="meta">通过率 ${fmtRate(p)}</span>
        <span class="st ${st.cls}">${st.text}</span>
      </div>
      <div class="card-body" id="body-${esc(p.pid)}" hidden></div>`;
    list.appendChild(card);
  }
  // 默认展开第一题（可关闭）
  if (s.problems.length) toggleCard(s.problems[0].pid, true);
}
window.toggleCard = function (pid, forceOpen) {
  const body = $('body-' + pid);
  if (!body) return;
  const p = S.session.problems.find(x => x.pid === pid);
  if (!p) return;
  const willOpen = forceOpen !== undefined ? forceOpen : body.hidden;
  if (willOpen) {
    body.innerHTML = cardBodyHtml(p);
    body.hidden = false;
    enhanceContent(body);
  } else {
    body.hidden = true;
  }
  p.bodyOpen = willOpen;
  saveSession();
};
window.toggleProblemContent = async function (pid) {
  const p = S.session.problems.find(x => x.pid === pid);
  if (!p) return;
  const box = $('prob-' + pid);
  if (!box) return;
  box.innerHTML = '<p class="dim">题面加载中…</p>';
  try {
    if (!p.content) p.content = await fetchProblemContent(pid);
    box.innerHTML = p.content || '<p class="dim">该题无题面内容。</p>';
    enhanceContent(box);
    saveSession();
  } catch (e) {
    box.innerHTML = '<p class="dim">题面加载失败：' + esc(e.message) + '</p>';
  }
};
window.switchCodeTab = function (pid, gi) {
  const p = S.session.problems.find(x => x.pid === pid);
  if (!p) return;
  const wrap = document.getElementById('codes-' + pid);
  if (!wrap) return;
  wrap.querySelectorAll('.code-tab').forEach((t, i) => t.classList.toggle('on', i === gi));
  wrap.querySelectorAll('.code-block').forEach((b, i) => b.hidden = i !== gi);
};
window.copyCode = function (pid, ci) {
  const p = S.session.problems.find(x => x.pid === pid);
  if (!p || !p.codes[ci]) return;
  navigator.clipboard.writeText(p.codes[ci].text).then(() => toast('已复制到剪贴板', 'ok')).catch(() => toast('复制失败', 'err'));
};

/* ---------- 后台题解抓取 ---------- */
function renderBgProgress() {
  const s = S.session;
  const box = $('bgProgress');
  if (!s || s.phase !== 'solving') { box.hidden = true; return; }
  const done = s.problems.filter(p => p.status === 'ready' || p.status === 'fail').length;
  box.hidden = false;
  $('bgFill').style.width = (100 * done / s.problems.length) + '%';
  $('bgText').textContent = `后台整理题解思路 ${done}/${s.problems.length}${s.bgLoginFail ? ' · 未登录，题解不可用' : ''}…`;
  setPhaseBadge('solving');
}
async function fetchOneSolution(pid) {
  const p = S.session.problems.find(x => x.pid === pid);
  if (!p) return;
  p.status = 'fetching';
  saveSession(); renderBgProgress(); renderCardStatus(p);
  try {
    const tagNames = (p.tags || []).map(id => S.tagNames[id]).filter(Boolean);
    const r = await fetchSolution(pid, tagNames);
    p.thought = { title: r.title, author: r.author, html: r.thoughtHtml };
    p.codes = r.codes;
    p.status = 'ready';
  } catch (e) {
    p.status = 'fail';
    p.error = e.code === 'NEED_LOGIN' ? 'NEED_LOGIN' : e.message;
    if (e.code === 'NEED_LOGIN') S.session.bgLoginFail = true;
  }
  saveSession(); renderBgProgress(); renderCardStatus(p);
}
function renderCardStatus(p) {
  const st = cardStatus(p);
  const card = $('card-' + p.pid);
  if (!card) return;
  const chip = card.querySelector('.st');
  if (chip) { chip.className = 'st ' + st.cls; chip.textContent = st.text; }
}
async function runBgFetch() {
  const s = S.session;
  s.bgLoginFail = false;
  for (const p of s.problems) {
    if (p.status === 'ready' || p.status === 'fetching') continue;
    await fetchOneSolution(p.pid);
    await sleep(350);
  }
  renderBgProgress();
  if (s.bgLoginFail) toast('未登录洛谷：题解思路与参考代码无法获取。可在高级设置粘贴 Cookie 后点击题卡“重试”。', 'warn');
}
window.retrySolution = async function (pid) {
  const p = S.session.problems.find(x => x.pid === pid);
  if (!p) return;
  p.error = null;
  await fetchOneSolution(pid);
  if (p.status === 'ready') { toast(pid + ' 题解获取成功', 'ok'); toggleCard(pid); }
  else toast('仍失败：' + (p.error || '未知错误'), 'err');
};
/* ============================================================
   会话启动与阶段流转
   ============================================================ */
async function startSession() {
  if (!S.diffs.size) { toast('请先选择难度', 'warn'); return; }
  const need = S.n;
  const btn = $('startBtn');
  btn.disabled = true;
  $('netStatus').textContent = '正在拉取题目并筛选…（每个难度页约 0.5~2s，请稍候）';
  try {
    const problems = await collectProblems([...S.diffs].sort((a, b) => a - b), [...S.tags], S.keyword.trim() || undefined, need);
    if (!problems.length) { throw new Error('没有符合条件的题目，请放宽难度/标签'); }
    const session = {
      phase: 'solving',
      problems: problems.map(p => ({
        pid: p.pid, name: p.name, difficulty: p.difficulty,
        tags: p.tags || [], totalSubmit: p.totalSubmit, totalAccepted: p.totalAccepted,
        status: 'lock', thought: null, codes: null, error: null, content: null, bodyOpen: false,
      })),
      phase1Total: S.t1 * 60, phase1EndAt: Date.now() + S.t1 * 60 * 1000,
      phase2Total: S.t2 * 60, phase2EndAt: null, paused: false, remain: 0,
      bgLoginFail: false, startedAt: Date.now(),
    };
    clearSession(); // 先清旧的
    S.session = session;
    saveSession();
    $('configPanel').hidden = true;
    $('sessionPanel').hidden = false;
    renderSession();
    startCountdown(session.phase1Total, session.phase1EndAt);
    runBgFetch();
    if (S.goal) toast('训练开始，目标：' + S.goal, 'ok');
  } catch (e) {
    const isProxyIssue = /代理|HTTP|拉取|网络|Timeout|Abort|fetch/i.test(e.message);
    const hint = isProxyIssue ? '　（公共代理偶被洛谷拦截：建议部署仓库内 worker.js 到 Cloudflare 并填进高级设置，见 README）' : '';
    $('netStatus').textContent = '拉取失败：' + e.message + hint;
    toast('拉取失败：' + e.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

function renderSession() {
  const s = S.session;
  const goal = $('goalBanner');
  goal.hidden = !S.goal;
  goal.innerHTML = S.goal ? `🎯 目标：<b>${esc(S.goal)}</b>　·　难度：${[...S.diffs].map(id => esc(diffName(id))).join(' / ')}　·　标签：${[...S.tags].map(id => esc(S.tagNames[id] || id)).join(' / ') || '不限'}` : '';
  renderPhaseTabs();
  renderCards();
  renderBgProgress();
  setPhaseBadge(s.phase);
  const paused = s.paused;
  $('pauseBtn').textContent = paused ? '▶ 继续' : '⏸ 暂停';
  $('skipBtn').textContent = '⏭ 跳过本轮';
  if (s.phase === 'thinking' && !s.phase2EndAt) {
    setCta('第一轮结束！思路已解锁。<b>请先阅读全部思路</b>，然后开始第二轮倒计时，按思路自己实现一遍。', '开始第二轮计时', startPhase2);
  } else if (s.phase === 'coding') {
    setCta('第二轮结束！参考代码已解锁。<b>逐行对照自己的实现</b>，找出差距并记录。', '复盘完成，收工', enterDone);
  } else if (s.phase === 'done') {
    setCta('本轮训练完成 🎉 休息一下，或再来一轮。', '再来一轮（同配置）', resetToConfig);
  } else {
    setCta(null);
  }
}

function enterThinking() {
  const s = S.session;
  s.phase = 'thinking';
  s.paused = false; s.remain = 0;
  stopTimer();
  saveSession();
  beep([[880, .2], [1100, .3]]);
  notify('第一轮结束', '独立思考时间到！解锁解题思路，读完后开始第二轮。');
  renderSession();
  toast('第一轮结束 —— 思路已解锁', 'ok');
}

function startPhase2() {
  const s = S.session;
  s.phase = 'thinking';
  s.phase2EndAt = Date.now() + s.phase2Total * 1000;
  s.paused = false;
  saveSession();
  setCta(null);
  startCountdown(s.phase2Total, s.phase2EndAt);
  setPhaseBadge('thinking');
  toast('第二轮开始 —— 按思路自己实现', 'ok');
}

function enterCoding() {
  const s = S.session;
  s.phase = 'coding';
  s.paused = false; s.remain = 0;
  stopTimer();
  saveSession();
  beep([[660, .2], [880, .2], [1100, .4]]);
  notify('第二轮结束', '实现时间到！参考代码已解锁，开始对照复盘。');
  renderSession();
  toast('第二轮结束 —— 参考代码已解锁', 'ok');
}

function enterDone() {
  S.session.phase = 'done';
  S.session.paused = false;
  stopTimer();
  saveSession();
  renderSession();
  beep([[523, .15], [659, .15], [784, .15], [1047, .4]]);
  notify('本轮训练完成', '干得漂亮，记得做错题笔记！');
}

function skipPhase() {
  const s = S.session;
  if (!s) return;
  stopTimer();
  if (s.phase === 'solving') enterThinking();
  else if (s.phase === 'thinking' && s.phase2EndAt) enterCoding();
  else if (s.phase === 'thinking') startPhase2();
  else toast('当前阶段无需跳过', '');
}

function togglePause() {
  const s = S.session;
  if (!s) return;
  if (s.phase === 'thinking' && !s.phase2EndAt) { toast('请先开始第二轮计时', 'warn'); return; }
  if (s.paused) {
    s.paused = false;
    const total = s.phase === 'solving' ? s.phase1Total : s.phase2Total;
    const endAt = Date.now() + s.remain * 1000;
    if (s.phase === 'solving') s.phase1EndAt = endAt; else s.phase2EndAt = endAt;
    saveSession();
    startCountdown(total, endAt);
    $('pauseBtn').textContent = '⏸ 暂停';
  } else {
    stopTimer();
    const endAt = s.phase === 'solving' ? s.phase1EndAt : s.phase2EndAt;
    s.remain = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    s.paused = true;
    saveSession();
    $('pauseBtn').textContent = '▶ 继续';
    const total = s.phase === 'solving' ? s.phase1Total : s.phase2Total;
    renderTimer(s.remain, total, s.phase === 'solving' ? '独立思考中' : '理解后实现中');
  }
}

function resetToConfig() {
  stopTimer();
  clearSession();
  $('sessionPanel').hidden = true;
  $('configPanel').hidden = false;
  setPhaseBadge('idle'); // 简单隐藏
  $('phaseBadge').hidden = true;
  renderPhaseTabs();
}

/* ============================================================
   恢复会话（刷新页面不丢进度）
   ============================================================ */
function restoreSession() {
  try {
    const raw = localStorage.getItem(LS_SESSION);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.problems) || !s.problems.length) return;
    S.session = s;
    $('configPanel').hidden = true;
    $('sessionPanel').hidden = false;
    renderSession();
    if (s.phase === 'solving') {
      if (s.paused) {
        const total = s.phase1Total;
        renderTimer(s.remain || 0, total, '独立思考中');
        $('pauseBtn').textContent = '▶ 继续';
      } else {
        startCountdown(s.phase1Total, s.phase1EndAt);
      }
      runBgFetch();
    } else if (s.phase === 'thinking' && s.phase2EndAt) {
      if (s.paused) {
        renderTimer(s.remain || 0, s.phase2Total, '理解后实现中');
        $('pauseBtn').textContent = '▶ 继续';
      } else {
        startCountdown(s.phase2Total, s.phase2EndAt);
      }
    }
  } catch (e) { /* 忽略损坏的会话 */ }
}

/* ============================================================
   事件绑定与初始化
   ============================================================ */
function wireEvents() {
  // 难度模式切换
  $('diffModeSeg').querySelectorAll('.seg-btn').forEach(b => {
    b.onclick = () => {
      S.diffMode = b.dataset.mode;
      setSeg($('diffModeSeg'), S.diffMode);
      $('diffLuogu').hidden = S.diffMode !== 'luogu';
      $('diffCf').hidden = S.diffMode !== 'cf';
      if (S.diffMode === 'cf') {
        if (!S.diffs.size || S.diffs.has(0)) {
          S.diffs = new Set(cfToDiffs(S.cfLo, S.cfHi));
          renderDiffChips();
        }
        $('cfMin').value = S.cfLo; $('cfMax').value = S.cfHi;
        renderCfResult();
      }
      saveSettings();
    };
  });
  $('cfApply').onclick = () => {
    const lo = Math.max(0, +$('cfMin').value || 0);
    const hi = Math.min(4000, +$('cfMax').value || 0);
    if (lo > hi) { toast('区间非法：最小值大于最大值', 'warn'); return; }
    S.cfLo = lo; S.cfHi = hi;
    S.diffs = new Set(cfToDiffs(lo, hi));
    renderDiffChips();
    renderCfResult();
    if (!S.diffs.size) toast('该 CF 区间未映射到任何洛谷难度，请调整', 'warn');
    saveSettings();
  };
  // 语言
  $('langSeg').querySelectorAll('.seg-btn').forEach(b => {
    b.onclick = () => { S.lang = b.dataset.lang; setSeg($('langSeg'), S.lang); saveSettings(); };
  });
  // 数量 / 计时滑块
  $('numN').oninput = (e) => { S.n = +e.target.value; $('numNOut').value = S.n; saveSettings(); };
  $('t1').oninput = (e) => { S.t1 = +e.target.value; $('t1Out').value = S.t1; saveSettings(); };
  $('t2').oninput = (e) => { S.t2 = +e.target.value; $('t2Out').value = S.t2; saveSettings(); };
  // 关键词 / 目标 / cookie / 代理
  $('keyword').onchange = (e) => { S.keyword = e.target.value; saveSettings(); };
  $('goal').onchange = (e) => { S.goal = e.target.value; saveSettings(); };
  $('luoguCookie').onchange = (e) => { S.cookie = e.target.value.trim(); saveSettings(); };
  $('proxyMode').onchange = (e) => { S.proxyMode = e.target.value; $('workerUrl').disabled = S.proxyMode !== 'worker'; saveSettings(); };
  $('workerUrl').onchange = (e) => { S.workerUrl = e.target.value.trim().replace(/\/+$/, ''); saveSettings(); };
  // 标签搜索
  $('tagSearch').oninput = (e) => renderTagChips(e.target.value);
  // 主按钮
  $('startBtn').onclick = startSession;
  $('testNetBtn').onclick = netSelfTest;
  $('pauseBtn').onclick = togglePause;
  $('skipBtn').onclick = skipPhase;
  $('againBtn').onclick = resetToConfig;
  $('resetBtn').onclick = () => { if (confirm('确定结束本轮并清空进度？')) resetToConfig(); };
}

function applySettingsToUI() {
  setSeg($('diffModeSeg'), S.diffMode);
  $('diffLuogu').hidden = S.diffMode !== 'luogu';
  $('diffCf').hidden = S.diffMode !== 'cf';
  setSeg($('langSeg'), S.lang);
  $('numN').value = S.n; $('numNOut').value = S.n;
  $('t1').value = S.t1; $('t1Out').value = S.t1;
  $('t2').value = S.t2; $('t2Out').value = S.t2;
  $('keyword').value = S.keyword;
  $('goal').value = S.goal;
  $('luoguCookie').value = S.cookie;
  $('proxyMode').value = S.proxyMode;
  $('workerUrl').value = S.workerUrl;
  $('workerUrl').disabled = S.proxyMode !== 'worker';
  $('cfMin').value = S.cfLo; $('cfMax').value = S.cfHi;
  renderDiffChips();
  if (S.diffMode === 'cf') renderCfResult();
}

function init() {
  loadSettings();
  applySettingsToUI();
  wireEvents();
  // 先加载标签（避免与网络自检并发抢占代理状态），完成后再自检
  loadTags().then(() => {
    restoreSession();
    netSelfTest();
  });
  // 请求通知权限（用户手势之前静默请求，失败无妨）
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
}

document.addEventListener('DOMContentLoaded', init);
