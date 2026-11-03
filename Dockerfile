# 正式版（含 AI 問答）——需要能長期運行 Node 的主機，例如 Render / Railway / Fly.io / 自家伺服器
FROM node:20-alpine
WORKDIR /app
COPY . .
ENV PORT=8788
EXPOSE 8788
# data/ 與 files/ 保存資料庫、設定（含 API Key）、日誌及原檔，部署時請掛載持久磁碟
VOLUME ["/app/data", "/app/files"]
CMD ["node", "server.cjs"]
