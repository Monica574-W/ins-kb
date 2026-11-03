import { esc, streamPost, typewriter, copyText, toast, store } from '../util.js';
import { getLibrary } from '../data.js';
import { catPath } from '../search.js';
import { openReaderById } from '../reader.js';

const NEEDS = ['儲蓄', '退休', '子女教育', '危疾保障', '醫療', '人壽保障', '財富傳承', '意外'];
let last = { text: '', productId: '' };

export async function mount(el) {
  let lib = [];
  try { lib = await getLibrary(); } catch {}
  // 產品文件優先：分類路徑任何一層含「產品」
  const isProd = d => catPath(d).some(s => s.includes('產品'));
  const prods = lib.filter(isProd), others = lib.filter(d => !isProd(d));
  const opt = d => `<option value="${esc(d.id)}">${esc(d.title)}</option>`;
  const saved = store.get('planForm', {});
  el.innerHTML = `
    <div class="card">
      <p class="muted" style="margin-top:0">揀選產品文件並輸入客戶條件，AI 會只根據該產品文件生成講解重點、話術及異議處理（每次用 1 次 AI 額度）。</p>
      <label class="f"><span>產品</span><select id="pid"><option value="">— 請選擇 —</option>
        ${prods.length ? `<optgroup label="產品資料">${prods.map(opt).join('')}</optgroup>` : ''}
        ${others.length ? `<optgroup label="其他文件">${others.map(opt).join('')}</optgroup>` : ''}</select></label>
      <div class="row" style="margin:-4px 0 12px"><button class="btn small ghost" id="viewdoc" type="button">查看產品文件</button></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
        <label class="f"><span>年齡</span><input type="number" id="age" inputmode="numeric" min="0" max="100"></label>
        <label class="f"><span>性別</span><select id="gender"><option value="">不指定</option><option>男</option><option>女</option></select></label>
        <label class="f"><span>吸煙</span><select id="smoker"><option value="">不指定</option><option>非吸煙</option><option>吸煙</option></select></label>
        <label class="f"><span>每年預算</span><input type="text" id="budget" placeholder="例如 HKD 30,000"></label>
      </div>
      <label class="f"><span>家庭狀況</span><input type="text" id="family" placeholder="例如 已婚，一名 5 歲子女"></label>
      <div class="f"><span style="display:block;font-size:14px;font-weight:600;color:var(--ink2);margin-bottom:6px">主要需要（可多選）</span>
        <div class="row" id="needs">${NEEDS.map(n => `<button type="button" class="chip" data-need="${n}">${n}</button>`).join('')}</div></div>
      <label class="f"><span>風險取向</span><select id="risk"><option value="">不指定</option><option>保守</option><option>中等</option><option>進取</option></select></label>
      <label class="f"><span>其他備註</span><textarea id="note" placeholder="例如 客戶關心提早退保損失"></textarea></label>
      <button class="btn block" id="gen">生成講解筆記</button>
    </div>
    <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">講解筆記</h2><button class="btn small sec" id="copy">複製全部</button></div>
      <div class="out" id="out" style="margin-top:10px"></div></div>`;
  const $ = s => el.querySelector(s);
  const ids = ['pid', 'age', 'gender', 'smoker', 'budget', 'family', 'risk', 'note'];
  ids.forEach(k => { if (saved[k] != null) $('#' + k).value = saved[k]; });
  const needs = new Set(saved.needs || []);
  el.querySelectorAll('[data-need]').forEach(b => { b.classList.toggle('on', needs.has(b.dataset.need)); b.onclick = () => { needs.has(b.dataset.need) ? needs.delete(b.dataset.need) : needs.add(b.dataset.need); b.classList.toggle('on'); }; });
  const out = $('#out');
  out.textContent = last.text || '尚未生成。';
  $('#copy').onclick = () => last.text ? copyText(last.text) : toast('尚未有內容');
  $("#viewdoc").onclick = () => $('#pid').value ? openReaderById($('#pid').value) : toast('請先選擇產品');

  let busy = false;
  $('#gen').onclick = async () => {
    if (busy) return;
    const productId = $('#pid').value;
    if (!productId) return toast('請先選擇產品');
    const form = Object.fromEntries(ids.map(k => [k, $('#' + k).value.trim()]));
    form.needs = [...needs];
    store.set('planForm', form);
    const client = { age: form.age, gender: form.gender, smoker: form.smoker, budget: form.budget, family: form.family, needs: form.needs.join('、'), risk: form.risk, note: form.note };
    busy = true; $('#gen').disabled = true; $('#gen').textContent = '生成中…';
    out.textContent = ''; out.classList.add('caret');
    last = { text: '', productId };
    const tw = typewriter(t => { last.text = t; out.textContent = t; });
    const end = () => tw.end(() => { busy = false; $('#gen').disabled = false; $('#gen').textContent = '重新生成'; out.classList.remove('caret'); });
    await streamPost('/api/plan', { productId, client }, {
      delta: t => tw.push(t),
      done: end,
      error: msg => { tw.push((last.text ? '\n\n' : '') + '【錯誤】' + msg); end(); },
    });
  };
}
