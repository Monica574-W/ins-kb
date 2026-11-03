# 保險知識助手（本地 PWA）

零依賴、零構建。只需 Node.js 18 或以上。

```bash
node server.cjs          # 或 npm start
# 打開 http://localhost:8788
```

同一區網的手機可用 `http://<電腦IP>:8788` 開啟（能正常使用，但 Service Worker 只會在 localhost 或 HTTPS 下啟用，即區網 http 不能離線及安裝）。要在手機安裝及離線使用，請在前面加一層 HTTPS 反向代理（例如 Caddy、Cloudflare Tunnel）。

## 目錄

```
server.cjs                 後端（Node 內置模組；靜態服務＋API＋DeepSeek 串流代理）
data/library.json          資料庫 [{id,title,category,content,source,file,kind,updatedAt}]
data/rates.json            佣金費率表（預設為空 → 佣金頁會明確提示不能計算）
data/config.json           API Key / Base URL / 每日上限 / 管理員密碼雜湊（首次儲存時自動建立）
data/usage.json            每日次數（按日自動重置）
data/logs.jsonl            AI 調用日誌（可在設定頁匯出 CSV）
files/                     原檔（PDF / 圖片）
samples/rates-sample.csv   示例費率（虛構，只用於測試）
public/                    前端（原生 HTML/CSS/ES Module）
  index.html  manifest.webmanifest  sw.js  css/app.css  icons/
  js/app.js        路由、導航、標題表 TITLES
  js/util.js       fetch、串流解析、逐字顯示、複製、圖示
  js/search.js     切詞（單字＋雙字，命中只用 ≥2 字詞）、分類樹、高亮、片段
  js/data.js       資料庫快取
  js/reader.js     全屏閱讀（pdf.js 逐頁 canvas、懶加載、cmaps；圖片放大；文字切換）
  js/views/*.js    各頁
  vendor/pdfjs/    pdf.js 4.10.38 legacy 版（pdf.min.js、pdf.worker.min.js、cmaps/、standard_fonts/）
```

## API

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | /api/library | 全部文件 |
| POST | /api/library | 新增/更新文件（可帶 fileName + fileBase64）【管理員】 |
| DELETE | /api/library/:id | 刪除文件及原檔【管理員】 |
| GET/POST | /api/config | 讀取（Key 只回遮罩）/ 儲存（apiKey 留空 = 保留舊 Key）【POST 管理員】 |
| POST | /api/config/test | 測試 DeepSeek 連線【管理員】 |
| POST | /api/ask | AI 問答（SSE 串流：meta → data… → done/error） |
| POST | /api/plan | 計劃書小助手（SSE 串流） |
| GET | /api/stats | 統計及個人剩餘次數 |
| GET | /api/logs.csv | 匯出日誌（UTF-8 BOM，Excel 可直接開）【管理員】 |
| GET/POST | /api/rates | 費率表 讀取/匯入【POST 管理員】 |

身份識別：請求頭 `X-Staff-Id`（工號），沒有則用 IP。管理員：未設密碼時本機全權；設定後需 `X-Admin-Pin`。

## 檢索規則

- 中文切單字及雙字；英數按詞。**判定命中只用 ≥2 字的詞**（雙字詞、英數詞），單字只作加分，所以「的」不會命中全部文件。常見疑問詞（如何、甚麼、點樣…）已剔除。
- 文件按檔位切塊後打分（TF × IDF × 覆蓋率，標題/分類加權），每份文件最多取 2 段：保守 2×800、標準 3×1200、完整 4×1600 字。
- 沒有命中任何片段 → 直接回覆「未找到」，**不呼叫 AI、不扣次數**，日誌記為 `no-hit`。
- 送出前，問題及片段中的香港/內地/澳台身份證號、香港 8 位及內地 11 位電話會被遮罩。

## 佣金計算口徑

`首年佣金 = 年化保費 × 首年佣金率(%)`；`上板數 = 年化保費 × 上板率(%)`。兩個比率都必須來自匯入的費率表（CSV 表頭：`產品代碼,產品名稱,供款年期,首年佣金率(%),上板率(%),備註`）。如公司的上板數有其他算法（例如按年期折算），只需修改 `public/js/views/commission.js` 的 `compute()`。

## 維護注意

- 改任何前端檔案後，把 `public/sw.js` 的 `CACHE` 版本號加一（`ikb-shell-v1` → `v2`）。新 SW 會 skipWaiting + clients.claim，頁面自動重新載入一次。
- 新增頁面：在 `app.js` 的 `ROUTES` 及 `TITLES` 同時加項（缺標題會在 console 報錯），並把檔案加進 `sw.js` 的 `SHELL`。
- `.pdf` 必須回 `application/pdf`（已在 `MIME` 表處理），原檔一律 `Content-Disposition: inline`。

---

# 逐條自測清單

先執行 `node server.cjs`，用 Chrome 打開 `http://localhost:8788`。每條打 ✔ 才算通過。

### A. 伺服器與靜態服務
1. ☐ 終端機顯示「保險知識助手已啟動：http://localhost:8788」，`package.json` 沒有任何 dependencies。
2. ☐ `curl -I localhost:8788/files/sample_cooling_off.pdf` → `Content-Type: application/pdf`，`Content-Disposition: inline`。
3. ☐ `curl -I localhost:8788/vendor/pdfjs/pdf.min.js` → `text/javascript`。
4. ☐ `curl -I localhost:8788/vendor/pdfjs/cmaps/UniCNS-UCS2-H.bcmap` → 200。
5. ☐ `curl -I localhost:8788/sw.js` → `Cache-Control: no-cache`。
6. ☐ `curl --path-as-is localhost:8788/../server.cjs` 及 `curl localhost:8788/files/..%2fdata%2fconfig.json` → 404/403，不會洩漏檔案。

### B. 導航與標題
7. ☐ 桌面（寬 ≥900px）左側欄四組：「管理總覽」單獨在最上；「AI問答及工具」含 AI 知識問答／上板數佣金／計劃書小助手；「資料」含資料總覽；「系統」含設定與權限／App 操作手冊。
8. ☐ 手機寬度（DevTools 390×844）：側欄隱藏，底部固定五項：首頁、AI 問答、佣金、資料、我的；當前項高亮。
9. ☐ 逐頁點擊，頂欄小標題＋大標題都正確（管理總覽、AI問答及工具、資料、系統、我的），DevTools console 沒有「[標題表] 缺少」錯誤。
10. ☐ 手機每頁捲到最底，最後一項內容不會被底部導航遮住。
11. ☐ 所有按鈕/輸入框高度 ≥44px，界面全為繁體中文。

### C. 設定與權限
12. ☐ 輸入工號（如 A12345）→ 儲存 → 首頁黃色提示消失。
13. ☐ 輸入 DeepSeek API Key → 儲存設定 → 顯示「API Key 已儲存：sk-****xxxx」，輸入框清空；重新整理後仍顯示遮罩，**不要求重新輸入**。
14. ☐ Key 框留空、只改每日上限 → 儲存 → Key 仍保留（`data/config.json` 的 apiKey 不變）。
15. ☐ 「測試連線」→ 正確 Key 顯示「連線成功」；錯誤 Key 顯示含「401（API Key 無效）」。
16. ☐ Base URL 填 `https://api.deepseek.com/chat/completions` 也能正常（自動去掉尾段）。
17. ☐ 設定管理員密碼 → 開無痕視窗進設定頁 → 只見「管理員登入」，`curl localhost:8788/api/logs.csv` → 403。輸入正確密碼後可見全部設定。

### D. AI 知識問答
18. ☐ 問「冷靜期有幾多日」→ 答案逐字出現（有閃動游標），可按「停止」中斷。
19. ☐ 答案下方列出「出處」，按一下在當前頁全屏開啟該文件；答案內的 [1] 亦可點擊。
20. ☐ 問「火星移民」→ 立即回覆「現有資料庫中未找到…」，右上剩餘次數**不減少**。
21. ☐ 問題只輸入「的」→ 不會把所有文件當命中（回覆未找到）。
22. ☐ 切換 保守／標準／完整，日誌 CSV 的「送出字數」大約按 2×800 / 3×1200 / 4×1600 上限變化。
23. ☐ 問題中包含「我電話 91234567，身份證 A123456(7)」→ 匯出 CSV 中問題顯示 `****4567`、`A******(*)`（送出 DeepSeek 的內容同樣已遮罩）。
24. ☐ 把每日上限改為 2，連問 3 條有命中的問題 → 第 3 條顯示「今日 2 次額度已用完」。換另一工號可再問（按工號區分）；清空工號則按 IP。
25. ☐ 切到其他頁再返回，對話仍在。

### E. 上板數 / 佣金
26. ☐ 未匯入費率時，頁面紅色提示「尚未匯入佣金費率表，無法計算」，**沒有任何計算結果**。
27. ☐ 匯入 `samples/rates-sample.csv` → 提示已匯入 3 條，表格顯示。
28. ☐ 選「示例儲蓄計劃 A / 10年」，保費 24000 → 佣金率 25%、佣金 6,000.00、上板率 100%、上板數 24,000.00，並顯示算式。
29. ☐ 費率欄填非數字的列會被略過並提示「略過 N 條」。
30. ☐ 「加入計算清單」兩張保單 → 合計正確，可刪除單項。

### F. 計劃書小助手
31. ☐ 產品下拉中「產品資料」組列出分類含「產品」的文件。
32. ☐ 填年齡、需要等 → 生成 → 逐字輸出四部分（講解重點、話術、異議處理、合規提示）。
33. ☐ 「複製全部」→ 貼到記事本內容完整（區網 http 下亦可複製）。
34. ☐ 未設 Key 時生成 → 顯示「尚未設定 DeepSeek API Key」。

### G. 資料總覽
35. ☐ 搜尋框空白：顯示頂層分類卡片（保單行政、產品、合規…），由 `library.json` 動態生成；在 `library.json` 加一個新分類 `核保 › 健康申報` 後重新整理，卡片自動出現。
36. ☐ 點「保單行政」→「保單變更」：麵包屑「全部 › 保單行政 › 保單變更」，同級標籤顯示 保單變更／財務／理賠，點「財務」直接跳過去。
37. ☐ 點麵包屑「全部」或「保單行政」能返回對應層。
38. ☐ 分類名稱中含「-」「/」等字元仍能正常下鑽（路徑以陣列保存）。
39. ☐ 輸入「冷靜期」→ 立即變成搜尋結果：標題高亮、附命中上下文片段、按相關度排序；清空即回到分類瀏覽。
40. ☐ 只輸入一個字 → 提示「請輸入至少 2 個字」。

### H. 全屏閱讀
41. ☐ 點 PDF 文件 → 當前頁彈出全屏，先顯示原檔，逐頁 canvas 渲染、中文清晰；長 PDF 捲動時才渲染後面的頁（DevTools 可見逐頁出現）。
42. ☐ Network 面板可見 pdf.min.js、pdf.worker.min.js 來自 `/vendor/pdfjs/`；內嵌中文字型以外的 PDF 會請求 `cmaps/*.bcmap`。
43. ☐ 點圖片文件 → 圖片滿寬顯示，按一下放大（可捲動），再按關閉。
44. ☐ 按「顯示文字內容」→ 顯示 OCR 全文，搜尋詞已高亮並自動捲到第一處；再按「顯示原檔」切回。
45. ☐ 手機返回鍵／瀏覽器上一頁 → 只關閉閱讀視圖，不離開資料頁。
46. ☐ 全程沒有開新分頁、沒有觸發下載（可在微信內置瀏覽器測試）。

### I. PWA / 離線
47. ☐ DevTools › Application › Manifest 無錯誤，可安裝；圖示 192/512/maskable 正常。
48. ☐ Service Workers 顯示 sw.js 已啟用；Cache Storage 有 `ikb-shell-v1`。
49. ☐ 開過一次 PDF 及資料頁後，勾選 Offline 重新整理：App 能開啟、資料總覽可瀏覽及搜尋、已開過的 PDF/圖片可閱讀；頂欄綠點變橙色；AI 問答顯示「目前離線」。
50. ☐ 修改 `app.css` 並把 `CACHE` 改為 `ikb-shell-v2` → 重新整理一次後新樣式生效，舊快取被刪除。

### J. 日誌
51. ☐ 設定頁「匯出 CSV」→ Excel 開啟中文正常，欄位：時間、類型、使用者、IP、檔位、問題（已遮罩）、出處ID、送出字數、回答字數、耗時、狀態、錯誤；包含 ok / no-hit / error / aborted 等狀態。

---

# 可點擊示範版（給別人用手機試用）

`docs/index.html` 是把同一份前端打包成的單一 HTML，API 由 `proto/mock.js` 在瀏覽器內模擬（AI 回答為示範、資料不會儲存），可直接放上 GitHub Pages 或任何靜態網站。

- 重新打包：`npm run build:proto`（只在打包時臨時安裝 esbuild，不影響正式版的零依賴）
- PDF 頁圖放在 `proto/pages/`（檔名 `<原檔名>-<頁碼>.jpg`）

# 部署

- **示範版 → GitHub Pages**：推到 GitHub 後，Settings › Pages › Source 選「GitHub Actions」，`.github/workflows/pages.yml` 會自動發佈 `docs/`。
- **正式版 → Node 主機**：用 `Dockerfile` 部署到 Render / Railway / Fly.io 等；`data/`、`files/` 要掛持久磁碟；上線後立即設定管理員密碼。
- 詳細步驟（給 Codex 等 AI 助手）見 `AGENTS.md`。
