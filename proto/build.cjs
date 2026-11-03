// 打包「可點擊原型」：node proto/build.cjs <esbuild 路徑> <PDF 頁圖資料夾> <輸出檔>
// 產出單一 HTML（CSS/JS/圖片全部內嵌），可直接發佈或用瀏覽器打開，不需要 server.cjs。
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const [esbuildBin, pageDir, outFile, mode] = process.argv.slice(2);
// mode = "standalone"：輸出完整 HTML 文件（GitHub Pages 等一般網站用）；省略則輸出 claude.ai Artifact 用的頁面片段
const ROOT = path.join(__dirname, '..');
const P = (...a) => path.join(ROOT, ...a);
const dataUri = (file, mime) => `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;

// 1) 資料：資料庫 + 示例費率 + 原檔（圖片/ PDF 頁圖）
const lib = JSON.parse(fs.readFileSync(P('data/library.json'), 'utf8'));
const csv = fs.readFileSync(P('samples/rates-sample.csv'), 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/).slice(1);
const rates = csv.map(l => { const [productCode, productName, term, c, b, note] = l.split(','); return { productCode, productName, term, commissionRate: +c, boardRate: +b, note }; });
const files = {}, pdfPages = {};
for (const d of lib) {
  if (d.kind === 'image' && d.file) {
    const jpg = path.join(pageDir, path.basename(d.file, path.extname(d.file)) + '.jpg');
    files[d.file] = fs.existsSync(jpg) ? dataUri(jpg, 'image/jpeg') : dataUri(P('files', d.file), 'image/png');
  }
  if (d.kind === 'pdf' && d.file) {
    const stem = path.basename(d.file, '.pdf');
    pdfPages[d.file] = fs.readdirSync(pageDir).filter(f => f.startsWith(stem + '-')).sort().map(f => dataUri(path.join(pageDir, f), 'image/jpeg'));
  }
}
fs.writeFileSync(path.join(__dirname, 'assets.gen.js'),
  `export const LIBRARY = ${JSON.stringify(lib)};\nexport const RATES = ${JSON.stringify(rates)};\nexport const FILES = ${JSON.stringify(files)};\nexport const PDF_PAGES = ${JSON.stringify(pdfPages)};\n`);

// 2) JS 打包成一個 IIFE（pdf.js 在原型中不會用到，設為 external）
const js = execFileSync(esbuildBin, [path.join(__dirname, 'entry.js'), '--bundle', '--format=iife', '--minify', '--target=es2020', '--external:/vendor/*'], { maxBuffer: 64 * 1024 * 1024 }).toString().replace(/<\/script/gi, '<\\/script');

// 3) HTML
const css = fs.readFileSync(P('public/css/app.css'), 'utf8');
const icon = dataUri(P('public/icons/icon.svg'), 'image/svg+xml');
const idx = fs.readFileSync(P('public/index.html'), 'utf8');
const bodyHtml = idx.slice(idx.indexOf('<body>') + 6, idx.indexOf('<script type="module"')).replace('/icons/icon.svg', icon);
const html = `<title>卓越 Summit 寶典</title>
<meta name="theme-color" content="#d0102f">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&family=Noto+Serif+TC:wght@700;900&display=swap">
<style>
${css}
/* —— 原型專用 —— */
:root{font-family:"Noto Sans TC",-apple-system,BlinkMacSystemFont,"PingFang HK","Microsoft JhengHei",sans-serif;--serif:"Noto Serif TC","Songti TC","PMingLiU",serif;color-scheme:light}
html,body{background:#f6efe9;color:#22161a}
body::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);z-index:40;background:#d0102f}
.topbar{padding-top:18px}
.proto-tag{display:inline-block;margin-right:10px;font-size:11px;font-weight:800;letter-spacing:.12em;color:#5e0616;background:#ffd27a;padding:3px 9px;border-radius:99px;vertical-align:2px}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style>
${bodyHtml}
<script>
${js}
</script>
`;
const out = mode === 'standalone'
  ? `<!doctype html>\n<html lang="zh-HK">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<link rel="icon" href="${icon}">\n${html.slice(0, html.indexOf('</style>') + 8)}\n<style>.topbar{padding-top:calc(18px + env(safe-area-inset-top,0px))}#bottom-nav{bottom:calc(10px + env(safe-area-inset-bottom,0px))}</style>\n</head>\n<body>\n${html.slice(html.indexOf('</style>') + 8)}</body>\n</html>\n`
  : html;
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, out);
console.log('原型已輸出：', outFile, (out.length / 1024).toFixed(0) + ' KB');
