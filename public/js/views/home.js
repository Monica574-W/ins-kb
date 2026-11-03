import { api, esc, icon, fmtDate, store, KIND_LABEL } from '../util.js';
import { openReaderById } from '../reader.js';

function greet() {
  const h = new Date().getHours();
  return h < 12 ? '早晨' : h < 18 ? '午安' : '晚安';
}

export async function mount(el) {
  const sid = store.get('staffId', '');
  el.innerHTML = `
    <section class="hero">
      <svg class="art" viewBox="0 0 150 150" aria-hidden="true"><circle cx="100" cy="48" r="34" fill="#e7a63a" opacity=".25"/><circle cx="100" cy="48" r="20" fill="#e7a63a" opacity=".55"/><path d="M74 40l30 11v22c0 20-13 34-30 40-17-6-30-20-30-40V51z" fill="#fff" opacity=".95"/><path d="M61 76l9 9 18-19" fill="none" stroke="#d0102f" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="126" cy="100" r="9" fill="#ffd27a"/><circle cx="118" cy="114" r="6" fill="#d0102f"/></svg>
      <div class="hi">${greet()}，</div>
      <div class="name">${sid ? esc(sid) + ' 顧問' : '顧問'}</div>
      <div class="q"><b id="left">–<small> / –</small></b><div class="lbl">今日剩餘 AI 問答次數</div></div>
      <div class="bar"><i id="bar" style="width:0%"></i></div>
      <a class="ask-cta" href="#/ask"><span class="ph">問我任何保單問題…</span><span class="go">${icon('chat')}</span></a>
    </section>
    ${sid ? '' : `<div class="notice warn">尚未設定工號：每日 AI 次數會按 IP 計算。<a href="#/settings">前往設定</a></div>`}
    <div id="alerts"></div>
    <div class="grid" style="grid-template-columns:repeat(2,1fr)">
      <a class="tile red" href="#/commission"><span class="wm">${icon('calc')}</span><span class="ic">${icon('calc')}</span>上板數 / 佣金<small>按已匯入費率計算</small></a>
      <a class="tile gold" href="#/plan"><span class="wm">${icon('plan')}</span><span class="ic">${icon('plan')}</span>計劃書小助手<small>講解重點及異議處理</small></a>
      <a class="tile" href="#/library"><span class="wm">${icon('books')}</span><span class="ic">${icon('books')}</span>資料總覽<small>分類瀏覽及搜尋</small></a>
      <a class="tile dark" href="#/manual"><span class="wm">${icon('help')}</span><span class="ic">${icon('help')}</span>操作手冊<small>新同事必讀</small></a>
    </div>
    <div class="sec-title"><h2>今日概況</h2></div>
    <div class="grid" id="stats" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))"><div class="stat"><b>…</b><span>載入中</span></div></div>
    <div class="sec-title"><h2>最近更新</h2><a href="#/library">全部 ›</a></div>
    <div id="recent" class="muted">載入中…</div>`;
  try {
    const s = await api('/api/stats');
    const left = Math.max(0, s.limit - s.myUsed);
    el.querySelector('#left').innerHTML = `${left}<small> / ${s.limit}</small>`;
    el.querySelector('#bar').style.width = (left / s.limit * 100) + '%';
    el.querySelector('#stats').innerHTML = [
      [s.docs, '資料文件', 'hot'],
      [s.categories, '分類（末層）'],
      [s.todayCalls, `今日 AI 調用・${s.todayUsers} 人`],
      [s.todayNoHit, '未命中資料的提問'],
      [s.rates, '佣金費率條目'],
    ].map(([v, l, c]) => `<div class="stat ${c || ''}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
    el.querySelector('#alerts').innerHTML =
      (s.hasKey ? '' : `<div class="notice err">尚未設定 DeepSeek API Key，AI 功能暫不可用。<a href="#/settings">前往設定</a></div>`) +
      (s.rates ? '' : `<div class="notice warn">尚未匯入佣金費率表，佣金計算不可用。<a href="#/commission">前往匯入</a></div>`);
    el.querySelector('#recent').innerHTML = s.recent.length
      ? s.recent.map(d => `<button class="doc-item" data-id="${esc(d.id)}"><div class="tt">${esc(d.title)}</div><div class="meta">${esc(d.category)}　${fmtDate(d.updatedAt)}</div></button>`).join('')
      : '暫無資料，請到「設定與權限 › 資料匯入」新增。';
    el.querySelector('#recent').onclick = e => { const b = e.target.closest('[data-id]'); if (b) openReaderById(b.dataset.id); };
  } catch (e) {
    el.querySelector('#stats').innerHTML = `<div class="notice warn" style="grid-column:1/-1">${navigator.onLine ? '無法連線伺服器：' + esc(e.message) : '目前離線，統計數字暫不可用；已開啟過的資料仍可閱讀。'}</div>`;
    el.querySelector('#recent').textContent = '';
  }
}
