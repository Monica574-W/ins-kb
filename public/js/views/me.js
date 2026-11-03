import { api, store, icon, esc } from '../util.js';

export async function mount(el) {
  const sid = store.get('staffId', '');
  el.innerHTML = `
    <div class="card"><div class="me-head"><div class="avatar">${sid ? esc(sid.slice(0, 1)) : icon('user', 'width="28" height="28"')}</div>
      <div><b style="font-size:18px">${sid ? esc(sid) : '未設定工號'}</b><div class="muted" id="quota">今日 AI 次數：…</div></div></div></div>
    <div class="grid">
      <a class="tile gold" href="#/plan"><span class="wm">${icon('plan')}</span><span class="ic">${icon('plan')}</span>計劃書小助手<small>講解重點及異議處理</small></a>
      <a class="tile dark" href="#/settings"><span class="wm">${icon('gear')}</span><span class="ic">${icon('gear')}</span>設定與權限<small>工號、API Key、資料匯入</small></a>
      <a class="tile red" href="#/manual"><span class="wm">${icon('help')}</span><span class="ic">${icon('help')}</span>App 操作手冊<small>功能說明及常見問題</small></a>
    </div>`;
  try {
    const s = await api('/api/stats');
    el.querySelector('#quota').textContent = `今日 AI 次數：已用 ${s.myUsed}，剩餘 ${Math.max(0, s.limit - s.myUsed)} / ${s.limit}`;
  } catch { el.querySelector('#quota').textContent = '離線中，無法取得次數'; }
}
