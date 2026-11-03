// 全屏閱讀視圖：當前頁內彈出，不用 window.open、不跳轉下載
import { esc, icon, $, KIND_LABEL, fmtDate } from './util.js';
import { highlight } from './search.js';
import { getDoc } from './data.js';

const PDFJS = '/vendor/pdfjs/';
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    // pdf.js 是 ES Module：必須用絕對路徑動態 import，並設 workerSrc
    pdfjsPromise = import('/vendor/pdfjs/pdf.min.js').then(m => {
      m.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
      return m;
    }).catch(e => { pdfjsPromise = null; throw e; });
  }
  return pdfjsPromise;
}

/* 疊層堆疊：手機返回鍵 / 瀏覽器上一頁 先關最上一層 */
const layers = [];
function pushLayer(close) {
  layers.push(close);
  history.pushState({ ikbLayer: layers.length }, '');
}
function closeTop(fromPop) {
  const close = layers.pop();
  if (!close) return;
  close();
  if (!fromPop) { ignorePop++; history.back(); }
}
let ignorePop = 0;
window.addEventListener('popstate', () => {
  if (ignorePop) { ignorePop--; return; }
  if (layers.length) closeTop(true);
});
export const readerOpen = () => layers.length > 0;

export async function openReaderById(id, opts = {}) {
  const doc = await getDoc(id);
  if (!doc) { alert('找不到此文件，可能已被刪除'); return; }
  openReader(doc, opts);
}

export function openReader(doc, { terms = [] } = {}) {
  const root = $('#reader-root');
  const hasOriginal = !!doc.file && (doc.kind === 'pdf' || doc.kind === 'image');
  // window.__PROTO：只在「可點擊原型」打包版存在（檔案以 data URI 內嵌），正式版為 undefined
  const proto = window.__PROTO;
  const fileUrl = doc.file ? ((proto && proto.files[doc.file]) || '/files/' + encodeURIComponent(doc.file)) : '';
  let mode = hasOriginal ? 'original' : 'text';
  let cleanup = () => {};

  const el = document.createElement('div');
  el.className = 'reader';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', doc.title);
  el.innerHTML = `
    <div class="reader-bar">
      <button class="icon-btn" data-act="close" aria-label="返回">${icon('back')}</button>
      <div class="ttl"><b>${esc(doc.title)}</b><small>${esc(doc.category)}${doc.source ? '　來源：' + esc(doc.source) : ''}${doc.updatedAt ? '　更新：' + fmtDate(doc.updatedAt) : ''}</small></div>
      ${hasOriginal ? `<button class="btn small sec" data-act="toggle"></button>` : ''}
    </div>
    <div class="reader-body" tabindex="-1"></div>`;
  root.appendChild(el);
  document.body.style.overflow = 'hidden';
  const body = $('.reader-body', el);
  const toggleBtn = $('[data-act=toggle]', el);

  function render() {
    cleanup(); cleanup = () => {};
    body.scrollTop = 0;
    if (toggleBtn) toggleBtn.innerHTML = mode === 'original' ? `${icon('text', 'width="18" height="18"')}顯示文字內容` : `${icon('file', 'width="18" height="18"')}顯示原檔`;
    if (mode === 'text') return renderText();
    if (doc.kind === 'image') return renderImage();
    if (doc.kind === 'pdf') return renderPdf();
  }
  function renderText() {
    const txt = String(doc.content || '').trim();
    body.innerHTML = txt
      ? `<div class="text-view">${highlight(txt, terms)}</div>`
      : `<div class="reader-msg">此文件未有文字內容（未做 OCR）。${hasOriginal ? '請按「顯示原檔」查看。' : ''}</div>`;
    const first = $('mark', body);
    if (first) setTimeout(() => first.scrollIntoView({ block: 'center' }), 50);
  }
  function renderImage() {
    body.innerHTML = `<img class="img-full" src="${fileUrl}" alt="${esc(doc.title)}">`;
    const img = $('img', body);
    img.onerror = () => { body.innerHTML = `<div class="reader-msg">圖片載入失敗${navigator.onLine ? '' : '（目前離線，此檔未曾開啟過）'}。</div>`; };
    img.onclick = () => openZoom(fileUrl, doc.title);
  }
  function renderPdf() {
    if (proto) {
      const pages = proto.pdfPages[doc.file];
      body.innerHTML = pages
        ? pages.map((src, i) => `<div class="pdf-page"><img src="${src}" alt="第 ${i + 1} 頁" style="display:block;width:100%"><span class="pg">${i + 1} / ${pages.length}</span></div>`).join('')
        : `<div class="reader-msg">示範版未能預覽新上載的 PDF，請按上方「顯示文字內容」。</div>`;
      return;
    }
    body.innerHTML = `<div class="reader-msg">正在載入 PDF…</div>`;
    let task = null, observer = null, dead = false;
    cleanup = () => { dead = true; observer && observer.disconnect(); task && task.destroy(); };
    loadPdfjs().then(async pdfjs => {
      if (dead) return;
      task = pdfjs.getDocument({
        url: fileUrl,
        cMapUrl: PDFJS + 'cmaps/', cMapPacked: true,          // 中文 PDF 需要 cmaps
        standardFontDataUrl: PDFJS + 'standard_fonts/',
        disableRange: true, disableStream: true, disableAutoFetch: true,
        isEvalSupported: false,
      });
      const pdf = await task.promise;
      if (dead) return;
      const p1 = await pdf.getPage(1);
      const v1 = p1.getViewport({ scale: 1 });
      body.innerHTML = '';
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const div = document.createElement('div');
        div.className = 'pdf-page';
        div.style.aspectRatio = `${v1.width} / ${v1.height}`;
        div.dataset.page = i;
        div.innerHTML = `<div class="ph">第 ${i} 頁</div><span class="pg">${i} / ${pdf.numPages}</span>`;
        body.appendChild(div); pages.push(div);
      }
      const rendering = new Set();
      async function renderPage(div) {
        const n = +div.dataset.page;
        if (div.dataset.done || rendering.has(n)) return;
        rendering.add(n);
        try {
          const page = await pdf.getPage(n);
          if (dead) return;
          const base = page.getViewport({ scale: 1 });
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          let scale = (div.clientWidth / base.width) * dpr;
          scale = Math.min(scale, 4096 / base.width); // 控制 canvas 尺寸，避免手機記憶體爆
          const vp = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
          canvas.setAttribute('aria-label', `第 ${n} 頁`);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
          if (dead) return;
          div.style.aspectRatio = `${base.width} / ${base.height}`;
          const ph = $('.ph', div); ph && ph.remove();
          div.prepend(canvas);
          div.dataset.done = '1';
        } catch (e) {
          if (!dead) { const ph = $('.ph', div); if (ph) ph.textContent = '此頁渲染失敗'; }
        } finally { rendering.delete(n); }
      }
      // 懶載入：接近可見範圍才渲染
      if ('IntersectionObserver' in window) {
        observer = new IntersectionObserver(entries => {
          for (const en of entries) if (en.isIntersecting) renderPage(en.target);
        }, { root: body, rootMargin: '800px 0px' });
        pages.forEach(p => observer.observe(p));
      } else pages.slice(0, 3).forEach(renderPage);
    }).catch(e => {
      if (dead) return;
      console.error(e);
      body.innerHTML = `<div class="reader-msg">PDF 載入失敗：${esc(e.message || e)}${navigator.onLine ? '' : '<br>（目前離線，此檔未曾開啟過）'}<br><br>${doc.content ? '可按上方「顯示文字內容」閱讀 OCR 文字。' : ''}</div>`;
    });
  }

  function close() {
    cleanup();
    el.remove();
    if (!layers.length) document.body.style.overflow = '';
  }
  el.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') closeTop(false);
    if (act === 'toggle') { mode = mode === 'original' ? 'text' : 'original'; render(); }
  });
  pushLayer(close);
  render();
  $('[data-act=close]', el).focus();
}

function openZoom(src, alt) {
  const z = document.createElement('div');
  z.className = 'zoom';
  z.innerHTML = `<img src="${src}" alt="${esc(alt)}"><button class="icon-btn" aria-label="關閉放大">${icon('close')}</button>`;
  $('#reader-root').appendChild(z);
  let big = true;
  const img = $('img', z);
  img.onclick = () => { big = !big; img.style.width = big ? '220%' : '100%'; };
  $('button', z).onclick = () => closeTop(false);
  pushLayer(() => z.remove());
}

export { KIND_LABEL };
