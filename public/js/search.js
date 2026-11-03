// 本地檢索與分類樹（規則與 server.cjs 一致）
import { esc } from './util.js';

export const SEP = '›';
const STOP = new Set(['什麼', '甚麼', '什么', '怎樣', '怎么', '怎麼', '如何', '是否', '可以', '請問', '请问', '哪些', '多少', '點樣', '係咪', '有冇', '一下', '我們', '你們', '這個', '那個', '的話', '是不', '不是', '有沒', '沒有', '需要', '應該', '一個']);

export function normalize(s) {
  return String(s || '').replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ').toLowerCase();
}
/* 中文切單字＋雙字；判定命中只用 ≥2 字的詞（hit），單字（uni）只作加分 */
export function tokenize(q) {
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
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; if (n >= cap) break; }
  return n;
}

/* 分類路徑：一律以陣列處理 */
export const catPath = d => String(d.category || '未分類').split(SEP).map(s => s.trim()).filter(Boolean);

/* 按 › 動態建分類樹（不寫死分類清單） */
export function buildTree(lib) {
  const root = { name: '', children: new Map(), docs: [], count: 0 };
  for (const d of lib) {
    let node = root; node.count++;
    for (const seg of catPath(d)) {
      if (!node.children.has(seg)) node.children.set(seg, { name: seg, children: new Map(), docs: [], count: 0 });
      node = node.children.get(seg); node.count++;
    }
    node.docs.push(d);
  }
  return root;
}
export function nodeAt(root, pathArr) {
  let node = root;
  for (const seg of pathArr) { node = node.children.get(seg); if (!node) return null; }
  return node;
}

/* 搜尋文件：回傳 [{doc, score, terms}]，按相關度排序 */
export function searchDocs(lib, q) {
  const { hit, uni } = tokenize(q);
  if (!hit.length) return { terms: [], results: [], tooShort: true };
  const N = lib.length || 1;
  const rows = lib.map(d => ({ d, title: normalize(d.title), cat: normalize(d.category), body: normalize(d.content) }));
  const idf = {};
  for (const t of hit) {
    const df = rows.reduce((a, x) => a + ((x.title.includes(t) || x.cat.includes(t) || x.body.includes(t)) ? 1 : 0), 0);
    idf[t] = Math.log(1 + N / (df || 1)) + 0.2;
  }
  const results = [];
  for (const x of rows) {
    let score = 0, matched = 0;
    for (const t of hit) {
      const tt = countOcc(x.title, t), tc = countOcc(x.cat, t), tb = countOcc(x.body, t);
      if (tt || tc || tb) { matched++; score += (tt * 6 + tc * 3 + (tb ? 1 + Math.log(tb) : 0)) * idf[t]; }
    }
    if (!matched) continue;
    for (const u of uni) score += countOcc(x.title, u, 5) * 0.1;
    // 整句完全出現加分
    const nq = normalize(q).trim();
    if (nq.length >= 2 && x.title.includes(nq)) score += 20;
    else if (nq.length >= 2 && x.body.includes(nq)) score += 8;
    score *= 0.5 + matched / hit.length;
    results.push({ doc: x.d, score });
  }
  results.sort((a, b) => b.score - a.score);
  return { terms: hit, results, tooShort: false };
}

/* 合併相連的雙字詞為較長片語，用於高亮 */
function hlTerms(terms) { return [...terms].sort((a, b) => b.length - a.length).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); }

export function highlight(text, terms) {
  const s = esc(text);
  if (!terms || !terms.length) return s;
  const re = new RegExp('(' + hlTerms(terms).join('|') + ')+', 'gi');
  return s.replace(re, '<mark>$&</mark>');
}

/* 命中上下文片段（最多 n 段） */
export function snippets(text, terms, n = 2, radius = 36) {
  const src = String(text || '');
  const low = normalize(src);
  const pos = [];
  for (const t of terms) { let i = low.indexOf(t); if (i >= 0) pos.push(i); }
  pos.sort((a, b) => a - b);
  const wins = [];
  for (const p of pos) {
    const a = Math.max(0, p - radius), b = Math.min(src.length, p + radius);
    const last = wins[wins.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else wins.push([a, b]);
    if (wins.length >= n && !last) break;
  }
  return wins.slice(0, n).map(([a, b]) => (a > 0 ? '…' : '') + highlight(src.slice(a, b).replace(/\s+/g, ' '), terms) + (b < src.length ? '…' : ''));
}
