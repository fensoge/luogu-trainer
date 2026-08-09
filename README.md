# 🐦 洛谷刷题训练舱 · LUOGU TRAINER

一个纯静态的**限时刷题训练工具**（HTML/CSS/JS，零依赖、无后端），可一键部署到 **GitHub Pages**。

## 核心流程

```
输入目标（难度 + 算法标签 + 题数）
        │
        ▼
 拉取洛谷题目 ──► 随机推送 n 道题 ──► 第一轮倒计时「独立思考」
                                          │（后台静默抓取题解，剥离代码只留思路）
                                          ▼
                           倒计时结束 ──► 解锁「解题思路」（无代码）
                                          │
                                          ▼
                           第二轮倒计时「按思路实现」 ──► 解锁「参考代码」+ 复盘
```

- 难度支持 **洛谷 8 档难度** 与 **CF Rating 区间**（按社区通用映射近似换算）
- 算法标签多选（262 个算法标签，服务端按首个标签筛 + 本地二次过滤）
- 两段倒计时时长、题数、参考代码语言（C++/Python/任意）均可配置
- 刷新页面**不丢进度**（阶段、倒计时、已抓取的思路/代码都保存在浏览器本地）
- 倒计时结束有提示音 + 系统通知

## 快速开始

### 1. 部署到 GitHub Pages

```bash
# 把本目录推到一个 GitHub 仓库（任意名字，比如 luogu-trainer）
git init
git add .
git commit -m "luogu trainer"
git remote add origin https://github.com/<你的用户名>/luogu-trainer.git
git push -u origin main
```

然后到仓库 **Settings → Pages → Build and deployment → Source 选 `Deploy from a branch` → 分支选 `main` → 保存**。
等 1~2 分钟，访问 `https://<你的用户名>.github.io/luogu-trainer/` 即可使用。

> 也可以直接手动把 `index.html` / `style.css` / `app.js` 拖进任意静态托管（GitHub Pages、Cloudflare Pages、Netlify 都行）。

### 2. （推荐）部署自己的代理 Worker —— 才能获取「思路」和「参考代码」

洛谷接口有跨域（CORS）限制，题解页还**强制要求登录**。项目内置了两种数据通道：

| 数据 | 匿名 | 代理要求 |
|---|---|---|
| 题目列表 / 题面 / 标签 | ✅ | 内置 jina + allorigins 公共代理自动降级 |
| **题解（思路 + 代码）** | ❌ 需登录 | 必须走**你自己的 Worker 代理** + 登录 Cookie |

代理链（自动模式）：自定义 Worker（若已配置）→ **jina**（真实浏览器渲染，稳定）→ allorigins（公共代理，偶被洛谷拦截）→ 直连（通常因 CORS 失败）。

部署 Worker（约 2 分钟）：

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages → 创建 → Worker**
2. 把仓库里的 [`worker.js`](./worker.js) 全文粘贴进去 → **部署**
3. 回到工具「高级设置」：
   - 代理方式选 **自定义 Worker 代理**（或保持「自动」，会自动优先用 Worker）
   - 填入 `https://<你的worker名>.workers.dev`
4. 可选：给 Worker 绑定自定义域名（设置 → 域名和路由），地址更稳定

> 命令行部署（国内网络 wrangler 上传可能失败，已内置兜底脚本）：
> ```bash
> npm i                     # 安装 wrangler + undici
> npx wrangler login        # 浏览器授权（若 fetch failed，可改用下面的脚本）
> CLOUDFLARE_API_TOKEN=<令牌> npx wrangler deploy
> # 或：CF_TOKEN=<OAuth令牌> CF_ACCOUNT=<账号ID> node deploy.mjs
> ```
> `deploy.mjs` 用 undici 走本地代理（识别 `HTTPS_PROXY` 环境变量）上传，网络受限环境更稳。

### 3. 获取洛谷登录 Cookie（只需要题解时）

1. 浏览器登录 [luogu.com.cn](https://www.luogu.com.cn)
2. 按 `F12` → **Network（网络）** → 刷新页面 → 点任意一条 `luogu.com.cn` 请求
3. 在 **Request Headers** 里找到 `Cookie:` 那一行，**整段复制**
4. 粘贴到工具「高级设置 → 洛谷 Cookie」→ 保存

> 🔒 Cookie 只保存在你自己的浏览器 `localStorage` 里，仅随请求发往你自己的 Worker；不会上传到任何第三方服务器。
> ⚠️ 建议单独使用，不要到处粘贴你的 Cookie；过期后重新复制一份即可。

## CF Rating ↔ 洛谷难度映射（近似，社区通用换算）

| 洛谷难度 | 对应 CF Rating |
|---|---|
| 入门 | ≤ 800 |
| 普及− | 800 ~ 1200 |
| 普及 | 1200 ~ 1600 |
| 普及+/提高− | 1600 ~ 1900 |
| 提高 | 1900 ~ 2200 |
| 提高+/省选− | 2200 ~ 2500 |
| 省选/NOI− | 2500 ~ 3000 |
| NOI/NOI+/CTSC | 3000+ |

洛谷题面本身不标注 CF 分数，此换算仅用于把 CF 目标近似落到洛谷难度区间；交叉区间会同时纳入（如 CF 1400~1700 → 普及 + 普及+/提高−）。

## 技术说明

- 数据来自洛谷 SSR 内嵌的 `lentille-context` JSON（匿名接口，无需登录即可读列表/题面）
- 题解页解析：`splitSolution()` 把题解 HTML 切成「思路」（去掉 `<pre>` 代码块）与「参考代码」（按语言分组）
- 代理链自动降级：直连 → allorigins → 自定义 Worker；某代理失效会自动切换并记忆可用项
- 公式（KaTeX）与代码高亮（highlight.js）走 CDN，断网时仅样式降级，功能不受影响
- 无任何构建步骤；本地直接双击 `index.html` 或 `python -m http.server` 即可预览（联网功能需网络）

## 常见问题

**Q：题目列表拉取失败？**
点「网络自检」看哪个代理可用；多数情况下自动模式会选中 allorigins。网络环境差时多试几次。

**Q：思路/代码提示“未登录洛谷”？**
题解页需要登录：按上文第 3 步配置 Cookie + 第 2 步 Worker 代理，然后点题卡上的「↻ 重试获取」。

**Q：我填了 Cookie 还是 401？**
Cookie 过期了（洛谷 Cookie 有效期约一个月）。重新登录复制一份；注意粘贴的是**请求头 Cookie 整段**，不是页面显示的用户名。

**Q：多选标签结果太少？**
首个标签走服务端筛选、其余本地过滤（全部匹配）；若不足题数会自动放宽为“任一匹配”，并在挑选时倾向多标签命中的题。

**Q：抓取速度慢？**
每道题题解抓取间隔约 0.35s，n 题 ≈ n×1~2 秒，与第一轮倒计时并行进行，不影响做题。

## 免责声明

本项目仅供个人学习交流，数据版权归洛谷所有。请遵守 [洛谷用户协议](https://help.luogu.com.cn/ula/luogu) 与[题解标准](https://help.luogu.com.cn/rules/academic/solution-standard)；建议使用频率保持克制，避免对洛谷服务器造成压力。
