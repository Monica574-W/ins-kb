#!/usr/bin/env node
/* 卓越 Summit 寶典 — 本地伺服器（只用 Node 內置模組，無任何 npm 依賴）
 * 啟動：node server.cjs   → http://localhost:8788
 */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 8788;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const FILES_DIR = path.join(ROOT, 'files');
const LIB_PATH = path.join(DATA_DIR, 'library.json');
const CFG_PATH = path.join(DATA_DIR, 'config.json');
const RATES_PATH = path.join(DATA_DIR, 'rates.json');
const USAGE_PATH = path.join(DATA_DIR, 'usage.json');
const LOG_PATH = path.join(DATA_DIR, 'logs.jsonl');

const DEFAULT_BASE = 'https://api.deepseek.com';
const MODEL = 'deepseek-chat';
const MODES = { conservative: { k: 2, size: 800 }, standard: { k: 3, size: 1200 }, full: { k: 4, size: 1600 } };

for (const d of [DATA_DIR, FILES_DIR]) fs.mkdirSync(d, { recursive: true });

/* ---------- JSON 檔讀寫 ---------- */
function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJSON(p, obj) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}
const loadLib = () => { const v = readJSON(LIB_PATH, []); return Array.isArray(v) ? v : []; };
const loadCfg = () => Object.assign({ apiKey: '', baseUrl: DEFAULT_BASE, dailyLimit: 50, defaultMode: 'standard', adminPinHash: '' }, readJSON(CFG_PATH, {}));
const loadRates = () => { const v = readJSON(RATES_PATH, []); return Array.isArray(v) ? v : []; };

/* ---------- 工具 ---------- */
function localDate(d = new Date()) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function maskKey(k) {
  if (!k) return '';
  return k.length <= 8 ? '****' : k.slice(0, 3) + '****' + k.slice(-4);
}
function hashPin(pin) { return crypto.createHash('sha256').update('ins-kb::' + pin).digest('hex'); }
function normBase(u) {
  u = String(u || '').trim().replace(/\/+$/, '');
  u = u.replace(/\/chat\/completions$/, '');
  return u || DEFAULT_BASE;
}

/* 身份證號及電話號碼遮罩（送出前執行） */
function maskPII(s) {
  if (!s) return s;
  return String(s)
    // 內地 18 位身份證
    .replace(/(?<![0-9A-Za-z])\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![0-9A-Za-z])/g, m => m.slice(0, 3) + '*'.repeat(11) + m.slice(-4).replace(/./g, '*'))
    // 香港身份證 A123456(7) / AB123456(A)
    .replace(/(?<![A-Za-z0-9])([A-Za-z]{1,2})\d{6}\s?[(（]?[0-9Aa][)）]?(?![0-9])/g, (m, p) => p + '******(*)')
    // 澳門 / 台灣身份證
    .replace(/(?<![A-Za-z0-9])[A-Za-z][12]\d{8}(?![0-9])/g, m => m[0] + '*********')
    // 內地手機（可帶 +86）
    .replace(/(?:\+?86[\s-]?)?(?<!\d)1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g, m => m.replace(/\d(?=[\d\s-]{4,}$)/g, '*'))
    // 香港 8 位電話（可帶 +852）
    .replace(/(?:\+?852[\s-]?)?(?<!\d)[2-9]\d{3}[\s-]?\d{4}(?!\d)/g, m => m.replace(/\d(?=[\d\s-]{4,}$)/g, '*'));
}

/* ---------- 檢索（與 public/js/search.js 同一套規則） ---------- */
const STOP = new Set(['什麼', '甚麼', '什么', '怎樣', '怎么', '怎麼', '如何', '是否', '可以', '請問', '请问', '哪些', '多少', '點樣', '係咪', '有冇', '一下', '我們', '你們', '這個', '那個', '的話', '是不', '不是', '有沒', '沒有', '需要', '應該', '一個']);
function normalize(s) {
  return String(s || '').replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ').toLowerCase();
}
/* 切詞：中文切單字及雙字；英數按詞。回傳 { hit: ≥2 字的詞, uni: 單字 } */
function tokenize(q) {
  const s = normalize(q);
  const hit = new Set(), uni = new Set();
  const re = /[㐀-鿿豈-﫿]+|[a-z0-9]+/g;
  let m;
  while ((m = re.exec(s))) {
    const w = m[0];
    if (/^[a-z0-9]+$/.test(w)) { if (w.length >= 2) hit.add(w); continue; }
    for (let i = 0; i < w.length; i++) {
      uni.add(w[i]);
      if (i + 1 < w.length) { const bi = w.slice(i, i + 2); if (!STOP.has(bi)) hit.add(bi); }
    }
  }
  return { hit: [...hit], uni: [...uni] };
}
function countOcc(hay, needle, cap = 30) {
  if (!needle) return 0;
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; if (n >= cap) break; }
  return n;
}
function makeChunks(doc, size) {
  const text = String(doc.content || '');
  const out = [];
  if (!text) return out;
  const step = Math.max(200, Math.floor(size * 0.85));
  for (let i = 0; i < text.length; i += step) {
    out.push({ start: i, text: text.slice(i, i + size) });
    if (i + size >= text.length) break;
  }
  return out;
}
function retrieve(lib, question, mode) {
  const cfg = MODES[mode] || MODES.standard;
  const { hit, uni } = tokenize(question);
  if (!hit.length) return { terms: hit, chunks: [] };
  const N = lib.length || 1;
  const docs = lib.map(d => ({ d, title: normalize(d.title), cat: normalize(d.category), body: normalize(d.content) }));
  const idf = {};
  for (const t of hit) {
    const df = docs.reduce((a, x) => a + ((x.title.includes(t) || x.cat.includes(t) || x.body.includes(t)) ? 1 : 0), 0);
    idf[t] = Math.log(1 + N / (df || 1)) + 0.2;
  }
  const cands = [];
  for (const x of docs) {
    const head = hit.reduce((a, t) => a + (countOcc(x.title, t) * 4 + countOcc(x.cat, t) * 2) * idf[t], 0);
    for (const c of makeChunks(x.d, cfg.size)) {
      const body = normalize(c.text);
      let score = 0, matched = 0;
      for (const t of hit) {
        const n = countOcc(body, t);
        if (n) { matched++; score += (1 + Math.log(n)) * idf[t]; }
      }
      if (!matched && !head) continue; // 只有 ≥2 字的詞命中才算命中
      for (const u of uni) score += countOcc(body, u, 10) * 0.02;
      score = (score + head) * (0.5 + matched / hit.length);
      cands.push({ doc: x.d, start: c.start, text: c.text, score });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const picked = [], perDoc = {};
  for (const c of cands) {
    if (picked.length >= cfg.k) break;
    perDoc[c.doc.id] = (perDoc[c.doc.id] || 0) + 1;
    if (perDoc[c.doc.id] > 2) continue;
    picked.push(c);
  }
  return { terms: hit, chunks: picked };
}

/* ---------- 每日次數 ---------- */
function usageKey(req) {
  const sid = String(req.headers['x-staff-id'] || '').trim();
  if (/^[A-Za-z0-9_-]{1,32}$/.test(sid)) return 'staff:' + sid.toUpperCase();
  return 'ip:' + clientIp(req);
}
function clientIp(req) {
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '') || 'unknown';
}
function getUsage() {
  const u = readJSON(USAGE_PATH, {});
  if (u.date !== localDate()) return { date: localDate(), counts: {} };
  u.counts = u.counts || {};
  return u;
}
function usedToday(key) { return getUsage().counts[key] || 0; }
function bumpUsage(key) {
  const u = getUsage();
  u.counts[key] = (u.counts[key] || 0) + 1;
  writeJSON(USAGE_PATH, u);
  return u.counts[key];
}

/* ---------- 日誌 ---------- */
function writeLog(entry) {
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
}
function readLogs() {
  try {
    return fs.readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* ---------- HTTP 工具 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', // 必須：否則瀏覽器只會下載
  '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, Object.assign({ 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
  res.end(isObj ? JSON.stringify(body) : body);
}
function readBody(req, limit = 40 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const bufs = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(Object.assign(new Error('檔案過大'), { status: 413 })); req.destroy(); } else bufs.push(c); });
    req.on('end', () => resolve(Buffer.concat(bufs)));
    req.on('error', reject);
  });
}
async function readJSONBody(req) {
  const b = await readBody(req);
  if (!b.length) return {};
  try { return JSON.parse(b.toString('utf8')); } catch { throw Object.assign(new Error('JSON 格式錯誤'), { status: 400 }); }
}
function isAdmin(req) {
  const cfg = loadCfg();
  if (!cfg.adminPinHash) return true; // 未設管理員密碼 = 本機單人使用
  const pin = String(req.headers['x-admin-pin'] || '');
  return !!pin && hashPin(pin) === cfg.adminPinHash;
}
function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  send(res, 403, { error: '需要管理員權限，請先在「設定與權限」輸入管理員密碼' });
  return false;
}

function serveStatic(req, res, baseDir, rel) {
  let file;
  try { rel = decodeURIComponent(rel); } catch { return send(res, 400, 'Bad path'); }
  file = path.normalize(path.join(baseDir, rel));
  if (!file.startsWith(baseDir)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) { file = path.join(file, 'index.html'); st = fs.existsSync(file) ? fs.statSync(file) : null; err = st ? null : err || new Error('nf'); }
    if (err || !st) return send(res, 404, 'Not found');
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'X-Content-Type-Options': 'nosniff',
    };
    const name = path.basename(file);
    if (name === 'sw.js' || ext === '.html' || ext === '.webmanifest') headers['Cache-Control'] = 'no-cache';
    else if (baseDir === FILES_DIR) {
      headers['Cache-Control'] = 'no-cache';
      headers['Content-Disposition'] = "inline; filename*=UTF-8''" + encodeURIComponent(name); // 一律 inline，不觸發下載
    } else headers['Cache-Control'] = 'public, max-age=0, must-revalidate';
    if (req.method === 'HEAD') { res.writeHead(200, headers); return res.end(); }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------- DeepSeek 串流 ---------- */
function callDeepSeekStream({ messages, onDelta, onDone, onError, signal, maxTokens = 1500 }) {
  const cfg = loadCfg();
  const url = new URL(normBase(cfg.baseUrl) + '/chat/completions');
  const payload = JSON.stringify({ model: MODEL, messages, stream: true, temperature: 0.2, max_tokens: maxTokens });
  const lib = url.protocol === 'http:' ? http : https;
  const req = lib.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey, 'Content-Length': Buffer.byteLength(payload), 'Accept': 'text/event-stream' },
    timeout: 60000,
  }, up => {
    if (up.statusCode !== 200) {
      let b = ''; up.on('data', c => b += c); up.on('end', () => {
        let msg = b.slice(0, 300);
        try { msg = JSON.parse(b).error.message || msg; } catch {}
        const hint = up.statusCode === 401 ? '（API Key 無效）' : up.statusCode === 402 ? '（DeepSeek 賬戶餘額不足）' : up.statusCode === 429 ? '（DeepSeek 請求過於頻密）' : '';
        onError(new Error(`DeepSeek 回應 ${up.statusCode}${hint}：${msg}`));
      });
      return;
    }
    up.setEncoding('utf8');
    let buf = '', finished = false;
    const finish = () => { if (!finished) { finished = true; onDone(); } };
    up.on('data', chunk => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') { finish(); continue; }
        try { const j = JSON.parse(data); const t = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content; if (t) onDelta(t); } catch {}
      }
    });
    up.on('end', finish);
    up.on('error', onError);
  });
  req.on('timeout', () => req.destroy(new Error('連線 DeepSeek 逾時')));
  req.on('error', e => onError(e));
  if (signal) signal.onabort = () => req.destroy(new Error('aborted'));
  req.end(payload);
}

function sseStart(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
}
function sse(res, event, data) {
  if (res.writableEnded) return;
  res.write((event ? `event: ${event}\n` : '') + `data: ${JSON.stringify(data)}\n\n`);
}

/* 共用：扣次數、串流、寫日誌 */
async function runAI(req, res, { kind, question, messages, sources, mode, sentChars }) {
  const cfg = loadCfg();
  const key = usageKey(req);
  const limit = Number(cfg.dailyLimit) || 50;
  if (!cfg.apiKey) return send(res, 400, { error: '尚未設定 DeepSeek API Key，請到「設定與權限」設定。' });
  if (usedToday(key) >= limit) return send(res, 429, { error: `今日 ${limit} 次額度已用完，請明天再試。` });
  const used = bumpUsage(key);
  const t0 = Date.now();
  const ctrl = { onabort: null };
  let answer = '', status = 'ok', errMsg = '';
  sseStart(res);
  sse(res, 'meta', { sources, remaining: Math.max(0, limit - used), limit });
  res.on('close', () => { if (!res.writableEnded) { status = 'aborted'; ctrl.onabort && ctrl.onabort(); } });
  const log = () => writeLog({ time: new Date().toISOString(), kind, user: key, ip: clientIp(req), mode, question, sources: sources.map(s => s.id).join('|'), sentChars, answerChars: answer.length, ms: Date.now() - t0, status, error: errMsg });
  callDeepSeekStream({
    messages, signal: ctrl,
    onDelta: t => { answer += t; sse(res, null, { d: t }); },
    onDone: () => { sse(res, 'done', { chars: answer.length }); res.end(); log(); },
    onError: e => { if (status !== 'aborted') { status = 'error'; errMsg = e.message; sse(res, 'error', { message: e.message }); } res.end(); log(); },
  });
}

const SYS_ASK = `你是香港保險公司內部的「卓越 Summit 寶典」，對象是保險顧問。
規則：
1. 只可依據使用者訊息中的「參考資料」作答，不可使用外部知識、不可臆測或補充資料以外的數字、條款或日期。
2. 若參考資料沒有足夠內容回答，請直接回覆：「現有資料中未有提及此問題，建議向相關部門查詢。」不要編造。
3. 回答用繁體中文及香港保險業用語（例如：保單、顧問、佣金、上板數、冷靜期、保費、受保人）。
4. 先給結論，再用條列說明；每項重點後以 [1]、[2] 標註所依據的參考資料編號。
5. 不要重複列出參考資料原文全文。`;

async function handleAsk(req, res) {
  const body = await readJSONBody(req);
  const question = String(body.question || '').trim().slice(0, 1000);
  if (!question) return send(res, 400, { error: '請輸入問題' });
  const mode = MODES[body.mode] ? body.mode : (loadCfg().defaultMode || 'standard');
  const lib = loadLib();
  const { chunks } = retrieve(lib, question, mode);
  const maskedQ = maskPII(question);
  const sources = chunks.map((c, i) => ({ n: i + 1, id: c.doc.id, title: c.doc.title, category: c.doc.category, start: c.start }));
  if (!chunks.length) {
    // 沒有命中：不呼叫 AI、不扣次數
    writeLog({ time: new Date().toISOString(), kind: 'ask', user: usageKey(req), ip: clientIp(req), mode, question: maskedQ, sources: '', sentChars: 0, answerChars: 0, ms: 0, status: 'no-hit', error: '' });
    sseStart(res);
    sse(res, 'meta', { sources: [], remaining: null, noHit: true });
    sse(res, null, { d: '現有資料庫中未找到與此問題相關的文件，所以無法作答。\n\n建議：換個關鍵詞（例如產品名稱、「冷靜期」、「退保」）再試，或到「資料總覽」瀏覽分類。' });
    sse(res, 'done', {});
    return res.end();
  }
  const ctx = chunks.map((c, i) => `【參考資料 ${i + 1}】《${c.doc.title}》（分類：${c.doc.category}）\n${maskPII(c.text)}`).join('\n\n');
  const user = `參考資料：\n${ctx}\n\n——\n問題：${maskedQ}`;
  await runAI(req, res, { kind: 'ask', question: maskedQ, mode, sources, sentChars: user.length, messages: [{ role: 'system', content: SYS_ASK }, { role: 'user', content: user }] });
}

async function handlePlan(req, res) {
  const body = await readJSONBody(req);
  const lib = loadLib();
  const doc = lib.find(d => d.id === body.productId);
  if (!doc) return send(res, 400, { error: '請先選擇產品文件' });
  const c = body.client || {};
  const field = (k, label) => c[k] ? `${label}：${maskPII(String(c[k]).slice(0, 200))}` : '';
  const clientDesc = [field('age', '年齡'), field('gender', '性別'), field('smoker', '吸煙'), field('family', '家庭狀況'), field('budget', '每年預算'), field('needs', '主要需要'), field('risk', '風險取向'), field('note', '其他')].filter(Boolean).join('\n') || '（未提供）';
  const content = maskPII(String(doc.content || '').slice(0, 6000));
  const sys = SYS_ASK.replace('4. 先給結論', '4. 按要求的章節輸出').replace('每項重點後以 [1]、[2] 標註所依據的參考資料編號。', '若某項內容文件未有提及，寫「文件未有提及」，不要自行補充。');
  const user = `參考資料（產品文件）：\n【參考資料 1】《${doc.title}》（分類：${doc.category}）\n${content}\n\n——\n客戶條件：\n${clientDesc}\n\n請為顧問準備計劃書講解筆記，分四部分輸出：
一、講解重點（3–5 點，緊扣客戶條件）
二、建議開場及講解話術（口語化，港式用語）
三、常見異議及處理（至少 4 條，格式：「客戶：…」→「回應：…」）
四、合規提示（例如冷靜期、須客戶細閱的文件；只寫文件有提及的）`;
  const sources = [{ n: 1, id: doc.id, title: doc.title, category: doc.category, start: 0 }];
  await runAI(req, res, { kind: 'plan', question: maskPII(`[計劃書] ${doc.title} | ${clientDesc.replace(/\n/g, '；')}`), mode: '-', sources, sentChars: user.length, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] });
}

function testKey(res) {
  let out = '';
  callDeepSeekStream({
    maxTokens: 5,
    messages: [{ role: 'user', content: '回覆「OK」' }],
    onDelta: t => out += t,
    onDone: () => send(res, 200, { ok: true, reply: out }),
    onError: e => send(res, 200, { ok: false, error: e.message }),
  });
}

/* ---------- 路由 ---------- */
const KINDS = { '.pdf': 'pdf', '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image', '.txt': 'text', '.md': 'text' };
function safeFileName(name) {
  const ext = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '');
  const stem = path.basename(name, path.extname(name)).replace(/[\\/:*?"<>|#%\s]+/g, '_').slice(0, 60) || 'file';
  return `${Date.now().toString(36)}_${stem}${ext}`;
}
function normCategory(c) {
  return String(c || '未分類').split(/›|>/).map(s => s.trim()).filter(Boolean).join(' › ') || '未分類';
}

async function api(req, res, url) {
  const p = url.pathname, m = req.method;

  if (p === '/api/library' && m === 'GET') return send(res, 200, loadLib());

  if (p === '/api/library' && m === 'POST') {
    if (!requireAdmin(req, res)) return;
    const b = await readJSONBody(req);
    const lib = loadLib();
    let entry = b.id ? lib.find(d => d.id === b.id) : null;
    if (!entry) { entry = { id: 'doc_' + crypto.randomBytes(5).toString('hex'), title: '', category: '', content: '', source: '', file: '', kind: 'text', updatedAt: '' }; lib.push(entry); }
    if (b.fileBase64 && b.fileName) {
      const fname = safeFileName(b.fileName);
      fs.writeFileSync(path.join(FILES_DIR, fname), Buffer.from(String(b.fileBase64).replace(/^data:[^,]*,/, ''), 'base64'));
      entry.file = fname;
      entry.kind = KINDS[path.extname(fname).toLowerCase()] || 'other';
    }
    entry.title = String(b.title || entry.title || b.fileName || '未命名').trim();
    entry.category = normCategory(b.category || entry.category);
    if (b.content != null) entry.content = String(b.content);
    if (b.source != null) entry.source = String(b.source);
    if (!entry.file) entry.kind = 'text';
    entry.updatedAt = new Date().toISOString();
    writeJSON(LIB_PATH, lib);
    return send(res, 200, entry);
  }

  const delM = p.match(/^\/api\/library\/([\w-]+)$/);
  if (delM && m === 'DELETE') {
    if (!requireAdmin(req, res)) return;
    const lib = loadLib();
    const i = lib.findIndex(d => d.id === delM[1]);
    if (i < 0) return send(res, 404, { error: '找不到文件' });
    const [gone] = lib.splice(i, 1);
    writeJSON(LIB_PATH, lib);
    if (gone.file && !lib.some(d => d.file === gone.file)) fs.rm(path.join(FILES_DIR, path.basename(gone.file)), () => {});
    return send(res, 200, { ok: true });
  }

  if (p === '/api/config' && m === 'GET') {
    const c = loadCfg();
    return send(res, 200, { hasKey: !!c.apiKey, keyMasked: maskKey(c.apiKey), baseUrl: normBase(c.baseUrl), model: MODEL, dailyLimit: Number(c.dailyLimit) || 50, defaultMode: c.defaultMode, hasAdminPin: !!c.adminPinHash, isAdmin: isAdmin(req) });
  }
  if (p === '/api/config' && m === 'POST') {
    if (!requireAdmin(req, res)) return;
    const b = await readJSONBody(req);
    const c = loadCfg();
    if (typeof b.apiKey === 'string' && b.apiKey.trim()) c.apiKey = b.apiKey.trim(); // 留空 = 保留舊 Key
    if (b.clearKey) c.apiKey = '';
    if (typeof b.baseUrl === 'string') c.baseUrl = normBase(b.baseUrl);
    if (b.dailyLimit != null) c.dailyLimit = Math.max(1, Math.min(1000, Number(b.dailyLimit) || 50));
    if (MODES[b.defaultMode]) c.defaultMode = b.defaultMode;
    if (typeof b.newAdminPin === 'string') c.adminPinHash = b.newAdminPin ? hashPin(b.newAdminPin) : '';
    writeJSON(CFG_PATH, c);
    return send(res, 200, { ok: true, keyMasked: maskKey(c.apiKey), hasKey: !!c.apiKey });
  }
  if (p === '/api/config/test' && m === 'POST') {
    if (!requireAdmin(req, res)) return;
    if (!loadCfg().apiKey) return send(res, 200, { ok: false, error: '尚未設定 API Key' });
    return testKey(res);
  }
  if (p === '/api/admin/check' && m === 'POST') return send(res, 200, { ok: isAdmin(req) });

  if (p === '/api/ask' && m === 'POST') return handleAsk(req, res);
  if (p === '/api/plan' && m === 'POST') return handlePlan(req, res);

  if (p === '/api/stats' && m === 'GET') {
    const c = loadCfg(), lib = loadLib(), u = getUsage(), key = usageKey(req);
    const today = localDate();
    const logs = readLogs();
    const cats = new Set(lib.map(d => normCategory(d.category)));
    return send(res, 200, {
      docs: lib.length, categories: cats.size, hasKey: !!c.apiKey, limit: Number(c.dailyLimit) || 50,
      myUsed: u.counts[key] || 0, me: key, todayCalls: Object.values(u.counts).reduce((a, b) => a + b, 0),
      todayUsers: Object.keys(u.counts).length, rates: loadRates().length, logs: logs.length,
      todayNoHit: logs.filter(l => l.status === 'no-hit' && localDate(new Date(l.time)) === today).length,
      recent: lib.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 5).map(d => ({ id: d.id, title: d.title, category: d.category, updatedAt: d.updatedAt })),
    });
  }

  if (p === '/api/logs.csv' && m === 'GET') {
    if (!requireAdmin(req, res)) return;
    const cols = ['time', 'kind', 'user', 'ip', 'mode', 'question', 'sources', 'sentChars', 'answerChars', 'ms', 'status', 'error'];
    const head = ['時間', '類型', '使用者', 'IP', '檔位', '問題（已遮罩）', '出處ID', '送出字數', '回答字數', '耗時ms', '狀態', '錯誤'];
    const rows = readLogs().map(l => cols.map(k => csvCell(k === 'time' ? new Date(l.time).toLocaleString('zh-HK', { hour12: false }) : l[k])).join(','));
    return send(res, 200, '﻿' + [head.join(','), ...rows].join('\r\n'), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ai-logs-${localDate()}.csv"` });
  }

  if (p === '/api/rates' && m === 'GET') return send(res, 200, loadRates());
  if (p === '/api/rates' && m === 'POST') {
    if (!requireAdmin(req, res)) return;
    const b = await readJSONBody(req);
    if (!Array.isArray(b.rates)) return send(res, 400, { error: '格式錯誤' });
    const clean = [];
    for (const r of b.rates) {
      const rate = Number(r.commissionRate), board = Number(r.boardRate);
      if (!r.productName || !String(r.term).trim() || !isFinite(rate) || !isFinite(board)) continue;
      clean.push({ productCode: String(r.productCode || '').trim(), productName: String(r.productName).trim(), term: String(r.term).trim(), commissionRate: rate, boardRate: board, note: String(r.note || '').trim() });
    }
    const merged = b.replace ? clean : (() => {
      const map = new Map(loadRates().map(r => [r.productName + '|' + r.term, r]));
      for (const r of clean) map.set(r.productName + '|' + r.term, r);
      return [...map.values()];
    })();
    writeJSON(RATES_PATH, merged);
    return send(res, 200, { ok: true, imported: clean.length, skipped: b.rates.length - clean.length, total: merged.length });
  }

  return send(res, 404, { error: '未知 API' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    if (url.pathname.startsWith('/files/')) return serveStatic(req, res, FILES_DIR, url.pathname.slice('/files/'.length));
    return serveStatic(req, res, PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.message || '伺服器錯誤' });
    else res.end();
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`卓越 Summit 寶典已啟動：http://localhost:${PORT}`));
}
module.exports = { tokenize, retrieve, maskPII, normBase, server };
