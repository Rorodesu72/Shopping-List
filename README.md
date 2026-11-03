# 出國購物清單

可以加到 iPhone 主畫面的購物清單網站，資料只存在手機，不需要登入，也能離線使用。

## 部署到 GitHub Pages

1. 程式庫：<https://github.com/Rorodesu72/Shopping-List>，要設為 Public。
2. 把這個資料夾的檔案上傳到 `main` 分支（`tools/` 只在本機測試用）。
3. 到程式庫的 Settings → Pages，Source 選 `Deploy from a branch`，分支選 `main`、資料夾選 `/ (root)`。
4. 幾分鐘後，網址會是 <https://rorodesu72.github.io/Shopping-List/>。

程式碼會公開，但清單和照片都在你的手機裡，不會上傳到 GitHub。

## 安裝到 iPhone

1. 用 Safari 開啟上面的網址。
2. 點「分享」→「加入主畫面」→「新增」。
3. 之後都從主畫面圖示開啟。Safari 和主畫面 App 的資料是分開的。

## 備份

- **備份：** 設定 → 備份到 Google 雲端 → 在分享選單選「Google 雲端硬碟」。手機要先安裝 Google Drive App。
- **還原：** 設定 → 從備份匯入 → 在檔案選單切換到 Google 雲端硬碟，選擇備份檔。
- 刪除主畫面圖示通常會一併刪除資料，刪除前請先備份。

## 修改程式

- 改完後把 `sw.js` 的 `VERSION` 加一號（例如 `v1` 改成 `v2`）再上傳。沒改的話，手機不會收到更新。
- 新增檔案時，也要把路徑加進 `sw.js` 的 `ASSETS`。
- 手機下次連上網路開啟 App 時會出現「有新版本」，按下更新即可，清單資料不受影響。

## 新增其他國家

在 `js/countries.js` 新增一組設定（幣別、稅率、分類、店家、給店員看的句子），再把新增旅程的國家欄位改成可選擇。

## 本機測試

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1
```

接著開啟 `http://localhost:8765/`。

## 檔案結構

| 檔案 | 用途 |
|---|---|
| `js/app.js` | 畫面與操作 |
| `js/model.js` | 旅程、商品、容量、品項的資料操作 |
| `js/db.js` | 手機資料庫（IndexedDB） |
| `js/backup.js` | 備份、匯入、復原 |
| `js/money.js` | 含稅、匯率與總額計算 |
| `js/countries.js` | 國家設定 |
| `js/images.js` | 照片壓縮 |
| `sw.js` | 離線快取 |
