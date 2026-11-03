import { esc, store, streamPost, typewriter, copyText, icon, api } from '../util.js';
import { openReaderById } from '../reader.js';
import { tokenize } from '../search.js';

const MODES = [['conservative', '保守', '2 段 × 800 字'], ['standard', '標準', '3 段 × 1200 字'], ['full', '完整', '4 段 × 1600 字']];
const ART = `<svg class="art" viewBox="0 0 120 96" aria-hidden="true"><circle cx="84" cy="30" r="22" fill="#fff1d6"/><circle cx="84" cy="30" r="12" fill="#e7a63a"/><rect x="14" y="22" width="62" height="46" rx="14" fill="#d0102f"/><path d="M30 68l-6 14 18-14z" fill="#d0102f"/><circle cx="32" cy="45" r="4" fill="#fff"/><circle cx="45" cy="45" r="4" fill="#fff"/><circle cx="58" cy="45" r="4" fill="#fff"/><rect x="60" y="50" width="48" height="34" rx="12" fill="#22161a"/><path d="M96 84l6 9-16-9z" fill="#22161a"/><path d="M73 67l5 5 10-10" fill="none" stroke="#ffd27a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const EXAMPLES = ['冷靜期有幾多日？點計？', '保單退保要準備甚麼文件？', '更改受益人需要甚麼手續？', '保費逾期未繳會點？'];

// 對話記錄保留在記憶體（切換頁面不會消失）
const msgs = [];
let ctrl = null;
let ui = null; // 目前畫面上的元素（離開再返回頁面時更新）

/* 簡易 Markdown：先轉義，再處理粗體、條列、出處標記 */
function renderAnswer(text, sources) {
  const lines = esc(text).split('\n');
  let html = '', inList = false;
  for (const raw of lines) {
    let l = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^#{1,4}\s*/, '');
    const li = l.match(/^\s*(?:[-*•]|\d+[.、)])\s+(.*)$/);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${li[1]}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (l.trim()) html += `<p>${l}</p>`;
  }
  if (inList) html += '</ul>';
  return html.replace(/\[(\d{1,2})\]/g, (m, n) => {
    const s = sources && sources.find(x => x.n === +n);
    return s ? `<button class="cite" data-doc="${esc(s.id)}" title="${esc(s.title)}">[${n}]</button>` : m;
  });
}
function renderSources(m) {
  if (!m.sources || !m.sources.length) return '';
  const seen = new Set();
  const items = m.sources.filter(s => !seen.has(s.id) && seen.add(s.id));
  return `<div class="sources"><h4>出處（按一下開啟原文件）</h4>${items.map(s =>
    `<button class="src" data-doc="${esc(s.id)}">${icon('file', 'width="20" height="20"')}<span><b>[${m.sources.filter(x => x.id === s.id).map(x => x.n).join('][')}] ${esc(s.title)}</b><small>${esc(s.category)}</small></span></button>`).join('')}</div>`;
}
function msgHTML(m, i) {
  if (m.role === 'user') return `<div class="msg user">${esc(m.text)}</div>`;
  const body = m.error ? `<div class="notice err" style="margin:0">${esc(m.error)}</div>` : `<div class="ans ${m.streaming ? 'caret' : ''}">${renderAnswer(m.text, m.sources) || (m.streaming ? '<p class="muted">正在檢索資料及生成答案…</p>' : '')}</div>`;
  const tools = !m.streaming && m.text && !m.error ? `<div class="row" style="margin-top:8px"><button class="btn small ghost" data-copy="${i}">${icon('copy', 'width="16" height="16"')}複製答案</button></div>` : '';
  return `<div class="msg ai" data-i="${i}">${body}${m.streaming ? '' : renderSources(m)}${tools}</div>`;
}

export async function mount(el) {
  let mode = store.get('askMode', null);
  el.innerHTML = `
    <div class="row" style="justify-content:space-between;margin-bottom:12px">
      <div class="seg" role="group" aria-label="檢索檔位">${MODES.map(([k, l, d]) => `<button data-mode="${k}" title="${d}">${l}</button>`).join('')}</div>
      <span id="quota" style="font-size:12.5px;font-weight:700;color:#5e0616;background:#fff;padding:6px 12px;border-radius:99px;box-shadow:0 4px 12px rgba(60,10,20,.12)"></span>
    </div>
    <div class="muted" id="mode-desc" style="margin:-4px 0 12px"></div>
    <div class="chat" id="chat"></div>
    <div id="examples"></div>
    <form class="composer" id="form"><div class="composer-box">
      <label class="f" style="margin:0"><span class="muted" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">輸入問題</span>
        <textarea id="q" placeholder="輸入問題，例如：冷靜期點計？" maxlength="1000" rows="2"></textarea></label>
      <div class="row" style="margin-top:4px">
        <button class="btn" type="submit" id="send" style="flex:1">送出問題</button>
        <button class="btn danger" type="button" id="stop" hidden>停止</button>
        <button class="btn ghost" type="button" id="clear">清除</button>
      </div></div>
      <p class="muted" style="font-size:12px;text-align:center;margin:8px 0 0">只依據公司資料作答・身份證號及電話會自動遮罩</p>
    </form>`;
  const chat = el.querySelector('#chat'), q = el.querySelector('#q'), sendBtn = el.querySelector('#send'), stopBtn = el.querySelector('#stop');

  const setMode = k => { mode = k; store.set('askMode', k); el.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === k)); el.querySelector('#mode-desc').textContent = '檢索檔位：' + MODES.find(m => m[0] === k)[2] + '（片段越多越完整，但較慢）'; };
  if (!mode) { try { mode = (await api('/api/config')).defaultMode; } catch {} }
  setMode(MODES.some(m => m[0] === mode) ? mode : 'standard');
  el.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));

  const draw = () => {
    chat.innerHTML = msgs.map(msgHTML).join('');
    el.querySelector('#examples').innerHTML = msgs.length ? '' : `<div class="empty-ask">${ART}<h3>有咩想問？</h3><p>答案只來自公司文件，並附上出處</p>
      <div class="ex-list">${EXAMPLES.map(t => `<button class="ex" type="button" data-ex="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>`;
  };
  const drawOne = i => { const node = chat.querySelector(`[data-i="${i}"]`); if (node) node.outerHTML = msgHTML(msgs[i], i); else draw(); };
  const refreshQuota = async () => {
    try { const s = await api('/api/stats'); el.querySelector('#quota').textContent = `今日剩餘 ${Math.max(0, s.limit - s.myUsed)} / ${s.limit} 次`; } catch {}
  };
  ui = { chat, sendBtn, stopBtn, drawOne, refreshQuota };
  if (ctrl) { sendBtn.disabled = true; stopBtn.hidden = false; }
  draw(); refreshQuota();

  el.addEventListener('click', e => {
    const d = e.target.closest('[data-doc]');
    if (d) {
      const m = msgs[+d.closest('[data-i]')?.dataset.i];
      const prevUser = m && msgs[msgs.indexOf(m) - 1];
      return openReaderById(d.dataset.doc, { terms: prevUser ? tokenize(prevUser.text).hit : [] });
    }
    const ex = e.target.closest('[data-ex]'); if (ex) { q.value = ex.dataset.ex; q.focus(); return; }
    const c = e.target.closest('[data-copy]');
    if (c) { const m = msgs[+c.dataset.copy]; const src = (m.sources || []).map(s => `[${s.n}] ${s.title}（${s.category}）`).join('\n'); copyText(m.text + (src ? '\n\n出處：\n' + src : '')); }
  });
  el.querySelector('#clear').onclick = () => { if (ctrl) return; msgs.length = 0; draw(); };
  stopBtn.onclick = () => ctrl && ctrl.abort();
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) el.querySelector('#form').requestSubmit(); });

  el.querySelector('#form').onsubmit = async e => {
    e.preventDefault();
    const text = q.value.trim();
    if (!text || ctrl) return;
    q.value = '';
    msgs.push({ role: 'user', text });
    const m = { role: 'ai', text: '', sources: [], streaming: true };
    msgs.push(m); const idx = msgs.length - 1;
    draw(); chat.lastElementChild.scrollIntoView({ block: 'end', behavior: 'smooth' });
    sendBtn.disabled = true; stopBtn.hidden = false;
    ctrl = new AbortController();
    const tw = typewriter((shown, final) => { m.text = shown; if (final) return; const node = ui.chat.querySelector(`[data-i="${idx}"] .ans`); if (node) node.innerHTML = renderAnswer(shown, m.sources); });
    const finish = () => tw.end(() => { m.streaming = false; ctrl = null; ui.sendBtn.disabled = false; ui.stopBtn.hidden = true; ui.drawOne(idx); ui.refreshQuota(); });
    await streamPost('/api/ask', { question: text, mode }, {
      meta: d => { m.sources = d.sources || []; },
      delta: t => tw.push(t),
      done: d => { if (d && d.aborted) tw.push('\n\n（已停止）'); finish(); },
      error: msg => { m.error = msg; finish(); },
    }, ctrl.signal);
  };
}
export function unmount() { /* 串流可在背景完成，返回本頁時會見到結果 */ }
