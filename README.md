# 網頁目錄

侯岳岑的 GitHub Pages 網站目錄。收錄公開且已啟用 Pages 的專案，不含目錄本身；私人儲存庫不列入。

正式網址：https://brianann2339.github.io/all/

## 本機預覽

只需要 Python 3，沒有第三方相依套件。

```sh
python3 scripts/build.py
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

開啟 `http://127.0.0.1:4173/`。

## 更新內容

GitHub Actions 每天 UTC 00:17（台灣 08:17、日本 09:17）執行同步並重新發布，全程由 GitHub 執行，不需要 Codex、個人電腦或個人存取權杖。排程可能因 GitHub 排隊而延後。

同步會分頁讀取帳號的公開儲存庫，只收錄已啟用 Pages 的專案。新網站自動加入「其他網頁」，名稱與簡介取自公開網頁或儲存庫說明；刪除、轉私人或停用 Pages 的專案會從清單移除。名稱、簡介、分類已人工整理的項目（`curated: true`）會保留，特殊子目錄入口也會保留。外部網站以 `sync: "manual"` 保留在清單中，每天仍會重新檢查網址狀態。

若要自行調整顯示內容，編輯 `sites.json` 並將該筆 `curated` 設為 `true`。`repositoryId` 用來追蹤儲存庫改名，請勿修改。HTTP 失敗的網站會標示「連結待確認」；若 GitHub 清單讀取失敗或結果為空，整次部署中止，保留上一版網站。

可從 GitHub 的 Actions → Deploy directory to GitHub Pages → Run workflow 隨時手動同步。本機也可執行：

```sh
python3 scripts/sync.py
python3 -m unittest discover -s tests
python3 scripts/build.py
```

`sites.json` 的 `checkedAt` 記錄實際同步時間，頁面以日本時間顯示。

分類為 `personal`（個人與品牌）、`medical`（醫療與研究）、`life`（生活與旅行）、`other`（其他網頁）。依清單中的順序顯示。

初始清單由 GitHub Pages API 的 `html_url` 逐筆核對。自動同步使用公開儲存庫清單的 `has_pages` 與 GitHub Pages 標準網址，保留既有特殊入口；HTTP 請求會跟隨自訂網域重新導向。`sourceTitle`、`sourceDescription` 保留取得的來源文字；若某網站讀取失敗，`sourceTitle` 可保留前次標題，HTTP 狀態則記錄本次結果。

NeuGlia 的 Pages 根目錄回傳 404，實際入口是 `/NeuGlia/neuglia/`，本目錄使用已實測可開啟的入口。其 HTML title 仍為模板標題，顯示名稱取自首頁「Welcome to NeuGlia」。

## 發布

每天排程、推送至 `main` 或手動啟動時，GitHub Actions 會同步、測試、建置 `dist/`，寫回 `sites.json` 並部署至 GitHub Pages。工作流程使用 GitHub 自動提供的 `GITHUB_TOKEN`；不使用個人權杖或 Codex。每次同步提交包含最新核對時間，留下可追溯的紀錄。

## 檔案

- `sites.json`：網站清單與來源紀錄。
- `src/`：頁面樣板、樣式與圖示。
- `scripts/build.py`：輸出可在沒有 JavaScript 時使用的靜態網頁。
- `scripts/sync.py`：讀取公開 Pages 專案、更新入口與狀態。
- `tests/test_sync.py`：同步邏輯的合成邊界測試，不是實際網站資料。
- `.github/workflows/pages.yml`：每日自動同步、建置與部署。
