# AGENTS.md — 給 Codex / AI 編碼助手的說明

## 這個專案是什麼
香港保險顧問用的「卓越 Summit 寶典」中文 PWA（繁體中文、港式用語）。分兩部分：

| 部分 | 位置 | 需要伺服器？ | 用途 |
|---|---|---|---|
| 正式版 | `server.cjs` + `public/` + `data/` + `files/` | 要（Node ≥18） | 真正的 AI 問答（DeepSeek）、資料庫、佣金、日誌 |
| 可點擊示範版 | `docs/index.html`（由 `proto/` 打包） | 不用，純靜態 | 給別人用手機點一點看界面；API 在瀏覽器內模擬 |

## 部署任務（請按此執行）

### A. 示範版 → GitHub Pages（預設要做的）
1. 把整個資料夾推到 GitHub 新 repo 的 `main` 分支。
2. Repo › Settings › Pages › Build and deployment › Source 選 **GitHub Actions**。
3. `.github/workflows/pages.yml` 會把 `docs/` 發佈；完成後網址為 `https://<帳號>.github.io/<repo>/`。
4. 用手機打開確認：底部五個導航可切換、AI 問答會逐字出示範答案、資料頁可下鑽及開啟 PDF。

`docs/index.html` 已預先打包好並提交，**不需要在 CI 裏 build**。如修改了 `public/` 或 `proto/`，在本機執行 `npm run build:proto` 重新產生 `docs/index.html` 再提交。

### B. 正式版 → 任何能跑 Node 的主機（需要時才做）
GitHub Pages 不能跑 `server.cjs`。可用 Render / Railway / Fly.io（有 `Dockerfile`），或直接 `node server.cjs`。
- 監聽 `PORT` 環境變數（預設 8788）。
- `data/` 及 `files/` 必須掛載**持久磁碟**，否則重啟後設定（含 API Key）、日誌、上載的文件會消失。
- 部署後到「設定與權限」輸入 DeepSeek API Key，並**設定管理員密碼**（公開網址必須設）。
- Service Worker 只在 HTTPS 下啟用（上述平台都會提供 HTTPS）。

## 硬性規則
- `server.cjs` 只可用 Node 內置模組，**不可加任何 npm 執行期依賴**；前端零構建（原生 ES Module）。
- **絕不提交** `data/config.json`（含 API Key）、`data/usage.json`、`data/logs.jsonl`（已在 `.gitignore`）。
- 改了任何 `public/` 檔案，要把 `public/sw.js` 的 `CACHE` 版本號加一。
- 新增頁面：`public/js/app.js` 的 `ROUTES` 與 `TITLES` 同時加項，並加進 `sw.js` 的 `SHELL`。
- `.pdf` 必須以 `application/pdf` 回應；不可用 `window.open` 或觸發下載。
- `data/library.json` 及 `samples/` 內是**示例資料**，正式使用前要換成公司文件；`data/rates.json` 預設為空（沒有費率時佣金頁會拒絕計算，這是刻意設計）。

## 驗證
- `npm test`：冒煙測試（不呼叫 DeepSeek）。
- 完整逐條自測清單見 `README.md`。
