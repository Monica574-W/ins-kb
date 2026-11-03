// 共用工具
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const store = {
  get(k, d = null) { try { const v = localStorage.getItem('ikb:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ikb:' + k, JSON.stringify(v)); } catch {} },
};
// 管理員密碼只放 sessionStorage（關閉分頁即失效）
export const session = {
  get(k) { try { return sessionStorage.getItem('ikb:' + k) || ''; } catch { return ''; } },
  set(k, v) { try { v ? sessionStorage.setItem('ikb:' + k, v) : sessionStorage.removeItem('ikb:' + k); } catch {} },
};

let toastTimer;
export function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// 複製：http 區網（非安全環境）下 navigator.clipboard 不可用，退回 execCommand
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); toast('已複製'); return true; }
  } catch {}
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
  let ok = false; try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  toast(ok ? '已複製' : '複製失敗，請長按文字手動複製');
  return ok;
}

export function headers(extra = {}) {
  const h = { ...extra };
  const sid = store.get('staffId', '');
  if (sid) h['X-Staff-Id'] = sid;
  const pin = session.get('adminPin');
  if (pin) h['X-Admin-Pin'] = pin;
  return h;
}
export async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: headers(opts.body ? { 'Content-Type': 'application/json' } : {}) };
  if (opts.body) init.body = JSON.stringify(opts.body);
  const r = await fetch(path, init);
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data && data.error) || `請求失敗（${r.status}）`);
  return data;
}

/* 串流 POST：伺服器回 text/event-stream。handlers: meta(data) / delta(text) / done() / error(msg) */
export async function streamPost(path, body, handlers, signal) {
  let r;
  try {
    r = await fetch(path, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === 'AbortError') return handlers.done?.({ aborted: true });
    return handlers.error?.(navigator.onLine ? '連線伺服器失敗' : '目前離線，AI 問答需要網絡');
  }
  if (!r.ok) {
    let msg = `請求失敗（${r.status}）`;
    try { msg = (await r.json()).error || msg; } catch {}
    return handlers.error?.(msg);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        let ev = 'message', data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) ev = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        let j = {}; try { j = JSON.parse(data); } catch {}
        if (ev === 'meta') handlers.meta?.(j);
        else if (ev === 'done') handlers.done?.(j);
        else if (ev === 'error') handlers.error?.(j.message || '發生錯誤');
        else if (j.d) handlers.delta?.(j.d);
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') return handlers.done?.({ aborted: true });
    handlers.error?.('串流中斷');
  }
}

/* 逐字顯示佇列：把收到的片段按幀吐出，看起來像逐字打出 */
export function typewriter(onText) {
  let queue = '', shown = '', raf = 0, ended = false, onEnd = null;
  const tick = () => {
    if (queue) {
      const n = Math.max(1, Math.ceil(queue.length / 12));
      shown += queue.slice(0, n); queue = queue.slice(n);
      onText(shown, false);
    }
    if (queue) raf = requestAnimationFrame(tick);
    else { raf = 0; if (ended) { onText(shown, true); onEnd && onEnd(); } }
  };
  return {
    push(t) { queue += t; if (!raf) raf = requestAnimationFrame(tick); },
    end(cb) { ended = true; onEnd = cb; if (!raf) tick(); },
    get text() { return shown + queue; },
  };
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return '';
  return d.toLocaleDateString('zh-HK', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
export const KIND_LABEL = { pdf: 'PDF', image: '圖片', text: '文字', other: '檔案' };

// 線條圖示（currentColor）
const P = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  dash: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>',
  calc: '<rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M8 6.5h8M8 11h.01M12 11h.01M16 11h.01M8 14.5h.01M12 14.5h.01M16 14.5h.01M8 18h.01M12 18h4"/>',
  plan: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  books: '<path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20a2 2 0 0 0 2 2h13v-4"/><path d="M9 7h6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  text: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
};
export const icon = (name, attrs = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${attrs}>${P[name] || ''}</svg>`;
