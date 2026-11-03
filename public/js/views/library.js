import { esc, icon, fmtDate, KIND_LABEL, session } from '../util.js';
import { getLibrary } from '../data.js';
import { buildTree, nodeAt, searchDocs, highlight, snippets } from '../search.js';
import { openReader } from '../reader.js';

// 狀態：分類路徑一律用陣列保存（不拼字串再解析）
const state = { path: [], q: '' };
try { const p = JSON.parse(session.get('libPath') || '[]'); if (Array.isArray(p)) state.path = p.map(String); } catch {}

export async function mount(el) {
  el.innerHTML = `
    <div class="search-box">${icon('search')}
      <input type="search" id="q" placeholder="搜尋標題或內文；留空則按分類瀏覽" autocomplete="off" enterkeyhint="search" aria-label="搜尋資料">
    </div>
    <div id="body"><p class="muted">載入中…</p></div>`;
  const body = el.querySelector('#body'), input = el.querySelector('#q');
  input.value = state.q;
  let lib = [];
  try { lib = await getLibrary(); } catch (e) {
    body.innerHTML = `<div class="notice err">${navigator.onLine ? '讀取資料失敗：' + esc(e.message) : '目前離線，且未曾載入過資料。請連線後再開啟一次。'}</div>`;
    return;
  }
  const tree = buildTree(lib);
  const docMap = new Map(lib.map(d => [d.id, d]));
  let lastTerms = [];

  const setPath = p => { state.path = p; session.set('libPath', JSON.stringify(p)); draw(); window.scrollTo(0, 0); };

  function docItem(d, terms = [], snips = []) {
    return `<button class="doc-item" data-id="${esc(d.id)}">
      <div class="tt"><span class="kind ${esc(d.kind)}">${KIND_LABEL[d.kind] || '文字'}</span>${highlight(d.title, terms)}</div>
      <div class="meta">${esc(d.category)}${d.updatedAt ? '　' + fmtDate(d.updatedAt) : ''}</div>
      ${snips.map(s => `<div class="snip">${s}</div>`).join('')}</button>`;
  }

  function drawBrowse() {
    let node = nodeAt(tree, state.path);
    if (!node) { state.path = []; node = tree; }
    const p = state.path;
    let html = '';
    if (p.length) {
      // 麵包屑
      html += `<nav class="crumbs" aria-label="分類路徑"><button data-crumb="0">全部</button>${p.map((seg, i) => i === p.length - 1
        ? `<span>›</span><span class="cur">${esc(seg)}</span>`
        : `<span>›</span><button data-crumb="${i + 1}">${esc(seg)}</button>`).join('')}</nav>`;
      // 同級標籤：可直接跳到兄弟分類
      const parent = nodeAt(tree, p.slice(0, -1));
      if (parent && parent.children.size > 1) {
        html += `<div class="sibs" role="tablist">${[...parent.children.keys()].map((name, i) =>
          `<button class="chip ${name === p[p.length - 1] ? 'on' : ''}" role="tab" aria-selected="${name === p[p.length - 1]}" data-sib="${i}">${esc(name)}</button>`).join('')}</div>`;
      }
    } else {
      html += `<p class="muted" style="margin-top:0">共 ${lib.length} 份文件。選擇分類逐層瀏覽：</p>`;
    }
    const kids = [...node.children.values()];
    if (kids.length) {
      html += `<div class="grid" style="margin-bottom:16px">${kids.map((c, i) =>
        `<button class="cat-card" data-child="${i}"><span class="ic">${icon('folder')}</span><span>${esc(c.name)}</span><small>${c.count} 份${c.children.size ? `・${c.children.size} 個子分類` : ''}</small></button>`).join('')}</div>`;
    }
    if (node.docs.length) {
      html += (kids.length ? `<h3 style="font-size:15px;color:var(--mute)">本層文件</h3>` : '') +
        node.docs.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map(d => docItem(d)).join('');
    }
    if (!kids.length && !node.docs.length) html += `<p class="muted">此分類暫無文件。</p>`;
    body.innerHTML = html;
    // 事件：用索引對應陣列，不從文字反解析
    body.querySelectorAll('[data-crumb]').forEach(b => b.onclick = () => setPath(p.slice(0, +b.dataset.crumb)));
    body.querySelectorAll('[data-child]').forEach(b => b.onclick = () => setPath([...p, kids[+b.dataset.child].name]));
    const parent = nodeAt(tree, p.slice(0, -1));
    body.querySelectorAll('[data-sib]').forEach(b => b.onclick = () => setPath([...p.slice(0, -1), [...parent.children.keys()][+b.dataset.sib]]));
    lastTerms = [];
  }

  function drawSearch() {
    const { terms, results, tooShort } = searchDocs(lib, state.q);
    lastTerms = terms;
    if (tooShort) { body.innerHTML = `<p class="muted">請輸入至少 2 個字（或 2 個英文字母／數字）。</p>`; return; }
    body.innerHTML = `<p class="muted" style="margin-top:0">找到 ${results.length} 份相關文件（按相關度排序）</p>` +
      (results.length ? results.slice(0, 100).map(r => docItem(r.doc, terms, snippets(r.doc.content, terms, 2))).join('') : `<div class="notice warn">沒有找到相關文件，試試其他關鍵詞。</div>`);
  }

  function draw() { state.q.trim() ? drawSearch() : drawBrowse(); }

  input.addEventListener('input', () => { state.q = input.value; draw(); });
  body.addEventListener('click', e => {
    const b = e.target.closest('[data-id]');
    if (b) { const d = docMap.get(b.dataset.id); if (d) openReader(d, { terms: lastTerms }); }
  });
  draw();
}
