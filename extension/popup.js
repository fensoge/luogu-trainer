// 洛谷 Cookie 复制器：读取（含 HttpOnly）并复制到剪贴板
const btn = document.getElementById('copy');
const status = document.getElementById('status');

btn.addEventListener('click', () => {
  chrome.cookies.getAll({ domain: 'luogu.com.cn' }, (cookies) => {
    if (chrome.runtime.lastError) {
      status.textContent = '读取失败：' + chrome.runtime.lastError.message;
      status.className = 'err';
      return;
    }
    if (!cookies || !cookies.length) {
      status.textContent = '未找到洛谷 Cookie：请先登录 luogu.com.cn，再点这里';
      status.className = 'err';
      return;
    }
    // 关键 Cookie 排前面：_uid → __client_id → C3VK → 其余按名字
    const order = ['_uid', '__client_id', 'C3VK'];
    const sorted = cookies.slice().sort((a, b) => {
      const ia = order.indexOf(a.name), ib = order.indexOf(b.name);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.name.localeCompare(b.name);
    });
    const str = sorted.map(c => c.name + '=' + c.value).join('; ');
    navigator.clipboard.writeText(str).then(() => {
      status.textContent = '✅ 已复制 ' + cookies.length + ' 个 Cookie，去训练舱粘贴吧';
      status.className = 'ok';
    }, () => {
      status.textContent = '自动复制失败，请手动复制：\n' + str;
      status.className = 'manual';
    });
  });
});
