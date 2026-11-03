import { api, esc, store, session, toast, headers, fmtDate } from '../util.js';
import { getLibrary, invalidateLibrary } from '../data.js';
import { openReader } from '../reader.js';
import { installPrompt } from '../app.js';

const MODES = [['conservative', '保守（2 × 800 字）'], ['standard', '標準（3 × 1200 字）'], ['full', '完整（4 × 1600 字）']];

export async function mount(el) {
  el.innerHTML = `
    <div class="card"><h2>我的工號</h2>
      <p class="muted">用作每日 AI 次數（每人每日上限）及日誌識別；未填則按 IP 計算。</p>
      <div class="row"><input type="text" id="sid" placeholder="例如 A12345" maxlength="32" style="flex:1;min-width:160px" autocapitalize="characters"><button class="btn" id="savesid">儲存</button></div>
    </div>
    <div class="card" id="admin"></div>
    <div id="admin-only"></div>
    <div class="card"><h2>App</h2>
      <div class="row">
        <button class="btn sec" id="install">安裝到主畫面</button>
        <button class="btn ghost" id="clearcache">清除離線快取</button>
      </div>
      <p class="muted" id="swinfo"></p>
    </div>`;
  const $ = s => el.querySelector(s);
  $('#sid').value = store.get('staffId', '');
  $('#savesid').onclick = () => {
    const v = $('#sid').value.trim().toUpperCase();
    if (v && !/^[A-Za-z0-9_-]{1,32}$/.test(v)) return toast('工號只可包含英文字母、數字、- 或 _');
    store.set('staffId', v); toast(v ? '工號已儲存' : '已清除工號');
  };
  $('#install').onclick = async () => {
    if (installPrompt) { installPrompt.prompt(); return; }
    toast('請用瀏覽器選單的「加到主畫面／安裝 App」。iPhone：Safari 分享 › 加至主畫面。', 5000);
  };
  $('#clearcache').onclick = async () => {
    if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
    toast('已清除，重新載入中…'); setTimeout(() => location.reload(), 800);
  };
  if ('serviceWorker' in navigator && !window.__PROTO) {
    const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
    $('#swinfo').textContent = reg ? '離線功能：已啟用' : (window.isSecureContext ? '離線功能：未啟用（重新整理一次）' : '離線功能需在 localhost 或 HTTPS 下使用');
  }

  let cfg;
  try { cfg = await api('/api/config'); } catch (e) { $('#admin').innerHTML = `<div class="notice err">無法連線伺服器：${esc(e.message)}</div>`; return; }

  // ---- 管理員 ----
  function drawAdmin() {
    if (cfg.hasAdminPin && !cfg.isAdmin) {
      $('#admin').innerHTML = `<h2>管理員登入</h2><p class="muted">設定 API Key、匯入資料、匯出日誌需要管理員密碼。</p>
        <div class="row"><input type="password" id="pin" placeholder="管理員密碼" style="flex:1;min-width:160px"><button class="btn" id="login">登入</button></div>`;
      $('#login').onclick = async () => {
        session.set('adminPin', $('#pin').value);
        const r = await api('/api/admin/check', { method: 'POST' }).catch(() => ({ ok: false }));
        if (!r.ok) { session.set('adminPin', ''); return toast('密碼錯誤'); }
        toast('已登入'); mount(el);
      };
      $('#admin-only').innerHTML = '';
      return false;
    }
    $('#admin').innerHTML = `<h2>權限</h2>
      <p class="muted">${cfg.hasAdminPin ? '已設定管理員密碼，你目前已登入（關閉分頁後需重新輸入）。' : '尚未設定管理員密碼：任何能打開此頁的人都可修改設定。多人共用時請設定。'}</p>
      <div class="row"><input type="password" id="newpin" placeholder="${cfg.hasAdminPin ? '輸入新密碼（留空 = 取消密碼）' : '設定管理員密碼'}" style="flex:1;min-width:160px"><button class="btn sec" id="setpin">更新密碼</button>
      ${cfg.hasAdminPin ? '<button class="btn ghost" id="logout">登出</button>' : ''}</div>`;
    $('#setpin').onclick = async () => {
      const np = $('#newpin').value;
      if (np && np.length < 4) return toast('密碼最少 4 個字元');
      await api('/api/config', { method: 'POST', body: { newAdminPin: np } });
      session.set('adminPin', np); toast(np ? '密碼已更新' : '已取消管理員密碼'); mount(el);
    };
    if ($('#logout')) $('#logout').onclick = () => { session.set('adminPin', ''); mount(el); };
    return true;
  }
  if (!drawAdmin()) return;

  // ---- 管理員區 ----
  const box = $('#admin-only');
  box.innerHTML = `
    <div class="card"><h2>DeepSeek 設定</h2>
      <div id="keystate"></div>
      <label class="f"><span>API Key</span><input type="password" id="key" autocomplete="off" placeholder="${cfg.hasKey ? '已儲存；如需更換才輸入新 Key' : 'sk-…'}"></label>
      <label class="f"><span>Base URL</span><input type="text" id="base" value="${esc(cfg.baseUrl)}"><small class="muted">預設 https://api.deepseek.com（系統會自動接上 /chat/completions）；模型固定 ${esc(cfg.model)}</small></label>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">
        <label class="f"><span>每人每日上限（次）</span><input type="number" id="limit" min="1" max="1000" value="${cfg.dailyLimit}"></label>
        <label class="f"><span>預設檢索檔位</span><select id="mode">${MODES.map(([k, l]) => `<option value="${k}" ${k === cfg.defaultMode ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="row"><button class="btn" id="savecfg">儲存設定</button><button class="btn sec" id="test">測試連線</button>${cfg.hasKey ? '<button class="btn danger" id="clearkey">刪除 Key</button>' : ''}</div>
    </div>
    <div class="card"><h2>資料匯入</h2>
      <p class="muted">分類用「›」分隔層級，例如 <code>保單行政 › 財務</code>。原檔（PDF／圖片）會存到 files/，文字內容（OCR 全文）用於檢索及 AI 問答。</p>
      <label class="f"><span>標題</span><input type="text" id="dtitle"></label>
      <label class="f"><span>分類</span><input type="text" id="dcat" list="catlist" placeholder="保單行政 › 財務"><datalist id="catlist"></datalist></label>
      <label class="f"><span>來源</span><input type="text" id="dsrc" placeholder="例如 營運部通告 2026-10"></label>
      <label class="f"><span>原檔（可選：PDF / 圖片）</span><input type="file" id="dfile" accept=".pdf,image/*,.txt,.md"></label>
      <label class="f"><span>文字內容（OCR 全文）</span><textarea id="dcontent" rows="6" placeholder="貼上文件全文；AI 只會讀這裡的文字"></textarea></label>
      <button class="btn" id="adddoc">新增到資料庫</button>
    </div>
    <div class="card"><h2>資料管理</h2><div id="doclist" class="tbl-wrap"></div></div>
    <div class="card"><h2>使用日誌</h2><p class="muted">每次 AI 調用都會記錄（問題已遮罩身份證號及電話）。</p>
      <button class="btn sec" id="csv">匯出 CSV</button></div>`;

  const keyState = () => { $('#keystate').innerHTML = cfg.hasKey ? `<div class="notice ok">API Key 已儲存：<b>${esc(cfg.keyMasked)}</b>（無需重新輸入）</div>` : `<div class="notice warn">尚未設定 API Key</div>`; };
  keyState();
  $('#savecfg').onclick = async () => {
    try {
      const r = await api('/api/config', { method: 'POST', body: { apiKey: $('#key').value.trim(), baseUrl: $('#base').value.trim(), dailyLimit: +$('#limit').value, defaultMode: $('#mode').value } });
      $('#key').value = ''; cfg.hasKey = r.hasKey; cfg.keyMasked = r.keyMasked; keyState(); toast('設定已儲存');
    } catch (e) { toast(e.message); }
  };
  if ($('#clearkey')) $('#clearkey').onclick = async () => { if (!confirm('確定刪除已儲存的 API Key？')) return; await api('/api/config', { method: 'POST', body: { clearKey: true } }); mount(el); };
  $('#test').onclick = async () => {
    $('#test').disabled = true; $('#test').textContent = '測試中…';
    try { const r = await api('/api/config/test', { method: 'POST' }); toast(r.ok ? '連線成功' : '失敗：' + r.error, 5000); } catch (e) { toast(e.message); }
    $('#test').disabled = false; $('#test').textContent = '測試連線';
  };
  $('#csv').onclick = async () => {
    const r = await fetch('/api/logs.csv', { headers: headers() });
    if (!r.ok) return toast('匯出失敗');
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = url; a.download = `ai-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  async function drawDocs() {
    invalidateLibrary();
    const lib = await getLibrary(true);
    $('#catlist').innerHTML = [...new Set(lib.map(d => d.category))].map(c => `<option value="${esc(c)}">`).join('');
    $('#doclist').innerHTML = lib.length ? `<table class="t"><thead><tr><th>標題</th><th>分類</th><th>類型</th><th>更新</th><th></th></tr></thead><tbody>${lib.map(d =>
      `<tr><td><button class="btn small ghost" data-open="${esc(d.id)}" style="text-align:left">${esc(d.title)}</button></td><td>${esc(d.category)}</td><td>${esc(d.kind)}</td><td>${fmtDate(d.updatedAt)}</td><td><button class="btn small danger" data-del="${esc(d.id)}">刪除</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted" style="padding:8px">暫無資料</p>';
    $('#doclist').querySelectorAll('[data-open]').forEach(b => b.onclick = () => openReader(lib.find(d => d.id === b.dataset.open)));
    $('#doclist').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('確定刪除此文件？原檔亦會一併刪除。')) return;
      try { await api('/api/library/' + b.dataset.del, { method: 'DELETE' }); toast('已刪除'); drawDocs(); } catch (e) { toast(e.message); }
    });
  }
  $('#adddoc').onclick = async () => {
    const f = $('#dfile').files[0];
    const body = { title: $('#dtitle').value.trim() || (f && f.name.replace(/\.[^.]+$/, '')) || '', category: $('#dcat').value.trim(), source: $('#dsrc').value.trim(), content: $('#dcontent').value };
    if (!body.title) return toast('請輸入標題');
    if (!body.category) return toast('請輸入分類');
    if (f) {
      if (f.size > 30 * 1024 * 1024) return toast('檔案不可超過 30MB');
      body.fileName = f.name;
      body.fileBase64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
      if (/\.(txt|md)$/i.test(f.name) && !body.content) body.content = await f.text();
    }
    $('#adddoc').disabled = true;
    try { await api('/api/library', { method: 'POST', body }); toast('已新增'); ['dtitle', 'dsrc', 'dcontent'].forEach(k => $('#' + k).value = ''); $('#dfile').value = ''; drawDocs(); }
    catch (e) { toast(e.message); }
    $('#adddoc').disabled = false;
  };
  drawDocs();
}
