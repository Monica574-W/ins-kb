// 入口：路由、導航、標題表、Service Worker
import { icon, $, esc } from './util.js';

/* 每一頁的頂欄小標題 + 大標題：新增頁面時必須在此加項，否則啟動時會報錯 */
export const TITLES = {
  home:       { sub: '管理總覽',        title: '管理總覽' },
  ask:        { sub: 'AI問答及工具',    title: 'AI 知識問答' },
  commission: { sub: 'AI問答及工具',    title: '上板數 / 佣金計算' },
  plan:       { sub: 'AI問答及工具',    title: '計劃書小助手' },
  library:    { sub: '資料',            title: '資料總覽' },
  settings:   { sub: '系統',            title: '設定與權限' },
  manual:     { sub: '系統',            title: 'App 操作手冊' },
  me:         { sub: '我的',            title: '我的' },
};

const ROUTES = {
  home: () => import('./views/home.js'),
  ask: () => import('./views/ask.js'),
  commission: () => import('./views/commission.js'),
  plan: () => import('./views/plan.js'),
  library: () => import('./views/library.js'),
  settings: () => import('./views/settings.js'),
  manual: () => import('./views/manual.js'),
  me: () => import('./views/me.js'),
};
// 自檢：每條路由都要有標題
for (const k of Object.keys(ROUTES)) if (!TITLES[k]) console.error(`[標題表] 缺少路由「${k}」的標題`);

/* 桌面左側欄：四組 */
const SIDE = [
  { group: null, items: [['home', '管理總覽', 'dash']] },
  { group: 'AI問答及工具', items: [['ask', 'AI 知識問答', 'chat'], ['commission', '上板數佣金', 'calc'], ['plan', '計劃書小助手', 'plan']] },
  { group: '資料', items: [['library', '資料總覽', 'books']] },
  { group: '系統', items: [['settings', '設定與權限', 'gear'], ['manual', 'App 操作手冊', 'help']] },
];
/* 手機底部：五項 */
const BOTTOM = [['home', '首頁', 'home'], ['ask', 'AI 問答', 'chat'], ['commission', '佣金', 'calc'], ['library', '資料', 'books'], ['me', '我的', 'user']];

function renderNav() {
  $('#side-nav').innerHTML = SIDE.map(g =>
    (g.group ? `<div class="side-group">${esc(g.group)}</div>` : '') +
    g.items.map(([r, label, ic]) => `<a href="#/${r}" data-r="${r}" class="${g.group ? '' : 'solo'}">${icon(ic)}<span>${esc(label)}</span></a>`).join('')
  ).join('');
  $('#bottom-nav').innerHTML = BOTTOM.map(([r, label, ic]) => `<a href="#/${r}" data-r="${r}">${icon(ic)}<span>${esc(label)}</span></a>`).join('');
}

export function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  let [name, qs] = h.split('?');
  if (window.__PROTO && window.__PROTO.alias[name]) name = window.__PROTO.alias[name];
  return { name: ROUTES[name] ? name : 'home', params: new URLSearchParams(qs || '') };
}
export function go(name, params) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  location.hash = window.__PROTO ? `#${window.__PROTO.toHash(name)}` : `#/${name}${qs}`;
}

let current = null, seq = 0;
async function route() {
  const { name, params } = parseHash();
  const my = ++seq;
  const t = TITLES[name] || { sub: '', title: '卓越 Summit 寶典' };
  $('#top-sub').textContent = t.sub;
  $('#top-title').textContent = t.title;
  document.title = `${t.title}｜卓越 Summit 寶典`;
  // 「我的」底下的子頁（設定、手冊、計劃書）在手機也高亮「我的」
  const mobileOn = { settings: 'me', manual: 'me', plan: 'me' }[name] || name;
  document.querySelectorAll('#side-nav a').forEach(a => a.classList.toggle('on', a.dataset.r === name));
  document.querySelectorAll('#bottom-nav a').forEach(a => a.classList.toggle('on', a.dataset.r === mobileOn));
  const view = $('#view');
  try {
    const mod = await ROUTES[name]();
    if (my !== seq) return;
    if (current && current.unmount) current.unmount();
    // 每次換頁用全新容器，避免舊頁面的事件監聽累積
    const box = document.createElement('div');
    view.replaceChildren(box);
    current = mod;
    await mod.mount(box, params);
    if (current === mod && params.get('keep') !== '1') window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="notice err">頁面載入失敗：${esc(e.message)}</div>`;
  }
}

function netState() { $('#net-dot').classList.toggle('off', !navigator.onLine); $('#net-dot').title = navigator.onLine ? '在線' : '離線（AI 問答不可用，已開啟過的資料可閱讀）'; }

/* PWA 安裝 */
export let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });

if ('serviceWorker' in navigator && !window.__PROTO) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(e => console.warn('SW 註冊失敗', e));
    // 新版 SW 接手後自動重新載入一次，確保用到新資源
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded && sessionStorage.getItem('ikb:sw-ready')) { reloaded = true; location.reload(); } sessionStorage.setItem('ikb:sw-ready', '1'); });
    if (navigator.serviceWorker.controller) sessionStorage.setItem('ikb:sw-ready', '1');
  });
}

renderNav();
window.addEventListener('hashchange', route);
window.addEventListener('online', netState);
window.addEventListener('offline', netState);
netState();
route();
