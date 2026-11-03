import { api, esc, toast } from '../util.js';

/* 計算口徑（與費率表欄位一一對應，不作任何假設）：
 *   首年佣金 = 年化保費 × 首年佣金率(%)
 *   上板數   = 年化保費 × 上板率(%)
 * 找不到對應「產品＋年期」的費率時，一律不計算並提示。 */

const list = []; // 計算清單（記憶體）

export function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(x => x.trim())).filter(r => r.some(Boolean));
}
const COLS = {
  productCode: /代碼|編號|code/i,
  productName: /產品名稱|產品|計劃|product|plan/i,
  term: /年期|term/i,
  commissionRate: /佣金率|commission/i,
  boardRate: /上板/i,
  note: /備註|note|remark/i,
};
function rowsToRates(rows) {
  const head = rows[0] || [];
  const idx = {};
  for (const [k, re] of Object.entries(COLS)) idx[k] = head.findIndex((h, i) => re.test(h) && !Object.values(idx).includes(i));
  if (idx.productName < 0 || idx.term < 0 || idx.commissionRate < 0 || idx.boardRate < 0) throw new Error('表頭必須包含：產品名稱、供款年期、首年佣金率(%)、上板率(%)');
  const num = s => { const v = parseFloat(String(s || '').replace(/[%,\s]/g, '')); return isFinite(v) ? v : NaN; };
  return rows.slice(1).map(r => ({
    productCode: idx.productCode >= 0 ? r[idx.productCode] : '', productName: r[idx.productName], term: r[idx.term],
    commissionRate: num(r[idx.commissionRate]), boardRate: num(r[idx.boardRate]), note: idx.note >= 0 ? r[idx.note] : '',
  }));
}
const money = v => v.toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function mount(el) {
  el.innerHTML = `<div id="calc"></div>
    <details class="card" id="imp"><summary style="cursor:pointer;font-weight:700;min-height:32px">匯入 / 更新佣金費率表（管理員）</summary>
      <p class="muted">CSV 表頭：<code>產品代碼,產品名稱,供款年期,首年佣金率(%),上板率(%),備註</code>。可從 Excel「另存為 CSV UTF-8」。同一「產品名稱＋年期」會被覆蓋。</p>
      <label class="f"><span>選擇 CSV 檔</span><input type="file" id="csvf" accept=".csv,text/csv,.txt"></label>
      <label class="f"><span>或直接貼上</span><textarea id="csvt" placeholder="產品名稱,供款年期,首年佣金率(%),上板率(%)"></textarea></label>
      <label class="row" style="margin-bottom:12px"><input type="checkbox" id="replace" style="width:22px;height:22px"> 取代整份費率表（不勾選 = 合併更新）</label>
      <button class="btn" id="doimp">匯入</button>
      <div id="rtable" style="margin-top:14px"></div>
    </details>`;
  const calc = el.querySelector('#calc');
  let rates = [];
  async function load() {
    try { rates = await api('/api/rates'); } catch (e) { rates = null; calc.innerHTML = `<div class="notice err">無法讀取費率表：${esc(e.message)}</div>`; return; }
    drawCalc(); drawTable();
  }
  function drawTable() {
    el.querySelector('#rtable').innerHTML = rates.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>產品</th><th>年期</th><th>首年佣金率</th><th>上板率</th><th>備註</th></tr></thead><tbody>${rates.map(r => `<tr><td>${esc(r.productName)}${r.productCode ? `<br><small class="muted">${esc(r.productCode)}</small>` : ''}</td><td>${esc(r.term)}</td><td>${r.commissionRate}%</td><td>${r.boardRate}%</td><td>${esc(r.note)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">目前沒有任何費率。</p>';
  }
  function drawCalc() {
    if (!rates.length) {
      calc.innerHTML = `<div class="notice err"><b>尚未匯入佣金費率表，無法計算。</b><br>為免算錯，系統不會使用任何預設或估算費率。請由管理員在下方「匯入佣金費率表」上載公司最新費率。</div>`;
      el.querySelector('#imp').open = true;
      return;
    }
    const products = [...new Set(rates.map(r => r.productName))];
    calc.innerHTML = `<div class="card">
      <label class="f"><span>產品</span><select id="prod">${products.map(p => `<option>${esc(p)}</option>`).join('')}</select></label>
      <label class="f"><span>供款年期</span><select id="term"></select></label>
      <label class="f"><span>年化保費（HKD / 保單貨幣）</span><input type="number" id="prem" inputmode="decimal" min="0" step="0.01" placeholder="例如 24000"></label>
      <div id="res"></div>
      <div class="row"><button class="btn sec" id="add">加入計算清單</button></div>
    </div>
    <div class="card" id="listcard"></div>`;
    const prod = calc.querySelector('#prod'), term = calc.querySelector('#term'), prem = calc.querySelector('#prem');
    const fillTerms = () => { term.innerHTML = rates.filter(r => r.productName === prod.value).map(r => `<option>${esc(r.term)}</option>`).join(''); };
    const compute = () => {
      const r = rates.find(x => x.productName === prod.value && x.term === term.value);
      const p = parseFloat(prem.value);
      const res = calc.querySelector('#res');
      if (!r) { res.innerHTML = `<div class="notice err">此產品／年期沒有費率資料，無法計算。</div>`; return null; }
      if (!(p > 0)) { res.innerHTML = `<div class="notice warn">首年佣金率 <b>${r.commissionRate}%</b>　上板率 <b>${r.boardRate}%</b>。請輸入年化保費以計算。</div>`; return null; }
      const c = p * r.commissionRate / 100, b = p * r.boardRate / 100;
      res.innerHTML = `<div class="result"><div class="big">
        <div><div class="k">首年佣金</div><div class="v gold">${money(c)}</div><span class="rate">佣金率 ${r.commissionRate}%</span></div>
        <div><div class="k">上板數</div><div class="v">${money(b)}</div><span class="rate">上板率 ${r.boardRate}%</span></div></div>
        <div class="formula">${money(p)} × ${r.commissionRate}% = ${money(c)}<br>${money(p)} × ${r.boardRate}% = ${money(b)}${r.note ? '<br>備註：' + esc(r.note) : ''}<br>結果只供參考，以公司正式結算為準。</div></div>`;
      return { r, p, c, b };
    };
    prod.onchange = () => { fillTerms(); compute(); };
    term.onchange = compute; prem.oninput = compute;
    calc.querySelector('#add').onclick = () => { const v = compute(); if (!v) return toast('請先完成輸入'); list.push(v); drawList(); };
    const drawList = () => {
      const lc = calc.querySelector('#listcard');
      if (!list.length) { lc.innerHTML = '<h3>計算清單</h3><p class="muted">可加入多張保單合計上板數。</p>'; return; }
      const sc = list.reduce((a, x) => a + x.c, 0), sb = list.reduce((a, x) => a + x.b, 0), sp = list.reduce((a, x) => a + x.p, 0);
      lc.innerHTML = `<h3>計算清單</h3><div class="tbl-wrap"><table class="t"><thead><tr><th>產品／年期</th><th>年化保費</th><th>佣金</th><th>上板數</th><th></th></tr></thead><tbody>
        ${list.map((x, i) => `<tr><td>${esc(x.r.productName)}<br><small class="muted">${esc(x.r.term)}</small></td><td>${money(x.p)}</td><td>${money(x.c)}</td><td>${money(x.b)}</td><td><button class="btn small ghost" data-del="${i}">刪除</button></td></tr>`).join('')}
        <tr><th>合計</th><th>${money(sp)}</th><th>${money(sc)}</th><th>${money(sb)}</th><th></th></tr></tbody></table></div>`;
      lc.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { list.splice(+b.dataset.del, 1); drawList(); });
    };
    fillTerms(); compute(); drawList();
  }
  el.querySelector('#csvf').onchange = async e => { const f = e.target.files[0]; if (f) el.querySelector('#csvt').value = await f.text(); };
  el.querySelector('#doimp').onclick = async () => {
    try {
      const rows = parseCSV(el.querySelector('#csvt').value);
      if (rows.length < 2) throw new Error('沒有資料列');
      const parsed = rowsToRates(rows);
      const r = await api('/api/rates', { method: 'POST', body: { rates: parsed, replace: el.querySelector('#replace').checked } });
      toast(`已匯入 ${r.imported} 條${r.skipped ? `，略過 ${r.skipped} 條無效資料` : ''}`, 3500);
      el.querySelector('#csvt').value = '';
      load();
    } catch (e) { toast(e.message, 4000); }
  };
  load();
}
