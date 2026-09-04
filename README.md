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

編輯 `sites.json` 的 `sites` 清單後，執行建置指令。每筆資料包含網站名稱、簡介、分類、Pages 網址、GitHub 儲存庫網址，以及最近一次檢查的 HTTP 狀態。`checkedAt` 應填入實際核對日期；本目錄不會自行新增未核對的網站。

分類為 `personal`（個人與品牌）、`medical`（醫療與研究）、`life`（生活與旅行）、`other`（其他網頁）。依清單中的順序顯示。

核對來源為 GitHub 儲存庫清單的 `has_pages`、各專案 Pages API 的 `html_url`，以及公開網頁的標題與內容。`sourceTitle`、`sourceDescription` 保留本次取用的來源文字。

NeuGlia 的 Pages 根目錄回傳 404，實際入口是 `/NeuGlia/neuglia/`，本目錄使用已實測可開啟的入口。其 HTML title 仍為模板標題，顯示名稱取自首頁「Welcome to NeuGlia」。

## 發布

推送至 `main` 後，GitHub Actions 會建置 `dist/` 並部署至 GitHub Pages。儲存庫的 Pages 來源使用 GitHub Actions。

## 檔案

- `sites.json`：網站清單與來源紀錄。
- `src/`：頁面樣板、樣式與圖示。
- `scripts/build.py`：輸出可在沒有 JavaScript 時使用的靜態網頁。
- `.github/workflows/pages.yml`：推送後的建置與部署。
