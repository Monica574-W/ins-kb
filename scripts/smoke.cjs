// 冒煙測試：node scripts/smoke.cjs（不呼叫 DeepSeek，不改動資料庫）
'use strict';
const assert = require('assert');
const http = require('http');
const { server, tokenize, maskPII, retrieve } = require('../server.cjs');
const lib = require('../data/library.json');

// 檢索：單字不算命中；雙字詞命中
assert.deepStrictEqual(retrieve(lib, '的', 'standard').chunks, []);
assert.ok(retrieve(lib, '冷靜期有幾多日', 'conservative').chunks.length <= 2);
assert.ok(tokenize('冷靜期').hit.includes('冷靜'));
// 遮罩
const m = maskPII('A123456(7) 91234567 13812345678');
assert.ok(!m.includes('123456') && !m.includes('9123') && !m.includes('1381234'), m);

function get(port, p, opts = {}) {
  return new Promise((res, rej) => {
    const req = http.request({ port, path: p, method: opts.method || 'GET', headers: opts.headers || {} }, r => {
      let b = ''; r.on('data', c => b += c); r.on('end', () => res({ status: r.statusCode, type: r.headers['content-type'] || '', body: b }));
    });
    req.on('error', rej); req.end(opts.body);
  });
}

server.listen(0, async () => {
  const port = server.address().port;
  try {
    let r = await get(port, '/');
    assert.strictEqual(r.status, 200); assert.ok(r.type.startsWith('text/html'));
    r = await get(port, '/api/library');
    assert.ok(Array.isArray(JSON.parse(r.body)));
    r = await get(port, '/files/sample_cooling_off.pdf');
    assert.ok(r.type.startsWith('application/pdf'), 'PDF 必須回 application/pdf');
    r = await get(port, '/vendor/pdfjs/pdf.min.js');
    assert.ok(r.type.startsWith('text/javascript'));
    r = await get(port, '/files/..%2fdata%2flibrary.json');
    assert.ok(r.status === 403 || r.status === 404, '路徑穿越必須被擋');
    r = await get(port, '/api/config');
    assert.ok(!('apiKey' in JSON.parse(r.body)), 'config 不可回傳明文 Key');
    console.log('✔ smoke test passed');
    server.close();
  } catch (e) { console.error(e); process.exit(1); }
});
