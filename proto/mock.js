// 可點擊原型：用記憶體模擬 server.cjs 的全部 API（不連 DeepSeek、不存檔，重新整理即還原）
import { searchDocs, snippets } from '../public/js/search.js';
import { LIBRARY, RATES, FILES, PDF_PAGES } from './assets.gen.js';

const ALIAS = { setup: 'settings' };           // claude.ai 保留了 #settings
const TO_HASH = { settings: 'setup' };
window.__PROTO = {
  files: FILES, pdfPages: PDF_PAGES, alias: ALIAS,
  toHash: n => TO_HASH[n] || n,
};
window.confirm = () => true;                    // 原型內不彈對話框

const db = {
  lib: LIBRARY.map(d => ({ ...d })),
  rates: RATES.map(r => ({ ...r })),
  cfg: { hasKey: true, keyMasked: 'sk-****demo', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', dailyLimit: 50, defaultMode: 'standard', hasAdminPin: false, isAdmin: true },
  used: 3, todayCalls: 12, todayUsers: 4, noHit: 1,
  logs: [],
};

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

function sseStream(meta, text, delay = 18) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    async start(c) {
      await sleep(350);
      c.enqueue(enc.encode(`event: meta\ndata: ${JSON.stringify(meta)}\n\n`));
      for (let i = 0; i < text.length; i += 6) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ d: text.slice(i, i + 6) })}\n\n`));
        await sleep(delay);
      }
      c.enqueue(enc.encode(`event: done\ndata: {}\n\n`));
      c.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

function firstSentence(content, terms) {
  const parts = String(content).replace(/^【示例文件】[^\n]*\n?/, '').split(/(?<=[。；\n])/).map(s => s.trim()).filter(s => s.length > 6);
  return parts.find(s => terms.some(t => s.toLowerCase().includes(t))) || parts[0] || '';
}

function ask(body) {
  const q = String(body.question || '');
  const { terms, results } = searchDocs(db.lib, q);
  db.logs.push({ time: new Date().toLocaleString('zh-HK'), q, hits: results.length });
  if (!results.length) {
    db.noHit++;
    return sseStream({ sources: [], remaining: null, noHit: true }, '現有資料庫中未找到與此問題相關的文件，所以無法作答。\n\n建議：換個關鍵詞（例如「冷靜期」、「退保」、「寬限期」）再試，或到「資料總覽」瀏覽分類。');
  }
  db.used++; db.todayCalls++;
  const top = results.slice(0, 3);
  const sources = top.map((r, i) => ({ n: i + 1, id: r.doc.id, title: r.doc.title, category: r.doc.category, start: 0 }));
  const lines = top.map((r, i) => `- ${firstSentence(r.doc.content, terms)} [${i + 1}]`).join('\n');
  const text = `**（示範回答）以下重點摘自資料庫文件：**\n${lines}\n\n正式版會由 DeepSeek 只根據這些文件整理成完整答案。`;
  return sseStream({ sources, remaining: db.cfg.dailyLimit - db.used, limit: db.cfg.dailyLimit }, text);
}

function plan(body) {
  const d = db.lib.find(x => x.id === body.productId);
  if (!d) return json({ error: '請先選擇產品文件' }, 400);
  db.used++; db.todayCalls++;
  const c = body.client || {};
  const who = [c.age && `${c.age} 歲`, c.gender, c.family].filter(Boolean).join('，') || '（未填寫）';
  const needs = c.needs || '儲蓄';
  const facts = String(d.content).replace(/【示例文件】[^\n]*\n?/, '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 3);
  const text = `（示範內容，正式版由 AI 根據產品文件生成）

一、講解重點
- 客戶：${who}；主要需要：${needs}${c.budget ? `；每年預算 ${c.budget}` : ''}
${facts.map(f => '- ' + f).join('\n')}

二、建議開場及講解話術
「你之前提過想${needs.split('、')[0]}，我揀咗《${d.title}》同你講下，佢最適合你嘅地方係……」

三、常見異議及處理
客戶：而家唔急住買，遲啲先算？
回應：越早開始，供款期越早完成；可以先由較細預算開始。
客戶：提早退保會唔會蝕？
回應：文件列明提早退保可能取回少於已繳保費，所以建議用長線閒錢。

四、合規提示
- 提醒客戶冷靜期為 21 個曆日
- 交付重要資料聲明書及利益說明文件，並逐項解釋`;
  return sseStream({ sources: [{ n: 1, id: d.id, title: d.title, category: d.category }] }, text, 12);
}

const KIND = { pdf: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image' };

async function route(path, method, body) {
  if (path === '/api/library' && method === 'GET') return json(db.lib);
  if (path === '/api/library' && method === 'POST') {
    const id = 'doc_' + Math.random().toString(36).slice(2, 9);
    const d = { id, title: body.title, category: String(body.category || '未分類').split(/›|>/).map(s => s.trim()).filter(Boolean).join(' › '), content: body.content || '', source: body.source || '', file: '', kind: 'text', updatedAt: new Date().toISOString() };
    if (body.fileBase64 && body.fileName) {
      const ext = body.fileName.split('.').pop().toLowerCase();
      d.file = id + '.' + ext; d.kind = KIND[ext] || 'other';
      FILES[d.file] = body.fileBase64;
    }
    db.lib.push(d);
    return json(d);
  }
  const del = path.match(/^\/api\/library\/(.+)$/);
  if (del && method === 'DELETE') { db.lib = db.lib.filter(d => d.id !== del[1]); return json({ ok: true }); }
  if (path === '/api/config' && method === 'GET') return json(db.cfg);
  if (path === '/api/config' && method === 'POST') {
    if (body.apiKey) db.cfg.keyMasked = body.apiKey.slice(0, 3) + '****' + body.apiKey.slice(-4);
    if (body.clearKey) { db.cfg.hasKey = false; db.cfg.keyMasked = ''; } else if (body.apiKey) db.cfg.hasKey = true;
    if (body.dailyLimit) db.cfg.dailyLimit = +body.dailyLimit;
    if (body.defaultMode) db.cfg.defaultMode = body.defaultMode;
    if (body.baseUrl) db.cfg.baseUrl = body.baseUrl;
    return json({ ok: true, hasKey: db.cfg.hasKey, keyMasked: db.cfg.keyMasked });
  }
  if (path === '/api/config/test') { await sleep(600); return json({ ok: true, reply: 'OK（示範）' }); }
  if (path === '/api/admin/check') return json({ ok: true });
  if (path === '/api/stats') {
    const cats = new Set(db.lib.map(d => d.category));
    return json({
      docs: db.lib.length, categories: cats.size, hasKey: db.cfg.hasKey, limit: db.cfg.dailyLimit, myUsed: db.used, me: 'staff:DEMO',
      todayCalls: db.todayCalls, todayUsers: db.todayUsers, rates: db.rates.length, logs: db.logs.length, todayNoHit: db.noHit,
      recent: db.lib.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 5),
    });
  }
  if (path === '/api/rates' && method === 'GET') return json(db.rates);
  if (path === '/api/rates' && method === 'POST') {
    const clean = (body.rates || []).filter(r => r.productName && r.term && isFinite(r.commissionRate) && isFinite(r.boardRate));
    if (body.replace) db.rates = clean;
    else for (const r of clean) { db.rates = db.rates.filter(x => !(x.productName === r.productName && x.term === r.term)); db.rates.push(r); }
    return json({ ok: true, imported: clean.length, skipped: (body.rates || []).length - clean.length, total: db.rates.length });
  }
  if (path === '/api/logs.csv') return new Response('﻿時間,問題,命中文件數\n' + db.logs.map(l => `${l.time},${l.q},${l.hits}`).join('\n'), { headers: { 'Content-Type': 'text/csv' } });
  if (path === '/api/ask') return ask(body);
  if (path === '/api/plan') return plan(body);
  return json({ error: '未知 API' }, 404);
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api/')) return realFetch(input, init);
  const path = url.split('?')[0];
  let body = {};
  try { body = init.body ? JSON.parse(init.body) : {}; } catch {}
  await sleep(120);
  return route(path, (init.method || 'GET').toUpperCase(), body);
};

// 站內連結 #/xxx → #xxx（artifact 只同步純 #name）
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[href^="#/"]');
  if (!a) return;
  e.preventDefault();
  const name = a.getAttribute('href').slice(2).split('?')[0];
  location.hash = '#' + window.__PROTO.toHash(name);
}, true);

try { if (!localStorage.getItem('ikb:staffId')) localStorage.setItem('ikb:staffId', '"DEMO"'); } catch {}
