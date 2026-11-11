# 出攤管理系統 — Code & Architecture Review Handoff

> 產生日期：2026-11-05 ｜ 分支：`main` ｜ 程式碼 commit：`a5fcde8`｜GAS 部署 @46
> 用途：交給另一個 AI 做全局架構與程式碼雙重檢核。第 4 節已嵌入全部原始碼（共 2 個程式檔 + 2 個設定檔），不需另外取得檔案。

---

## 1. 專案目標與核心功能 (Project Overview)

### 要解決的問題
單人經營的手搖飲「擺攤推廣」場景：每次出攤前清點各品項備貨杯數，收攤後數剩餘杯數（即報廢），系統自動算出營業額、報廢成本與毛利，並累積歷史資料，作為下次出攤選品項與配貨量的參考。專案前身是「分店叫茶系統」（分店叫貨／到貨確認／輪替提醒／LINE 通知），已於 commit `7045bdb` 整個移除重寫。

### 使用情境（訪談結論）
- 主要在**收攤後坐下來輸入**，不在攤位上手忙腳亂操作。
- 出攤頻率低（約每週 1–2 次），資料量小（一年約 50–100 場、數百筆明細列）。
- 以試喝推廣為主、販售為輔；試喝與賣出**不分開記**（備貨 − 剩餘 ＝ 賣出，含試喝杯數，營業額因此會略為高估，屬已知取捨）。
- 客人事後叫外送的需求**不記錄**。
- 單人使用，無多使用者／權限需求。

### 核心商業邏輯
| 指標 | 公式 |
|---|---|
| 賣出杯數 | `備貨總量 − 剩餘`（備貨總量＝原備貨＋當日追加） |
| 報廢杯數 | ＝ 剩餘杯數（使用者收攤時數剩下幾杯，直接填入） |
| 營業額 | `Σ (備貨總量 − 剩餘) × 售價` |
| 報廢成本 | `Σ 剩餘 × 成本價` |
| 毛利 | `營業額 − Σ 備貨總量 × 成本價`（扣除全部備貨成本含追加，不只是賣出的） |

售價／成本在每次開攤寫入時以**快照**存進出攤紀錄的 H、I 欄（`售價快照`、`成本快照`）；讀取時優先使用該列快照，只有舊資料（H、I 空白）才退回以品項名稱查「品項設定」的現行價格。因此日後調價、改名、刪除品項都不會回溯改動已寫入快照的歷史金額。僅對「已填剩餘杯數」的列計算金額。

### 主要功能
1. **一日狀態**：可切換任意日期（前後一天／日期選擇器）。顯示當日場次：未開攤（可開攤或補登）／開攤中（備貨列表，可填收攤、可修改開攤）／已收攤（營業額、報廢成本、毛利、各品項明細、可修改剩餘杯數）。
2. **開攤表單**：選地點、最多 4 個品項（品項、甜度、備貨杯數）；另有選填的「剩餘杯數」，補登時可一次填完，全部留空則只記錄開攤。
3. **收攤表單**：每品項填剩餘杯數，即時預覽賣出杯數與營業額。
4. **追加補貨**：開攤中若某品項提早賣完、請店裡補貨，可在「追加補貨」畫面填本次追加杯數（累加到該品項的追加杯數）；備貨總量隨之增加，營業額／毛利／報廢上限都以總量計算。已收攤或補登時，可在「修改開攤／備貨資料」直接修正追加杯數。
5. **紀錄**：區間（30/90 天、全部、自訂）＋地點篩選；合計、每場營業額長條圖（最近 16 場）、各場次列表（點擊跳到該日）、品項配貨（每品項每場的實際備貨／賣出／剩餘，不做平均或自動建議）。
6. **設定**：品項管理（名稱、售價、成本、甜度選項）、地點管理。

### Tech Stack
| 層 | 技術 | 備註 |
|---|---|---|
| 前端 | 純 HTML/CSS/JS 單檔 SPA（`index.html`） | 無框架、無建置步驟、無 npm 套件；字型 Google Fonts（Noto Sans TC / Noto Serif TC）；支援 `prefers-color-scheme` 深色 |
| 前端託管 | GitHub Pages | `https://berniekang2003.github.io/tea-shop-system/`，push 到 `main` 後自動部署 |
| 後端 | Google Apps Script Web App（V8 runtime） | `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`，時區 `Asia/Taipei` |
| 資料庫 | Google Sheets（綁定在 GAS 專案的試算表） | 3 個工作表，見第 3 節 |
| 部署工具 | clasp 3.3.0 | `.clasp.json` 的 `rootDir` 指向 `gas/`；線上部署 ID 固定，目前 @46 |
| 其他 | 無 CI、無測試框架、無 linter | |

GAS 部署：`AKfycbyKrS_BEKBj7Y2ZGq6iz4996VXMAApjxsNwaHFysmmjzsDjWi_L8p7O4LwM-8yJP_w-FQ`（@44）。前端內寫死此 `/exec` 網址。無任何 `.env` 或機密檔；唯一的「憑證」概念是這個公開網址本身（見第 5、6 節）。

---

## 2. 目錄結構樹 (Directory Structure)

```
分店叫茶系統/
├── index.html            # 整個前端：CSS 設計 token、狀態物件、7 個畫面的 render 函式、API 呼叫（約 1130 行）
├── gas/
│   ├── 程式碼.js          # 整個後端：doGet/doPost 路由 + Sheets CRUD + 統計（約 370 行）；檔名須與雲端一致，否則 clasp push 會產生重複檔案
│   └── appsscript.json   # GAS manifest：V8、Asia/Taipei、webapp 匿名存取設定
├── .clasp.json           # clasp 專案連結（scriptId + rootDir=gas）
├── .claude/
│   └── settings.local.json  # Claude Code 本機權限設定（非專案程式，可忽略）
└── README.md             # 僅標題，無內容
```
（無 `package.json`、無 `node_modules`、無建置產物。）

---

## 3. 系統架構與資料流 (Architecture & Data Flow)

### 整體架構
```
 手機瀏覽器
 ┌──────────────────────────────┐   GET  /exec?action=...&k=v     ┌──────────────────────────┐
 │ index.html (GitHub Pages)    │ ───────────────────────────────▶ │ GAS Web App              │
 │  state{} → render() → innerHTML │   POST /exec  body=JSON(text/plain)│  doGet / doPost 路由     │
 │  (全頁重繪，無 virtual DOM)   │ ◀─────────────────────────────── │  → SpreadsheetApp 讀寫    │
 └──────────────────────────────┘   JSON                           └────────────┬─────────────┘
                                                                                 │
                                                                    Google Sheets: 品項設定 / 地點設定 / 出攤紀錄
```
POST 刻意不設 `Content-Type`（瀏覽器送 `text/plain`），避免 CORS preflight（GAS 不支援 OPTIONS）。

### 資料表 Schema（皆從第 2 列起為資料，第 1 列為標題，需手動建立）
| 工作表 | A | B | C | D | E | F | G | H | I | J |
|---|---|---|---|---|---|---|---|---|---|---|
| 品項設定 | 名稱（唯一鍵） | 售價 | 成本 | 甜度選項（逗號分隔） | | | | | | |
| 地點設定 | 地點名稱 | | | | | | | | | |
| 出攤紀錄 | 日期 `yyyyMMdd` | 地點 | 品項名稱 | 甜度 | 原備貨 | 剩餘/報廢（空＝尚未收攤） | 狀態 `開攤中`/`已收攤` | 售價快照 | 成本快照 | 追加杯數（累計） |

- 「場次」沒有獨立表／主鍵：**一個場次＝同一個日期的所有列**（同日期的列在插入時連續）。同一日期只能有一場。
- 場次的「地點」取該日第一列、「狀態」取該日最後一列的 G 欄。
- H、I、J 欄為舊資料所無：H、I 空白的舊列讀取時退回品項設定的現行價格；J 空白視為追加 0。欄數不足 10 的工作表在讀取時以空字串補齊、寫入時自動補欄並補上 H1/I1/J1 表頭（已有自訂表頭不覆寫）。
- **備貨總量＝E（原備貨）＋J（追加）**。API 回傳的 `prepared` 是總量，`extra` 是 J；前端以 `prepared − extra` 還原原備貨給表單編輯。
- 寫入文字欄位（地點、品項、甜度）時，開頭為 `=`、`+`、`-`、`@`、Tab、CR 者會加上單引號前綴（`safeText`）以防公式注入。

### API（單一 `/exec` 端點，以 `action` 分派）
| 方法 | action | 參數 | 回傳 |
|---|---|---|---|
| GET | `getInit` | `date` | `{items,locations,stall}`：一次回傳品項、地點與該日場次（前端啟動用；單次執行、共用一次品項讀取） |
| GET | `getItems` | — | `{items:[{name,price,cost,sweetnesses[]}]}` |
| GET | `getLocations` | — | `{locations:[string]}` |
| GET | `getStallData` | `date`(yyyymmdd) | `{found:false}` 或 `{found,date,location,status,items:[{name,sweetness,prepared,extra,waste或null,price,cost}]}`（`prepared`＝備貨總量，`extra`＝追加杯數） |
| GET | `getHistory` | `startDate?`,`endDate?` | `{records:[{date,location,status,items[],revenue,wasteCost,profit,totalPrepared,totalWaste}]}`（日期新→舊；items 的 price/cost 為快照優先） |
| POST | `saveItem` | `originalName,name,price,cost,sweetnesses[]` | `{ok}`；改名時同步更新出攤紀錄 C 欄；改成已存在的名稱回 `{error}` |
| POST | `deleteItem` / `saveLocation` / `deleteLocation` | `name` | `{ok}` |
| POST | `openStall` | `date,location,items[{name,sweetness,prepared,extra?,waste?}]` | 先驗證（空品項／重複／非整數一律在刪除前拒絕），再批次刪除該日期的舊列（連續區段合併 `deleteRows`），沿用同日舊列的價格快照與追加杯數（`extra` 有帶才覆寫，帶 0 即清除）、新品項取現價（查無則用前端傳入或 0），寫入 9 欄；若**所有**品項都帶有效 `waste` 則直接寫入 F 欄並設狀態 `已收攤`（單一請求完成補登），否則 F 空、狀態 `開攤中` |
| POST | `closeStall` | `date,items[{name,waste}]` | 讀 A~G 後在記憶體更新，**一次** `setValues` 寫回 F~G；找不到品項、waste 非整數或超過備貨總量（原備貨＋追加）會整批拒絕 |
| POST | `addStock` | `date,items[{name,add}]` | 開攤中追加補貨：把每項 `add`（正整數）累加到 J 欄，整欄一次 `setValues`；已收攤、找不到品項、重複、非正整數整批拒絕（不部分寫入） |

錯誤一律以 HTTP 200 + `{error: "..."}` 回傳（GAS 無法自訂狀態碼）。所有 POST 先以 `LockService.getScriptLock().waitLock(15000)` 取得腳本鎖（逾時回「系統忙碌中」），`finally` 釋放；GET 不加鎖。

### 前端狀態管理
- 單一全域 `state` 物件（目前畫面、品項、地點、`viewDate`、`stall`、`records`、篩選條件等），**`render()` 依 `state.screen` 重新產生整個 `#app` 的 innerHTML**，事件以 inline `onclick`/`onchange` 綁定（全域函式）。
- 8 個畫面：`session`（一日狀態）、`open-stall`、`close-stall`、`topup`（追加補貨）、`records`、`settings`、`edit-item`、`add-location`；底部 3 個 tab（一日狀態／紀錄／設定）。
- 表單畫面的輸入值**不存進 state**，送出時直接讀 DOM；因此任何在表單畫面期間觸發的 `render()` 都會清掉使用者已輸入的內容。對策：非同步載入完成後只在 `!isFormScreen()`（非 `open-stall`/`close-stall`/`topup`/`edit-item`/`add-location`）時才 `render()`；`window._editSweets` 只在 `editItem()`/`newItem()` 進入時初始化。
- 數字輸入一律經 `parseNonNegInt`（`/^\d+$/`，只接受半形非負整數）；收攤表單空白不再視為 0。
- 追加：`topup` 畫面僅在場次為開攤中時可用，送出 `addStock`。`calc()`、收攤上限與預覽直接使用 `prepared`（已是總量）；開攤表單三欄（備貨＝`prepared−extra`、追加＝`extra`、剩餘），送出時一律帶 `extra`（空白＝0）。
- 啟動時呼叫 `getInit`（1 個請求）；若回應沒有 `items`（舊版 GAS）則退回原本 3 個並發請求。
- 所有統計（營業額、毛利、圖表）在**前端**由 `calc(items)` 以 API 回傳的 price/cost（已是快照優先）即時計算；`getHistory` 回傳的 `revenue/wasteCost/profit` 目前前端未使用，兩邊公式需保持一致。
- 資料流範例（收攤）：`close-stall` 表單 → `submitCloseStall()` 嚴格驗證 → `POST closeStall` → `refreshStall()` 重新 GET 當日資料並使 `state.records=null`（下次進紀錄頁重抓）→ `go('session')` → `render()`。
- 「開攤」與「修改開攤／備貨」共用 `open-stall` 表單；剩餘杯數欄預填既有值，全部填寫＝單一 `openStall` 請求完成補登，全部清空且原本已收攤則先 `confirm` 再回到開攤中。已收攤場次同時提供「修改剩餘杯數」與「修改開攤／備貨資料」兩個入口。

---

## 4. 核心程式碼內容 (Core Source Code)

### 4.1 `gas/程式碼.js`（後端，完整）
```javascript
const SS = SpreadsheetApp.getActiveSpreadsheet();
const REC_COLS = 10; // 出攤紀錄 A~J：日期,地點,品項,甜度,備貨,剩餘,狀態,售價快照,成本快照,追加杯數

function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === 'getInit')      return getInit(e.parameter.date);
    if (action === 'getItems')     return respond({ items: readItems() });
    if (action === 'getLocations') return respond({ locations: readLocations() });
    if (action === 'getStallData') return getStallData(e.parameter.date);
    if (action === 'getHistory')   return getHistory(e.parameter);
    return respond({ error: '未知的 action' });
  } catch(err) {
    return respond({ error: err.message });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch(err) {
    return respond({ error: '系統忙碌中，請稍後再試' });
  }
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    if (action === 'saveItem')       return saveItem(data);
    if (action === 'deleteItem')     return deleteItem(data);
    if (action === 'saveLocation')   return saveLocation(data);
    if (action === 'deleteLocation') return deleteLocation(data);
    if (action === 'openStall')      return openStall(data);
    if (action === 'closeStall')     return closeStall(data);
    if (action === 'addStock')       return addStock(data);
    return respond({ error: '未知的 action' });
  } catch(err) {
    return respond({ error: err.message });
  } finally {
    lock.releaseLock();
  }
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- helpers ---------- */
function today() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd');
}

function toStr(val) {
  if (val === null || val === undefined || val === '') return '';
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Taipei', 'yyyyMMdd');
  return String(val);
}

function normDate(d) {
  return String(d || today()).replace(/[\/-]/g, '');
}

function hasVal(v) {
  return v !== '' && v !== null && v !== undefined;
}

function num(v, fallback) {
  if (!hasVal(v)) return fallback;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function safeText(s) {
  s = String(s === null || s === undefined ? '' : s);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function isNonNegInt(n) {
  return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= 0;
}

/* ---------- 讀取 ---------- */
function readItems() {
  const sheet = SS.getSheetByName('品項設定');
  if (!sheet || sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues()
    .filter(r => r[0])
    .map(r => ({
      name: toStr(r[0]),
      price: Number(r[1]) || 0,
      cost: Number(r[2]) || 0,
      sweetnesses: toStr(r[3]).split(',').map(s => s.trim()).filter(Boolean)
    }));
}

function getPriceMap(items) {
  const map = {};
  (items || readItems()).forEach(it => { map[it.name] = { price: it.price, cost: it.cost }; });
  return map;
}

function readLocations() {
  const sheet = SS.getSheetByName('地點設定');
  if (!sheet || sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().filter(r => r[0]).map(r => toStr(r[0]));
}

// 讀出攤紀錄 A~J；欄數不足的舊表以空字串補齊
function readRecRange(sheet) {
  const cols = Math.min(REC_COLS, Math.max(sheet.getMaxColumns(), 7));
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, cols).getValues().map(r => {
    while (r.length < REC_COLS) r.push('');
    return r;
  });
}

function readRecords() {
  const sheet = SS.getSheetByName('出攤紀錄');
  if (!sheet || sheet.getLastRow() <= 1) return { sheet, rows: [] };
  return { sheet, rows: readRecRange(sheet) };
}

// 優先使用該列的價格快照；舊資料（H、I 欄空白）退回品項設定的現行價格
function rowToItem(r, priceMap) {
  const name = toStr(r[2]);
  const pm = priceMap[name] || { price: 0, cost: 0 };
  const extra = num(r[9], 0);
  return {
    name,
    sweetness: toStr(r[3]),
    prepared: (Number(r[4]) || 0) + extra,   // 備貨總量＝原備貨＋追加
    extra,
    waste: hasVal(r[5]) ? Number(r[5]) : null,
    price: num(r[7], pm.price),
    cost: num(r[8], pm.cost)
  };
}

function buildStall(date, priceMap) {
  const targetDate = normDate(date);
  const dayRows = readRecords().rows.filter(r => toStr(r[0]) === targetDate);
  if (dayRows.length === 0) return { found: false };
  return {
    found: true,
    date: targetDate,
    location: toStr(dayRows[0][1]),
    status: toStr(dayRows[dayRows.length - 1][6]),
    items: dayRows.map(r => rowToItem(r, priceMap))
  };
}

function getInit(date) {
  const items = readItems();
  return respond({ items, locations: readLocations(), stall: buildStall(date, getPriceMap(items)) });
}

function getStallData(date) {
  return respond(buildStall(date, getPriceMap()));
}

function getHistory(params) {
  const start = params.startDate ? normDate(params.startDate) : '';
  const end   = params.endDate   ? normDate(params.endDate)   : '';
  const priceMap = getPriceMap();

  const grouped = {};
  readRecords().rows.forEach(r => {
    const date = toStr(r[0]);
    if (!date) return;
    if (start && date < start) return;
    if (end   && date > end)   return;
    if (!grouped[date]) grouped[date] = { date, location: toStr(r[1]), status: '', items: [] };
    grouped[date].items.push(rowToItem(r, priceMap));
    grouped[date].status = toStr(r[6]);
  });

  const records = Object.values(grouped).sort((a, b) => b.date.localeCompare(a.date)).map(rec => {
    let revenue = 0, wasteCost = 0, totalPrepared = 0, totalWaste = 0, cost = 0;
    rec.items.forEach(item => {
      if (item.waste !== null) {
        revenue   += (item.prepared - item.waste) * item.price;
        wasteCost += item.waste * item.cost;
        cost      += item.prepared * item.cost;
        totalPrepared += item.prepared;
        totalWaste    += item.waste;
      }
    });
    return { ...rec, revenue, wasteCost, profit: revenue - cost, totalPrepared, totalWaste };
  });

  return respond({ records });
}

/* ---------- 品項／地點 ---------- */
function saveItem(data) {
  const name = String(data.name || '').trim();
  if (!name) return respond({ error: '請輸入品項名稱' });
  const sheet = SS.getSheetByName('品項設定');
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues() : [];
  const searchName = data.originalName || name;
  const idx = rows.findIndex(r => toStr(r[0]) === searchName);
  if (name !== searchName && rows.some(r => toStr(r[0]) === name)) return respond({ error: '已有同名品項' });
  const sweets = (data.sweetnesses || []).map(s => String(s).replace(/[,，]/g, '').trim()).filter(Boolean);
  const row = [safeText(name), Number(data.price) || 0, Number(data.cost) || 0, safeText(sweets.join(','))];
  if (idx >= 0) {
    sheet.getRange(idx + 2, 1, 1, 4).setValues([row]);
    if (name !== searchName) renameInRecords(searchName, name);
  } else {
    sheet.appendRow(row);
  }
  return respond({ ok: true });
}

function renameInRecords(oldName, newName) {
  const rec = SS.getSheetByName('出攤紀錄');
  if (!rec || rec.getLastRow() <= 1) return;
  const range = rec.getRange(2, 3, rec.getLastRow() - 1, 1);
  range.setValues(range.getValues().map(r => [toStr(r[0]) === oldName ? safeText(newName) : r[0]]));
}

function deleteItem(data) {
  const sheet = SS.getSheetByName('品項設定');
  if (sheet.getLastRow() <= 1) return respond({ ok: true });
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (toStr(rows[i][0]) === data.name) { sheet.deleteRow(i + 2); break; }
  }
  return respond({ ok: true });
}

function saveLocation(data) {
  const name = String(data.name || '').trim();
  if (!name) return respond({ error: '請輸入地點名稱' });
  const sheet = SS.getSheetByName('地點設定');
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues() : [];
  if (!rows.some(r => toStr(r[0]) === name)) sheet.appendRow([safeText(name)]);
  return respond({ ok: true });
}

function deleteLocation(data) {
  const sheet = SS.getSheetByName('地點設定');
  if (sheet.getLastRow() <= 1) return respond({ ok: true });
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (toStr(rows[i][0]) === data.name) { sheet.deleteRow(i + 2); break; }
  }
  return respond({ ok: true });
}

/* ---------- 出攤 ---------- */
// 欄數不足 10 時補欄；表頭 H、I、J 空白時自動補上
function ensureRecCols(sheet) {
  const max = sheet.getMaxColumns();
  if (max < REC_COLS) sheet.insertColumnsAfter(max, REC_COLS - max);
  if (sheet.getLastRow() >= 1) {
    const h = sheet.getRange(1, 8, 1, 3).getValues()[0];
    if (!h[0] || !h[1] || !h[2]) sheet.getRange(1, 8, 1, 3).setValues([[h[0] || '售價快照', h[1] || '成本快照', h[2] || '追加杯數']]);
  }
}

// 將已排序的列號合併為連續區段，由下往上批次刪除
function deleteRowRuns(sheet, rowNums) {
  if (rowNums.length === 0) return;
  const runs = [];
  let start = rowNums[0], prev = rowNums[0];
  for (let i = 1; i < rowNums.length; i++) {
    if (rowNums[i] === prev + 1) { prev = rowNums[i]; continue; }
    runs.push([start, prev - start + 1]);
    start = prev = rowNums[i];
  }
  runs.push([start, prev - start + 1]);
  for (let i = runs.length - 1; i >= 0; i--) sheet.deleteRows(runs[i][0], runs[i][1]);
}

function openStall(data) {
  const sheet = SS.getSheetByName('出攤紀錄');
  const date = normDate(data.date);
  const location = String(data.location || '').trim();
  const items = Array.isArray(data.items) ? data.items : [];

  if (!location) return respond({ error: '請選擇地點' });
  if (items.length === 0) return respond({ error: '請至少填寫一項品項' });
  const seen = {};
  for (const it of items) {
    const name = String(it.name || '').trim();
    if (!name) return respond({ error: '品項名稱不可空白' });
    if (seen[name]) return respond({ error: `「${name}」重複` });
    seen[name] = true;
    if (!isNonNegInt(Number(it.prepared)) || Number(it.prepared) <= 0) return respond({ error: `「${name}」備貨量需為大於 0 的整數` });
    if (hasVal(it.extra) && !isNonNegInt(Number(it.extra))) return respond({ error: `「${name}」追加杯數需為 0 以上的整數` });
  }

  // 同日舊列：記下價格快照與追加杯數（呼叫端未帶 extra 時沿用）
  const oldSnap = {}, oldExtra = {}, toDelete = [];
  readRecords().rows.forEach((r, i) => {
    if (toStr(r[0]) !== date) return;
    toDelete.push(i + 2);
    const name = toStr(r[2]);
    if (hasVal(r[7]) && hasVal(r[8])) oldSnap[name] = { price: Number(r[7]), cost: Number(r[8]) };
    oldExtra[name] = num(r[9], 0);
  });
  const extraOf = it => hasVal(it.extra) ? Number(it.extra) : (oldExtra[String(it.name).trim()] || 0);

  const hasWaste = it => it.waste !== undefined && it.waste !== null && it.waste !== '';
  const allWaste = items.every(hasWaste);
  if (allWaste) {
    for (const it of items) {
      const w = Number(it.waste);
      if (!isNonNegInt(w) || w > Number(it.prepared) + extraOf(it)) return respond({ error: `「${it.name}」剩餘杯數需介於 0 到備貨量` });
    }
  }

  ensureRecCols(sheet);
  const priceMap = getPriceMap();
  deleteRowRuns(sheet, toDelete);

  const newRows = items.map(it => {
    const name = String(it.name).trim();
    const snap = oldSnap[name] || priceMap[name] || { price: num(it.price, 0), cost: num(it.cost, 0) };
    return [
      date, safeText(location), safeText(name), safeText(it.sweetness || ''),
      Number(it.prepared),
      allWaste ? Number(it.waste) : '',
      allWaste ? '已收攤' : '開攤中',
      snap.price, snap.cost,
      extraOf(it)
    ];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, REC_COLS).setValues(newRows);
  return respond({ ok: true });
}

function closeStall(data) {
  const sheet = SS.getSheetByName('出攤紀錄');
  if (!sheet || sheet.getLastRow() <= 1) return respond({ error: '無出攤紀錄' });
  const date = normDate(data.date);
  const items = Array.isArray(data.items) ? data.items : [];
  const rows = readRecRange(sheet);
  const fg = rows.map(r => [r[5], r[6]]);

  for (const it of items) {
    const waste = Number(it.waste);
    const i = rows.findIndex(r => toStr(r[0]) === date && toStr(r[2]) === it.name);
    if (i < 0) return respond({ error: `找不到「${it.name}」的開攤紀錄` });
    const total = Number(rows[i][4]) + num(rows[i][9], 0);
    if (!isNonNegInt(waste) || waste > total) return respond({ error: `「${it.name}」剩餘杯數需介於 0 到備貨量` });
    fg[i] = [waste, '已收攤'];
  }
  sheet.getRange(2, 6, rows.length, 2).setValues(fg);
  return respond({ ok: true });
}

// 開攤中追加補貨：把本次追加杯數累加到 J 欄，整欄一次寫回
function addStock(data) {
  const sheet = SS.getSheetByName('出攤紀錄');
  if (!sheet || sheet.getLastRow() <= 1) return respond({ error: '無出攤紀錄' });
  const date = normDate(data.date);
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length === 0) return respond({ error: '請至少填寫一項追加數量' });

  ensureRecCols(sheet);
  const rows = readRecRange(sheet);
  const j = rows.map(r => [r[9]]);
  const seen = {};
  for (const it of items) {
    const add = Number(it.add);
    if (!isNonNegInt(add) || add <= 0) return respond({ error: `「${it.name}」追加杯數需為大於 0 的整數` });
    if (seen[it.name]) return respond({ error: `「${it.name}」重複` });
    seen[it.name] = true;
    const i = rows.findIndex(r => toStr(r[0]) === date && toStr(r[2]) === it.name);
    if (i < 0) return respond({ error: `找不到「${it.name}」的開攤紀錄` });
    if (toStr(rows[i][6]) === '已收攤') return respond({ error: '已收攤的場次請用「修改開攤／備貨資料」調整追加量' });
    j[i] = [num(j[i][0], 0) + add];
  }
  sheet.getRange(2, 10, rows.length, 1).setValues(j);
  return respond({ ok: true });
}
```

### 4.2 `gas/appsscript.json`（GAS manifest，完整）
```json
{
  "timeZone": "Asia/Taipei",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  }
}
```

### 4.3 `.clasp.json`（完整）
```json
{
  "scriptId": "18DDoGG3Wx4DXdPMkaUrRIuRsU1nDgJ9ZNdKolJgYU8ur9nqpV1qY3grh",
  "rootDir": "gas"
}
```

### 4.4 `index.html`（前端，完整）
```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
  <meta name="theme-color" content="#f1efe6">
  <title>出攤管理</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #f1efe6;
      --surface: #faf9f3;
      --surface2: #ebe8dc;
      --ink: #272b22;
      --ink2: #62675a;
      --ink3: #92978a;
      --line: rgba(39,43,34,0.11);
      --accent: #47663a;
      --accent-soft: #dfe8d2;
      --accent-ink: #ffffff;
      --hero: #3b5530;
      --hero-ink: #f4f1e4;
      --waste: #a8502b;
      --waste-soft: #f3e1d8;
      --shadow: 0 1px 2px rgba(39,43,34,0.05), 0 4px 14px rgba(39,43,34,0.05);
      --serif: 'Noto Serif TC', 'Songti TC', serif;
      --sans: 'Noto Sans TC', -apple-system, BlinkMacSystemFont, 'PingFang TC', sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #171a14;
        --surface: #21251d;
        --surface2: #2b3025;
        --ink: #ebe8da;
        --ink2: #a5aa98;
        --ink3: #767b6b;
        --line: rgba(235,232,218,0.12);
        --accent: #9bbd84;
        --accent-soft: #2c3926;
        --accent-ink: #14210f;
        --hero: #2d4125;
        --hero-ink: #ecebd9;
        --waste: #e19a78;
        --waste-soft: #3a2a22;
        --shadow: 0 1px 2px rgba(0,0,0,0.3);
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    html { background: var(--bg); }
    body { font-family: var(--sans); background: var(--bg); color: var(--ink); min-height: 100vh; padding-bottom: calc(92px + env(safe-area-inset-bottom)); font-size: 15px; line-height: 1.45; }
    button { font-family: inherit; }

    /* NAV */
    .nav { position: fixed; bottom: 0; left: 0; right: 0; background: var(--surface); border-top: 1px solid var(--line); display: flex; z-index: 100; padding-bottom: env(safe-area-inset-bottom); }
    .nav-tab { flex: 1; display: flex; flex-direction: column; align-items: center; padding: 10px 0 8px; gap: 3px; font-size: 11px; font-weight: 500; color: var(--ink3); cursor: pointer; }
    .nav-tab svg { width: 22px; height: 22px; }
    .nav-tab.active { color: var(--accent); font-weight: 700; }

    /* HEADER */
    .header { background: var(--bg); padding: 16px 20px 10px; position: sticky; top: 0; z-index: 50; }
    .header h1 { font-family: var(--serif); font-size: 19px; font-weight: 700; text-align: center; }
    .header-sub { font-size: 12px; color: var(--ink2); text-align: center; margin-top: 2px; }
    .header-row { display: flex; align-items: center; justify-content: space-between; }
    .back-btn { font-size: 15px; color: var(--accent); font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 4px; min-width: 56px; }

    /* DATE NAV */
    .datenav { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .icon-btn { width: 40px; height: 40px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .icon-btn:active { background: var(--surface2); }
    .datepick { position: relative; flex: 1; text-align: center; cursor: pointer; padding: 6px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
    .dp-main svg { width: 16px; height: 16px; vertical-align: -2px; margin-right: 6px; color: var(--accent); }
    .dp-main { font-family: var(--serif); font-size: 19px; font-weight: 700; display: block; }
    .dp-sub { font-size: 12px; color: var(--ink2); display: block; margin-top: 1px; }
    .datepick input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: 0; padding: 0; }
    .today-link { display: block; margin: 6px auto 0; font-size: 12px; font-weight: 500; color: var(--accent); background: none; border: none; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }

    /* HERO */
    .hero { background: var(--hero); color: var(--hero-ink); border-radius: 18px; padding: 22px 20px; margin: 8px 16px 0; }
    .hero-label { font-size: 13px; opacity: 0.8; margin-bottom: 4px; }
    .hero-title { font-family: var(--serif); font-size: 38px; font-weight: 700; line-height: 1.15; font-variant-numeric: tabular-nums; }
    .hero-sub { font-size: 13px; opacity: 0.8; margin-top: 6px; }
    .pill { display: inline-block; background: rgba(255,255,255,0.16); border-radius: 999px; padding: 3px 11px; font-size: 12px; font-weight: 500; margin-top: 12px; }

    /* STATS */
    .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 16px 0; }
    .stat { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; }
    .stat-label { font-size: 12px; color: var(--ink2); margin-bottom: 4px; }
    .stat-value { font-family: var(--serif); font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .stat-value.good { color: var(--accent); }
    .stat-value.bad { color: var(--waste); }
    .stat-sub { font-size: 11px; color: var(--ink3); margin-top: 2px; }

    /* SECTION / CARD */
    .section { margin: 16px 16px 0; }
    .section-label { font-size: 12px; color: var(--ink2); font-weight: 700; padding: 0 2px 7px; letter-spacing: 0.06em; }
    .card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }

    /* ITEM ROWS */
    .irow { display: grid; grid-template-columns: 1fr 46px 46px 46px; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--line); gap: 4px; }
    .irow:last-child { border-bottom: none; }
    .ihead { font-size: 11px; color: var(--ink3); font-weight: 500; padding: 9px 16px; background: var(--surface2); }
    .ihead span:not(:first-child), .irow .n { text-align: right; font-variant-numeric: tabular-nums; }
    .iname { font-weight: 500; }
    .iname small { display: block; font-size: 12px; color: var(--ink3); font-weight: 400; margin-top: 1px; }
    .irow .strong { font-weight: 700; }
    .irow .waste { color: var(--waste); font-weight: 700; }

    /* BUTTONS */
    .btn { width: 100%; padding: 14px; border-radius: 12px; border: 1px solid transparent; font-size: 16px; font-weight: 700; cursor: pointer; margin-top: 10px; }
    .btn:active { opacity: 0.8; }
    .btn:disabled { opacity: 0.55; }
    .btn-primary { background: var(--accent); color: var(--accent-ink); }
    .btn-secondary { background: var(--surface); color: var(--ink); border-color: var(--line); }
    .btn-danger { background: var(--waste-soft); color: var(--waste); }
    .btn-sm { width: auto; margin-top: 0; padding: 7px 14px; font-size: 13px; border-radius: 10px; font-weight: 500; }
    .btn-sm.btn-secondary { background: var(--surface2); border-color: transparent; }

    /* FORM */
    .form-label { font-size: 12px; color: var(--ink2); font-weight: 700; margin: 16px 0 6px; letter-spacing: 0.04em; }
    .form-label:first-child { margin-top: 0; }
    input, select { width: 100%; padding: 12px 13px; border-radius: 10px; border: 1.5px solid var(--line); font-size: 16px; background: var(--bg); color: var(--ink); appearance: none; -webkit-appearance: none; outline: none; font-family: inherit; }
    input:focus, select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    input::placeholder { color: var(--ink3); }
    select { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2392978a' stroke-width='1.6' fill='none' stroke-linecap='round'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 13px center; padding-right: 34px; }

    .slot { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px 16px; margin-bottom: 10px; }
    .slot-title { font-size: 13px; font-weight: 700; color: var(--ink2); margin-bottom: 10px; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .slot-title em { font-style: normal; font-weight: 400; font-size: 12px; color: var(--ink3); }
    .slot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .slot-grid.g3 { grid-template-columns: 1fr 1fr 1fr; }
    .slot-grid .full { grid-column: 1 / -1; }
    .slot-grid label { font-size: 12px; color: var(--ink2); display: block; margin-bottom: 5px; }
    .preview { padding: 11px 13px; background: var(--accent-soft); color: var(--accent); border-radius: 10px; font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .preview.over { background: var(--waste-soft); color: var(--waste); }
    .preview.idle { background: var(--surface2); color: var(--ink3); font-weight: 500; }
    .hint { font-size: 12px; color: var(--ink3); margin: -2px 2px 10px; }

    /* CHIPS / SEGMENT */
    .chips { display: flex; gap: 8px; flex-wrap: wrap; }
    .chip { padding: 7px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-size: 13px; font-weight: 500; color: var(--ink2); cursor: pointer; }
    .chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
    .seg { display: flex; background: var(--surface2); border-radius: 12px; padding: 3px; }
    .seg button { flex: 1; padding: 9px 0; border: none; background: transparent; border-radius: 9px; font-size: 14px; font-weight: 500; color: var(--ink2); cursor: pointer; }
    .seg button.on { background: var(--surface); color: var(--ink); font-weight: 700; box-shadow: var(--shadow); }
    .filter-dates { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
    .filter-dates span { color: var(--ink3); font-size: 13px; }

    /* RECORDS */
    .totals { display: grid; grid-template-columns: repeat(3, 1fr); }
    .totals > div { padding: 14px 12px; text-align: center; border-right: 1px solid var(--line); }
    .totals > div:last-child { border-right: none; }
    .totals .stat-value { font-size: 18px; }
    .chart-card { padding: 14px 12px 8px; }
    .chart-title { font-size: 12px; color: var(--ink2); font-weight: 700; padding: 0 4px 6px; }
    .chart-card svg { display: block; width: 100%; height: auto; }
    .bar { fill: var(--accent-soft); stroke: var(--accent); stroke-width: 1; }
    .bar.latest { fill: var(--accent); }
    .chart-txt { font-size: 9px; fill: var(--ink2); font-family: var(--sans); }
    .chart-base { stroke: var(--line); stroke-width: 1; }
    .srow { display: flex; align-items: center; gap: 10px; padding: 13px 16px; border-bottom: 1px solid var(--line); cursor: pointer; }
    .srow:last-child { border-bottom: none; }
    .srow:active { background: var(--surface2); }
    .srow-main { flex: 1; min-width: 0; }
    .srow-date { font-weight: 700; }
    .srow-meta { font-size: 12px; color: var(--ink3); margin-top: 1px; }
    .srow-money { font-family: var(--serif); font-weight: 700; font-size: 17px; font-variant-numeric: tabular-nums; text-align: right; }
    .srow-money small { display: block; font-family: var(--sans); font-weight: 400; font-size: 11px; color: var(--waste); }
    .tag-open { font-size: 11px; font-weight: 700; background: var(--accent-soft); color: var(--accent); padding: 3px 10px; border-radius: 999px; }
    .prow { display: grid; grid-template-columns: 1fr 40px 40px 40px; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--line); gap: 4px; font-size: 14px; }
    .prow:last-child { border-bottom: none; }
    .prow .n { text-align: right; font-variant-numeric: tabular-nums; }
    .prow .n.strong { font-weight: 700; }
    .prow .n.waste { color: var(--waste); font-weight: 700; }
    .prow small { display: block; font-size: 11px; color: var(--ink3); }
    .pcard-head { display: flex; justify-content: space-between; align-items: baseline; padding: 13px 16px 11px; }
    .pcard-head b { font-family: var(--serif); font-size: 17px; }
    .pcard-head span { font-size: 12px; color: var(--ink3); }

    /* SETTINGS */
    .settings-item { display: flex; align-items: center; padding: 13px 16px; border-bottom: 1px solid var(--line); gap: 12px; }
    .settings-item:last-child { border-bottom: none; }
    .settings-item-info { flex: 1; min-width: 0; }
    .settings-item-name { font-weight: 700; }
    .settings-item-sub { font-size: 12px; color: var(--ink2); margin-top: 2px; }
    .settings-item-actions { display: flex; gap: 8px; }
    .tags { display: flex; flex-wrap: wrap; gap: 6px; }
    .tag { background: var(--accent-soft); color: var(--accent); padding: 5px 12px; border-radius: 999px; font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 6px; }
    .tag-del { cursor: pointer; font-size: 16px; line-height: 1; opacity: 0.7; }

    .loading, .empty { text-align: center; padding: 56px 24px; color: var(--ink3); font-size: 14px; }
    .empty b { display: block; font-family: var(--serif); font-size: 18px; color: var(--ink); margin-bottom: 6px; }
    .empty .btn { max-width: 260px; margin: 18px auto 0; }

    #toast { position: fixed; bottom: calc(104px + env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%); background: var(--ink); color: var(--bg); padding: 10px 20px; border-radius: 999px; font-size: 14px; font-weight: 500; z-index: 999; opacity: 0; transition: opacity 0.25s; pointer-events: none; white-space: nowrap; }
    #toast.show { opacity: 1; }
    @media (prefers-reduced-motion: reduce) { #toast { transition: none; } }
  </style>
</head>
<body>
<div id="app"><div class="loading">載入中…</div></div>
<div id="toast"></div>

<script>
const API = 'https://script.google.com/macros/s/AKfycbyKrS_BEKBj7Y2ZGq6iz4996VXMAApjxsNwaHFysmmjzsDjWi_L8p7O4LwM-8yJP_w-FQ/exec';
const SLOTS = 4;
const WD = ['日','一','二','三','四','五','六'];

const state = {
  screen: 'session',
  items: [],
  locations: [],
  loaded: false,
  viewDate: '',
  stall: null,
  stallLoading: false,
  records: null,
  recLoading: false,
  recRange: '90',
  recCustom: { start: '', end: '' },
  recLoc: '',
  recView: 'sessions',
  editItemOriginal: null
};

/* ---- Utility ---- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function pad(n) { return String(n).padStart(2, '0'); }
function fmt8(d) { return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`; }
function parse8(s) { return new Date(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8), 12); }
function todayStr() { return fmt8(new Date()); }
function addDays(s, n) { const d = parse8(s); d.setDate(d.getDate() + n); return fmt8(d); }
function dash(s) { return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`; }
function fmtLong(s) { return `${+s.slice(4,6)}月${+s.slice(6,8)}日 週${WD[parse8(s).getDay()]}`; }
function fmtShort(s) { return `${+s.slice(4,6)}/${+s.slice(6,8)}`; }
function fmtShortY(s) { return (s.slice(0,4) === String(new Date().getFullYear()) ? '' : s.slice(2,4) + '/') + fmtShort(s); }
function money(n) { return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString(); }
function parseNonNegInt(str) { const s = String(str ?? '').trim(); if (!/^\d+$/.test(s)) return null; return parseInt(s, 10); }
const isFormScreen = () => ['open-stall', 'close-stall', 'topup', 'edit-item', 'add-location'].includes(state.screen);

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---- API ---- */
async function apiGet(action, params = {}) {
  const qs = Object.entries({ action, ...params }).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const res = await fetch(`${API}?${qs}`);
  return res.json();
}
async function apiPost(data) {
  const res = await fetch(API, { method: 'POST', body: JSON.stringify(data) });
  return res.json();
}

/* ---- Load ---- */
async function loadAll() {
  state.viewDate = todayStr();
  try {
    const init = await apiGet('getInit', { date: state.viewDate });
    if (init && init.items) {
      state.items = init.items;
      state.locations = init.locations || [];
      state.stall = init.stall || { found: false };
    } else {
      const [itemsRes, locsRes, stallRes] = await Promise.all([
        apiGet('getItems'),
        apiGet('getLocations'),
        apiGet('getStallData', { date: state.viewDate })
      ]);
      state.items = itemsRes.items || [];
      state.locations = locsRes.locations || [];
      state.stall = stallRes;
    }
  } catch(e) {
    state.stall = { found: false, error: true };
    toast('載入失敗，請重試');
  }
  state.loaded = true;
  render();
}

async function loadStall() {
  const date = state.viewDate;
  state.stall = null;
  state.stallLoading = true;
  render();
  try {
    const res = await apiGet('getStallData', { date });
    if (state.viewDate !== date) return;
    state.stall = res;
  } catch(e) {
    if (state.viewDate !== date) return;
    state.stall = { found: false, error: true };
    toast('載入失敗');
  }
  state.stallLoading = false;
  if (!isFormScreen()) render();
}

async function refreshStall() {
  try { state.stall = await apiGet('getStallData', { date: state.viewDate }); } catch(e) {}
  state.records = null;
}

/* ---- Navigation ---- */
function go(screen) {
  state.screen = screen;
  window.scrollTo(0, 0);
  if (screen === 'records' && state.records === null && !state.recLoading) { loadRecords(); return; }
  render();
}

function setViewDate(d8) {
  if (!d8 || d8 === state.viewDate) return;
  state.viewDate = d8;
  loadStall();
}
function shiftDate(n) { setViewDate(addDays(state.viewDate, n)); }
function pickDate(v) { if (v) setViewDate(v.replace(/-/g, '')); }
function openSession(d8) { state.screen = 'session'; window.scrollTo(0, 0); state.viewDate = d8; loadStall(); }

function render() {
  const app = document.getElementById('app');
  if (!state.loaded) { app.innerHTML = '<div class="loading">載入中…</div>'; return; }
  const views = {
    'session': renderSession, 'open-stall': renderOpenStall, 'close-stall': renderCloseStall, 'topup': renderTopup,
    'records': renderRecords, 'settings': renderSettings, 'edit-item': renderEditItem, 'add-location': renderAddLocation
  };
  app.innerHTML = views[state.screen]() + renderNavbar();
  attachHandlers();
}

const BACK = `<svg width="10" height="16" viewBox="0 0 10 16" fill="none"><path d="M8 2L2 8l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function renderNavbar() {
  const tabs = [
    { id: 'session', label: '一日狀態', icon: '<path d="M5 8h13v5a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6V8z"/><path d="M18 9h1.5a2.5 2.5 0 0 1 0 5H18"/><path d="M9 3v2M13 3v2"/>' },
    { id: 'records', label: '紀錄', icon: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>' },
    { id: 'settings', label: '設定', icon: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>' }
  ];
  const active = ['session','open-stall','close-stall','topup'].includes(state.screen) ? 'session'
               : state.screen === 'records' ? 'records' : 'settings';
  return `<nav class="nav">${tabs.map(t => `
    <div class="nav-tab ${active===t.id?'active':''}" onclick="go('${t.id}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${t.icon}</svg>
      <span>${t.label}</span>
    </div>`).join('')}</nav>`;
}

function calc(items) {
  let revenue = 0, wasteCost = 0, prepared = 0, waste = 0, cost = 0;
  items.forEach(it => {
    if (it.waste !== null && it.waste !== undefined) {
      revenue   += (it.prepared - it.waste) * it.price;
      wasteCost += it.waste * it.cost;
      cost      += it.prepared * it.cost;
      prepared  += it.prepared;
      waste     += it.waste;
    }
  });
  return { revenue, wasteCost, prepared, waste, sold: prepared - waste, profit: revenue - cost };
}

/* ============================================================
   SESSION (場次)
   ============================================================ */
function renderSession() {
  const d = state.viewDate;
  const isToday = d === todayStr();
  const header = `
  <div class="header">
    <div class="datenav">
      <button class="icon-btn" onclick="shiftDate(-1)" aria-label="前一天">${BACK}</button>
      <label class="datepick">
        <span class="dp-main"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>${fmtLong(d)}</span>
        <span class="dp-sub">${d.slice(0,4)}${isToday ? ' · 今天' : ''} · 點此選日期</span>
        <input type="date" value="${dash(d)}" onchange="pickDate(this.value)" onclick="try{this.showPicker()}catch(e){}" aria-label="選擇日期">
      </label>
      <button class="icon-btn" onclick="shiftDate(1)" aria-label="後一天" style="transform:scaleX(-1)">${BACK}</button>
    </div>
    ${isToday ? '' : '<button class="today-link" onclick="setViewDate(todayStr())">回到今天</button>'}
  </div>`;

  const s = state.stall;
  if (state.stallLoading || !s) return header + '<div class="loading">載入中…</div>';

  if (s.error) {
    return header + `<div class="empty"><b>載入失敗</b>請檢查網路後再試<button class="btn btn-secondary" onclick="loadStall()">重新載入</button></div>`;
  }

  if (!s.found) {
    const canOpen = state.items.length > 0 && state.locations.length > 0;
    return header + `
    <div class="empty">
      <b>${isToday ? '今天還沒有出攤紀錄' : '這天沒有出攤紀錄'}</b>
      ${canOpen ? (isToday ? '開攤後填入備貨杯數' : '有出攤的話，可以補登這天的資料') : '請先到設定新增品項與地點'}
      ${canOpen
        ? `<button class="btn btn-primary" onclick="go('open-stall')">${isToday ? '開攤' : '補登這一天'}</button>`
        : `<button class="btn btn-secondary" onclick="go('settings')">前往設定</button>`}
    </div>`;
  }

  const list = `
  <div class="section">
    <div class="section-label">品項明細</div>
    <div class="card">
      <div class="irow ihead"><span>品項</span><span>備貨</span><span>賣出</span><span>剩餘</span></div>
      ${s.items.map(it => {
        const has = it.waste !== null;
        const sold = has ? it.prepared - it.waste : null;
        const sub = [it.sweetness, it.extra > 0 ? `追加 ${it.extra}` : '', has ? money(sold * it.price) : ''].filter(Boolean).join(' · ');
        return `<div class="irow">
          <div class="iname">${esc(it.name)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>
          <span class="n">${it.prepared}</span>
          <span class="n strong">${has ? sold : '—'}</span>
          <span class="n ${has && it.waste > 0 ? 'waste' : ''}">${has ? it.waste : '—'}</span>
        </div>`;
      }).join('')}
    </div>
  </div>`;

  if (s.status === '開攤中') {
    const prepared = s.items.reduce((a, i) => a + i.prepared, 0);
    const maxRev = s.items.reduce((a, i) => a + i.prepared * i.price, 0);
    const extraTotal = s.items.reduce((a, i) => a + (i.extra || 0), 0);
    return header + `
    <div class="hero">
      <div class="hero-label">${esc(s.location)}</div>
      <div class="hero-title">備貨 ${prepared} 杯</div>
      <div class="hero-sub">${extraTotal > 0 ? `含追加 ${extraTotal} 杯 · ` : ''}全部賣完可達 ${money(maxRev)}</div>
      <span class="pill">開攤中 · 待填剩餘杯數</span>
    </div>
    ${list}
    <div class="section">
      <button class="btn btn-primary" onclick="go('close-stall')">填寫收攤剩餘</button>
      <button class="btn btn-secondary" onclick="go('topup')">追加補貨</button>
      <button class="btn btn-secondary" onclick="go('open-stall')">修改開攤資料</button>
    </div>`;
  }

  const c = calc(s.items);
  const extraTotal = s.items.reduce((a, i) => a + (i.extra || 0), 0);
  return header + `
  <div class="hero">
    <div class="hero-label">${esc(s.location)} · 營業額</div>
    <div class="hero-title">${money(c.revenue)}</div>
    <div class="hero-sub">賣出 ${c.sold} 杯 · 備貨 ${c.prepared} 杯${extraTotal > 0 ? `（含追加 ${extraTotal}）` : ''} · 剩餘 ${c.waste} 杯</div>
  </div>
  <div class="stat-grid">
    <div class="stat">
      <div class="stat-label">報廢成本</div>
      <div class="stat-value bad">${money(c.wasteCost)}</div>
      <div class="stat-sub">剩餘 ${c.waste} 杯</div>
    </div>
    <div class="stat">
      <div class="stat-label">毛利</div>
      <div class="stat-value ${c.profit >= 0 ? 'good' : 'bad'}">${money(c.profit)}</div>
      <div class="stat-sub">營業額 − 備貨成本</div>
    </div>
  </div>
  ${list}
  <div class="section">
    <button class="btn btn-secondary" onclick="go('close-stall')">修改剩餘杯數</button>
    <button class="btn btn-secondary" onclick="go('open-stall')">修改開攤／備貨資料</button>
  </div>`;
}

/* ============================================================
   OPEN STALL (開攤表單)
   ============================================================ */
function renderOpenStall() {
  const s = state.stall;
  const existing = s && s.found ? s : null;
  const d = state.viewDate;

  const locationOptions = state.locations.map(l =>
    `<option value="${esc(l)}" ${existing && existing.location === l ? 'selected' : ''}>${esc(l)}</option>`).join('');

  const slots = Array.from({length: SLOTS}, (_, i) => {
    const ex = existing && existing.items[i];
    const selItem = ex && state.items.find(it => it.name === ex.name);
    const showSweet = !!(selItem && selItem.sweetnesses.length > 0);
    const sweetOptions = showSweet
      ? selItem.sweetnesses.map(sw => `<option value="${esc(sw)}" ${sw === ex.sweetness ? 'selected' : ''}>${esc(sw)}</option>`).join('') : '';
    return `
    <div class="slot">
      <div class="slot-title">品項 ${i+1}</div>
      <div class="slot-grid g3">
        <div class="full">
          <select id="item_${i}" onchange="onItemSelect(${i})">
            <option value="">— 不使用 —</option>
            ${state.items.map(it => `<option value="${esc(it.name)}" ${ex && it.name === ex.name ? 'selected' : ''}>${esc(it.name)}</option>`).join('')}
          </select>
        </div>
        <div class="full" id="sweet_wrap_${i}" style="${showSweet ? '' : 'display:none'}">
          <label>甜度</label>
          <select id="sweet_${i}">${sweetOptions}</select>
        </div>
        <div>
          <label>備貨（杯）</label>
          <input type="text" inputmode="numeric" id="qty_${i}" value="${ex ? ex.prepared - (ex.extra || 0) : ''}" placeholder="0">
        </div>
        <div>
          <label>追加（杯）</label>
          <input type="text" inputmode="numeric" id="ext_${i}" value="${ex && ex.extra > 0 ? ex.extra : ''}" placeholder="0">
        </div>
        <div>
          <label>剩餘（杯）</label>
          <input type="text" inputmode="numeric" id="rem_${i}" value="${ex && ex.waste !== null && ex.waste !== undefined ? ex.waste : ''}" placeholder="選填">
        </div>
      </div>
    </div>`;
  }).join('');

  return `
  <div class="header">
    <div class="header-row">
      <span class="back-btn" onclick="go('session')">${BACK} 返回</span>
      <h1>${existing ? '修改開攤' : '開攤'}</h1>
      <span style="min-width:56px"></span>
    </div>
    <div class="header-sub">${fmtLong(d)}</div>
  </div>
  <div class="section">
    <div class="section-label">出攤地點</div>
    <div class="card" style="padding:12px 14px">
      ${state.locations.length > 0
        ? `<select id="location">${locationOptions}</select>`
        : '<div style="color:var(--waste)">請先在設定中新增地點</div>'}
    </div>
  </div>
  <div class="section">
    <div class="section-label">品項與備貨量（最多 ${SLOTS} 項）</div>
    <div class="hint">${existing && existing.status === '已收攤' ? '剩餘杯數已填寫；全部清空會讓這個場次回到「開攤中」。追加杯數可在這裡修正。' : '備貨是開攤時帶的杯數，追加是當天中途補貨的總杯數（選填）。已經收攤的話，剩餘杯數可以一起填完；全部留空則只記錄開攤。'}</div>
    ${slots}
    <button class="btn btn-primary" id="submitOpen" onclick="submitOpenStall(this)">${existing ? '儲存' : '確認開攤'}</button>
  </div>`;
}

function onItemSelect(idx) {
  const item = state.items.find(i => i.name === document.getElementById(`item_${idx}`).value);
  const wrap = document.getElementById(`sweet_wrap_${idx}`);
  const sel = document.getElementById(`sweet_${idx}`);
  if (item && item.sweetnesses.length > 0) {
    wrap.style.display = '';
    sel.innerHTML = item.sweetnesses.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  } else {
    wrap.style.display = 'none';
    sel.innerHTML = '';
  }
}

async function submitOpenStall(btn) {
  const locEl = document.getElementById('location');
  const location = locEl ? locEl.value : '';
  if (!location) { toast('請選擇地點'); return; }

  const items = [];
  let remCount = 0;
  for (let i = 0; i < SLOTS; i++) {
    const name = document.getElementById(`item_${i}`).value;
    if (!name) continue;
    const wrap = document.getElementById(`sweet_wrap_${i}`);
    const sweetness = wrap.style.display !== 'none' ? document.getElementById(`sweet_${i}`).value : '';
    const qtyRaw = document.getElementById(`qty_${i}`).value.trim();
    if (qtyRaw === '') { toast(`請填寫「${name}」的備貨量`); return; }
    const prepared = parseNonNegInt(qtyRaw);
    if (prepared === null) { toast(`「${name}」備貨量請輸入 0 以上的整數`); return; }
    if (prepared === 0) { toast(`「${name}」備貨量需大於 0`); return; }
    if (items.some(it => it.name === name)) { toast(`「${name}」重複選取`); return; }
    const extRaw = document.getElementById(`ext_${i}`).value.trim();
    let extra = 0;
    if (extRaw !== '') {
      extra = parseNonNegInt(extRaw);
      if (extra === null) { toast(`「${name}」追加杯數請輸入 0 以上的整數`); return; }
    }
    const item = { name, sweetness, prepared, extra };
    const remRaw = document.getElementById(`rem_${i}`).value.trim();
    if (remRaw !== '') {
      const rem = parseNonNegInt(remRaw);
      if (rem === null) { toast(`「${name}」剩餘杯數請輸入 0 以上的整數`); return; }
      if (rem > prepared + extra) { toast(`「${name}」剩餘杯數需介於 0 到備貨量`); return; }
      item.waste = rem;
      remCount++;
    }
    items.push(item);
  }
  if (items.length === 0) { toast('請至少填寫一項品項'); return; }
  if (remCount > 0 && remCount !== items.length) { toast('剩餘杯數請全部填寫，或全部留空'); return; }
  if (remCount === 0 && state.stall && state.stall.found && state.stall.status === '已收攤' &&
      !confirm('清空剩餘杯數會讓這個場次回到「開攤中」，確定嗎？')) return;

  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = '處理中…';
  try {
    const res = await apiPost({ action: 'openStall', date: state.viewDate, location, items });
    if (res.ok) {
      await refreshStall();
      toast(remCount > 0 ? '已記錄完整場次' : '已儲存');
      go('session');
      return;
    }
    toast(res.error || '操作失敗');
  } catch(e) { toast('網路錯誤，請重試'); }
  btn.disabled = false;
  btn.textContent = label;
}

/* ============================================================
   TOPUP (追加補貨)
   ============================================================ */
function renderTopup() {
  const s = state.stall;
  if (!s || !s.found || s.status !== '開攤中') {
    return `<div class="header"><h1>追加補貨</h1></div><div class="empty"><b>沒有開攤中的場次</b>已收攤的場次，請到「修改開攤／備貨資料」調整追加杯數<button class="btn btn-secondary" onclick="go('session')">返回一日狀態</button></div>`;
  }
  const rows = s.items.map((it, i) => `
    <div class="slot">
      <div class="slot-title">
        <span>${esc(it.name)}${it.sweetness ? ` · ${esc(it.sweetness)}` : ''}</span>
        <em>目前備貨 ${it.prepared} 杯${it.extra > 0 ? `（已追加 ${it.extra}）` : ''}</em>
      </div>
      <div class="slot-grid">
        <div>
          <label>本次追加（杯）</label>
          <input type="text" inputmode="numeric" id="add_${i}" placeholder="0" oninput="updateTopup()">
        </div>
        <div>
          <label>追加後備貨</label>
          <div id="after_${i}" class="preview idle">${it.prepared} 杯</div>
        </div>
      </div>
    </div>`).join('');

  return `
  <div class="header">
    <div class="header-row">
      <span class="back-btn" onclick="go('session')">${BACK} 返回</span>
      <h1>追加補貨</h1>
      <span style="min-width:56px"></span>
    </div>
    <div class="header-sub">${fmtLong(state.viewDate)} · ${esc(s.location)}</div>
  </div>
  <div class="section">
    <div class="section-label">只填有補貨的品項，其他留空</div>
    ${rows}
    <button class="btn btn-primary" id="submitTopup" onclick="submitTopup(this)">確認追加</button>
  </div>`;
}

function updateTopup() {
  state.stall.items.forEach((it, i) => {
    const raw = document.getElementById(`add_${i}`).value.trim();
    const el = document.getElementById(`after_${i}`);
    el.classList.remove('over', 'idle');
    const v = raw === '' ? 0 : parseNonNegInt(raw);
    if (v === null) { el.textContent = '數字有誤'; el.classList.add('over'); return; }
    if (v === 0) { el.textContent = `${it.prepared} 杯`; el.classList.add('idle'); return; }
    el.textContent = `${it.prepared + v} 杯（+${v}）`;
  });
}

async function submitTopup(btn) {
  const s = state.stall;
  const items = [];
  let total = 0;
  for (let i = 0; i < s.items.length; i++) {
    const raw = document.getElementById(`add_${i}`).value.trim();
    if (raw === '') continue;
    const add = parseNonNegInt(raw);
    if (add === null) { toast(`「${s.items[i].name}」追加杯數請輸入 0 以上的整數`); return; }
    if (add === 0) continue;
    items.push({ name: s.items[i].name, add });
    total += add;
  }
  if (items.length === 0) { toast('請至少填寫一項追加杯數'); return; }

  btn.disabled = true;
  btn.textContent = '處理中…';
  try {
    const res = await apiPost({ action: 'addStock', date: state.viewDate, items });
    if (res.ok) {
      await refreshStall();
      toast(`已追加 ${total} 杯`);
      go('session');
      return;
    }
    toast(res.error || '操作失敗');
  } catch(e) { toast('網路錯誤，請重試'); }
  btn.disabled = false;
  btn.textContent = '確認追加';
}

/* ============================================================
   CLOSE STALL (收攤表單：填剩餘杯數)
   ============================================================ */
function renderCloseStall() {
  const s = state.stall;
  if (!s || !s.found) {
    return `<div class="header"><h1>收攤</h1></div><div class="empty"><b>沒有可收攤的紀錄</b><button class="btn btn-secondary" onclick="go('session')">返回場次</button></div>`;
  }

  const rows = s.items.map((it, i) => `
    <div class="slot">
      <div class="slot-title">
        <span>${esc(it.name)}${it.sweetness ? ` · ${esc(it.sweetness)}` : ''}</span>
        <em>備貨 ${it.prepared} 杯${it.extra > 0 ? `（含追加 ${it.extra}）` : ''}</em>
      </div>
      <div class="slot-grid">
        <div>
          <label>剩餘杯數（即報廢）</label>
          <input type="text" inputmode="numeric" id="waste_${i}" placeholder="0"
            value="${it.waste !== null ? it.waste : ''}" oninput="updateClose()">
        </div>
        <div>
          <label>賣出</label>
          <div id="preview_${i}" class="preview"></div>
        </div>
      </div>
    </div>`).join('');

  return `
  <div class="header">
    <div class="header-row">
      <span class="back-btn" onclick="go('session')">${BACK} 返回</span>
      <h1>收攤</h1>
      <span style="min-width:56px"></span>
    </div>
    <div class="header-sub">${fmtLong(state.viewDate)} · ${esc(s.location)}</div>
  </div>
  <div class="stat-grid" style="margin-top:6px">
    <div class="stat"><div class="stat-label">預估營業額</div><div class="stat-value good" id="tot_rev">$0</div></div>
    <div class="stat"><div class="stat-label">賣出杯數</div><div class="stat-value" id="tot_sold">0</div></div>
  </div>
  <div class="section">
    <div class="section-label">數一數剩下幾杯，直接填入；賣完填 0</div>
    ${rows}
    <button class="btn btn-primary" id="submitClose" onclick="submitCloseStall(this)">確認收攤</button>
  </div>`;
}

function updateClose() {
  const s = state.stall;
  let rev = 0, sold = 0;
  s.items.forEach((it, i) => {
    const raw = document.getElementById(`waste_${i}`).value.trim();
    const el = document.getElementById(`preview_${i}`);
    el.classList.remove('over', 'idle');
    if (raw === '') { el.textContent = '待輸入'; el.classList.add('idle'); return; }
    const w = parseNonNegInt(raw);
    if (w === null) { el.textContent = '數字有誤'; el.classList.add('over'); return; }
    if (w > it.prepared) { el.textContent = '超過備貨'; el.classList.add('over'); return; }
    const sd = it.prepared - w;
    el.textContent = `${sd} 杯 · ${money(sd * it.price)}`;
    rev += sd * it.price;
    sold += sd;
  });
  document.getElementById('tot_rev').textContent = money(rev);
  document.getElementById('tot_sold').textContent = sold;
}

async function submitCloseStall(btn) {
  const s = state.stall;
  const items = [];
  for (let i = 0; i < s.items.length; i++) {
    const it = s.items[i];
    const raw = document.getElementById(`waste_${i}`).value.trim();
    if (raw === '') { toast(`請填寫「${it.name}」的剩餘杯數（賣完請填 0）`); return; }
    const waste = parseNonNegInt(raw);
    if (waste === null) { toast(`「${it.name}」請輸入 0 以上的整數`); return; }
    if (waste > it.prepared) { toast(`「${it.name}」剩餘不能超過備貨量`); return; }
    items.push({ name: it.name, waste });
  }
  btn.disabled = true;
  btn.textContent = '處理中…';
  try {
    const res = await apiPost({ action: 'closeStall', date: state.viewDate, items });
    if (res.ok) {
      await refreshStall();
      toast('已儲存');
      go('session');
      return;
    }
    toast(res.error || '操作失敗');
  } catch(e) { toast('網路錯誤，請重試'); }
  btn.disabled = false;
  btn.textContent = '確認收攤';
}

/* ============================================================
   RECORDS (紀錄)
   ============================================================ */
function recRange() {
  const t = todayStr();
  if (state.recRange === '30') return { start: addDays(t, -30), end: '' };
  if (state.recRange === '90') return { start: addDays(t, -90), end: '' };
  if (state.recRange === 'custom') return { start: state.recCustom.start.replace(/-/g, ''), end: state.recCustom.end.replace(/-/g, '') };
  return { start: '', end: '' };
}

async function loadRecords() {
  state.recLoading = true;
  render();
  try {
    const { start, end } = recRange();
    const res = await apiGet('getHistory', { startDate: start, endDate: end });
    state.records = res.records || [];
  } catch(e) {
    state.records = [];
    toast('載入失敗');
  }
  state.recLoading = false;
  if (!isFormScreen()) render();
}

function setRange(r) { state.recRange = r; if (r === 'custom') { render(); return; } loadRecords(); }
function setCustom(which, v) { state.recCustom[which] = v; loadRecords(); }
function setLoc(v) { state.recLoc = v; render(); }
function setRecView(v) { state.recView = v; render(); }

function barChart(sessions) {
  const data = sessions.slice(-16);
  if (data.length === 0) return '';
  const W = 320, H = 150, padX = 10, top = 20, bottom = 24;
  const max = Math.max(...data.map(r => calc(r.items).revenue), 1);
  const slot = (W - padX * 2) / data.length;
  const bw = Math.min(30, slot * 0.62);
  const chartH = H - top - bottom;
  const compact = data.length > 8;
  const bars = data.map((r, i) => {
    const rev = calc(r.items).revenue;
    const h = Math.max(2, rev / max * chartH);
    const x = padX + slot * i + (slot - bw) / 2;
    const y = top + chartH - h;
    const cx = x + bw / 2;
    const val = compact ? (rev >= 1000 ? (rev / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : rev) : rev.toLocaleString();
    const showDate = data.length <= 10 || i % 2 === (data.length - 1) % 2;
    return `<rect class="bar ${i === data.length - 1 ? 'latest' : ''}" x="${x}" y="${y}" width="${bw}" height="${h}" rx="3"/>
      <text class="chart-txt" x="${cx}" y="${y - 4}" text-anchor="middle">${val}</text>
      ${showDate ? `<text class="chart-txt" x="${cx}" y="${H - 8}" text-anchor="middle">${fmtShortY(r.date)}</text>` : ''}`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每場營業額長條圖">
    <line class="chart-base" x1="${padX}" x2="${W - padX}" y1="${top + chartH}" y2="${top + chartH}"/>${bars}</svg>`;
}

function renderRecords() {
  const header = `<div class="header"><h1>紀錄</h1></div>`;
  const ranges = [['30','近 30 天'],['90','近 90 天'],['all','全部'],['custom','自訂']];
  const all = state.records || [];
  const locs = [...new Set([...state.locations, ...all.map(r => r.location)])].filter(Boolean);

  const filter = `
  <div class="section" style="margin-top:4px">
    <div class="chips">${ranges.map(([v, l]) => `<button class="chip ${state.recRange === v ? 'on' : ''}" onclick="setRange('${v}')">${l}</button>`).join('')}</div>
    ${state.recRange === 'custom' ? `
    <div class="filter-dates">
      <input type="date" value="${esc(state.recCustom.start)}" onchange="setCustom('start', this.value)">
      <span>至</span>
      <input type="date" value="${esc(state.recCustom.end)}" onchange="setCustom('end', this.value)">
    </div>` : ''}
    <div style="margin-top:10px">
      <select onchange="setLoc(this.value)" aria-label="地點篩選">
        <option value="">全部地點</option>
        ${locs.map(l => `<option value="${esc(l)}" ${state.recLoc === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}
      </select>
    </div>
  </div>`;

  if (state.recLoading || state.records === null) return header + filter + '<div class="loading">載入中…</div>';

  const recs = all.filter(r => !state.recLoc || r.location === state.recLoc);
  if (recs.length === 0) return header + filter + '<div class="empty"><b>這個條件下沒有出攤紀錄</b>換個日期區間或地點看看</div>';

  const closed = recs.filter(r => r.status === '已收攤');
  const agg = closed.reduce((a, r) => {
    const c = calc(r.items);
    a.revenue += c.revenue; a.wasteCost += c.wasteCost; return a;
  }, { revenue: 0, wasteCost: 0 });
  const asc = [...closed].sort((a, b) => a.date.localeCompare(b.date));

  const summary = `
  <div class="section">
    <div class="card totals">
      <div><div class="stat-label">營業額</div><div class="stat-value good">${money(agg.revenue)}</div></div>
      <div><div class="stat-label">報廢成本</div><div class="stat-value bad">${money(agg.wasteCost)}</div></div>
      <div><div class="stat-label">出攤場次</div><div class="stat-value">${recs.length}</div></div>
    </div>
  </div>
  ${asc.length > 0 ? `<div class="section"><div class="card chart-card"><div class="chart-title">每場營業額${asc.length > 16 ? '（最近 16 場）' : ''}</div>${barChart(asc)}</div></div>` : ''}
  <div class="section">
    <div class="seg">
      <button class="${state.recView === 'sessions' ? 'on' : ''}" onclick="setRecView('sessions')">各場次</button>
      <button class="${state.recView === 'items' ? 'on' : ''}" onclick="setRecView('items')">品項配貨</button>
    </div>
  </div>`;

  return header + filter + summary + (state.recView === 'sessions' ? renderSessionList(recs) : renderItemList(recs));
}

function renderSessionList(recs) {
  return `<div class="section"><div class="card">${recs.map(r => {
    const c = calc(r.items);
    const done = r.status === '已收攤';
    const prepared = r.items.reduce((a, i) => a + i.prepared, 0);
    return `<div class="srow" onclick="openSession('${r.date}')">
      <div class="srow-main">
        <div class="srow-date">${fmtShortY(r.date)} 週${WD[parse8(r.date).getDay()]}</div>
        <div class="srow-meta">${esc(r.location)} · ${done ? `賣 ${c.sold} / 備 ${c.prepared} 杯` : `備貨 ${prepared} 杯`}</div>
      </div>
      ${done
        ? `<div class="srow-money">${money(c.revenue)}<small>報廢 ${money(c.wasteCost)}</small></div>`
        : '<span class="tag-open">開攤中</span>'}
    </div>`;
  }).join('')}</div></div>`;
}

function renderItemList(recs) {
  const map = {};
  recs.forEach(r => r.items.forEach(it => {
    (map[it.name] = map[it.name] || []).push({ date: r.date, location: r.location, ...it });
  }));
  const names = Object.keys(map).sort((a, b) => map[b].length - map[a].length);
  return `<div class="section">${names.map(name => {
    const rows = map[name].sort((a, b) => b.date.localeCompare(a.date));
    return `<div class="card" style="margin-bottom:10px">
      <div class="pcard-head"><b>${esc(name)}</b><span>出攤 ${rows.length} 次</span></div>
      <div class="prow ihead" style="padding:8px 16px"><span>場次</span><span class="n">備貨</span><span class="n">賣出</span><span class="n">剩餘</span></div>
      ${rows.map(r => {
        const has = r.waste !== null;
        const sub = [esc(r.location), r.sweetness ? esc(r.sweetness) : '', r.extra > 0 ? `追加 ${r.extra}` : ''].filter(Boolean).join(' · ');
        return `<div class="prow">
          <div>${fmtShortY(r.date)}<small>${sub}</small></div>
          <span class="n">${r.prepared}</span>
          <span class="n strong">${has ? r.prepared - r.waste : '—'}</span>
          <span class="n ${has && r.waste > 0 ? 'waste' : ''}">${has ? r.waste : '—'}</span>
        </div>`;
      }).join('')}
    </div>`;
  }).join('')}</div>`;
}

/* ============================================================
   SETTINGS
   ============================================================ */
function renderSettings() {
  const itemRows = state.items.map((it, i) => `
    <div class="settings-item">
      <div class="settings-item-info">
        <div class="settings-item-name">${esc(it.name)}</div>
        <div class="settings-item-sub">售 ${money(it.price)} · 成本 ${money(it.cost)}${it.sweetnesses.length > 0 ? ` · ${esc(it.sweetnesses.join('、'))}` : ''}</div>
      </div>
      <div class="settings-item-actions">
        <button class="btn btn-secondary btn-sm" onclick="editItem(${i})">編輯</button>
        <button class="btn btn-danger btn-sm" onclick="confirmDeleteItem(${i})">刪除</button>
      </div>
    </div>`).join('');

  const locRows = state.locations.map((loc, i) => `
    <div class="settings-item">
      <div class="settings-item-info"><div class="settings-item-name">${esc(loc)}</div></div>
      <div class="settings-item-actions">
        <button class="btn btn-danger btn-sm" onclick="confirmDeleteLocation(${i})">刪除</button>
      </div>
    </div>`).join('');

  return `
  <div class="header"><h1>設定</h1></div>
  <div class="section">
    <div class="section-label">品項</div>
    <div class="card">${itemRows || '<div class="empty" style="padding:24px">尚無品項</div>'}</div>
    <button class="btn btn-primary" onclick="newItem()">新增品項</button>
  </div>
  <div class="section">
    <div class="section-label">地點</div>
    <div class="card">${locRows || '<div class="empty" style="padding:24px">尚無地點</div>'}</div>
    <button class="btn btn-primary" onclick="go('add-location')">新增地點</button>
  </div>`;
}

function renderEditItem() {
  const orig = state.editItemOriginal;
  const item = orig ? state.items.find(i => i.name === orig) : null;
  window._editSweets = window._editSweets || [];

  return `
  <div class="header">
    <div class="header-row">
      <span class="back-btn" onclick="go('settings')">${BACK} 返回</span>
      <h1>${item ? '編輯品項' : '新增品項'}</h1>
      <span style="min-width:56px"></span>
    </div>
  </div>
  <div class="section">
    <div class="card" style="padding:16px">
      <div class="form-label">品項名稱</div>
      <input type="text" id="item_name" value="${esc(item ? item.name : '')}" placeholder="例：仙草奶茶">
      <div class="form-label">售價（元）</div>
      <input type="text" inputmode="numeric" id="item_price" value="${item ? item.price : ''}" placeholder="例：55">
      <div class="form-label">成本價（元）</div>
      <input type="text" inputmode="numeric" id="item_cost" value="${item ? item.cost : ''}" placeholder="例：20">
      <div class="form-label">甜度選項（選填）</div>
      <div id="sweet_tags" class="tags" style="min-height:32px">${sweetTagsHtml()}</div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <input type="text" id="sweet_input" placeholder="輸入甜度名稱" style="flex:1">
        <button class="btn btn-secondary btn-sm" style="flex-shrink:0" onclick="addSweet()">加入</button>
      </div>
    </div>
    <button class="btn btn-primary" id="saveItemBtn" onclick="saveItemAction(this)">儲存品項</button>
  </div>`;
}

function sweetTagsHtml() {
  return window._editSweets.map((s, i) =>
    `<div class="tag">${esc(s)}<span class="tag-del" onclick="removeSweet(${i})">×</span></div>`).join('');
}
function addSweet() {
  const inp = document.getElementById('sweet_input');
  const val = inp.value.replace(/[,，]/g, '').trim();
  if (!val) return;
  if (window._editSweets.includes(val)) { toast('已存在'); return; }
  window._editSweets.push(val);
  inp.value = '';
  document.getElementById('sweet_tags').innerHTML = sweetTagsHtml();
}
function removeSweet(i) {
  window._editSweets.splice(i, 1);
  document.getElementById('sweet_tags').innerHTML = sweetTagsHtml();
}

async function saveItemAction(btn) {
  const name  = document.getElementById('item_name').value.trim();
  const price = parseFloat(document.getElementById('item_price').value) || 0;
  const cost  = parseFloat(document.getElementById('item_cost').value) || 0;
  if (!name) { toast('請輸入品項名稱'); return; }
  if (name !== state.editItemOriginal && state.items.some(i => i.name === name)) { toast('已有同名品項'); return; }
  btn.disabled = true;
  btn.textContent = '儲存中…';
  try {
    const res = await apiPost({ action: 'saveItem', originalName: state.editItemOriginal || name, name, price, cost, sweetnesses: window._editSweets || [] });
    if (res.ok) {
      state.items = (await apiGet('getItems')).items || [];
      state.records = null;
      toast('已儲存');
      go('settings');
      return;
    }
    toast(res.error || '儲存失敗');
  } catch(e) { toast('網路錯誤'); }
  btn.disabled = false;
  btn.textContent = '儲存品項';
}

function editItem(i) { state.editItemOriginal = state.items[i].name; window._editSweets = [...state.items[i].sweetnesses]; go('edit-item'); }
function newItem() { state.editItemOriginal = null; window._editSweets = []; go('edit-item'); }

async function confirmDeleteItem(i) {
  const name = state.items[i].name;
  if (!confirm(`確定從設定中刪除「${name}」？（過去已出攤的歷史紀錄與金額會完整保留）`)) return;
  try {
    const res = await apiPost({ action: 'deleteItem', name });
    if (res.ok) {
      state.items = (await apiGet('getItems')).items || [];
      toast('已刪除');
      if (!isFormScreen()) render();
    } else { toast(res.error || '刪除失敗'); }
  } catch(e) { toast('網路錯誤'); }
}

function renderAddLocation() {
  return `
  <div class="header">
    <div class="header-row">
      <span class="back-btn" onclick="go('settings')">${BACK} 返回</span>
      <h1>新增地點</h1>
      <span style="min-width:56px"></span>
    </div>
  </div>
  <div class="section">
    <div class="card" style="padding:16px">
      <div class="form-label">地點名稱</div>
      <input type="text" id="loc_name" placeholder="例：台中中友百貨">
    </div>
    <button class="btn btn-primary" id="saveLocBtn" onclick="saveLocationAction(this)">新增地點</button>
  </div>`;
}

async function saveLocationAction(btn) {
  const name = document.getElementById('loc_name').value.trim();
  if (!name) { toast('請輸入地點名稱'); return; }
  btn.disabled = true;
  btn.textContent = '儲存中…';
  try {
    const res = await apiPost({ action: 'saveLocation', name });
    if (res.ok) {
      state.locations = (await apiGet('getLocations')).locations || [];
      toast('已新增');
      go('settings');
      return;
    }
    toast(res.error || '新增失敗');
  } catch(e) { toast('網路錯誤'); }
  btn.disabled = false;
  btn.textContent = '新增地點';
}

async function confirmDeleteLocation(i) {
  const name = state.locations[i];
  if (!confirm(`確定刪除「${name}」？`)) return;
  try {
    const res = await apiPost({ action: 'deleteLocation', name });
    if (res.ok) {
      state.locations = (await apiGet('getLocations')).locations || [];
      toast('已刪除');
      if (!isFormScreen()) render();
    } else { toast(res.error || '刪除失敗'); }
  } catch(e) { toast('網路錯誤'); }
}

/* ---- Attach handlers ---- */
function attachHandlers() {
  const si = document.getElementById('sweet_input');
  if (si) si.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addSweet(); } });
  if (state.screen === 'close-stall' && state.stall && state.stall.found) updateClose();
}

/* ---- Init ---- */
loadAll();
</script>
</body>
</html>
```

---

## 5. 目前進度與已知問題 (Current Status & Pain Points)

### 已完成並測試通過
測試方式共三層，全程 console 零錯誤：
1. **後端單元測試**（Node `vm` 載入 `gas/程式碼.js`＋假 Sheet，計算 API 呼叫次數）20 項全過（含追加：累加與單次寫入、非正整數／重複／不存在／已收攤皆拒絕且不部分寫入、剩餘上限＝原備貨＋追加、營收／毛利／報廢成本含追加、修改開攤時 `extra` 未帶沿用／帶值覆寫／帶 0 清除、快照與追加同時保留、舊 7／9 欄資料相容）；原 12 項：舊 7 欄資料 fallback、快照寫入與調價／刪品項後歷史不變、單請求補登（全部有 waste→已收攤，部分→忽略並維持開攤中）、修改同日資料沿用快照且新品項取現價、批次刪除（兩段連續區段＝2 次 `deleteRows`、0 次 `deleteRow`）、`closeStall` 單次 `setValues` 與錯誤輸入拒絕、`LockService` 取得／釋放（含錯誤與逾時路徑）、`safeText` 六種開頭、`getInit`、只有 7 欄的表自動補欄、無效 `openStall` 不會清掉既有資料、改名同步／重複擋下／甜度逗號清除。
2. **端到端（前端 ＋ 真實後端程式碼 ＋ 假 Sheet）**：在手機尺寸瀏覽器中載入 `index.html`，`fetch` 導向「執行真實 `gas/程式碼.js` 的假試算表」：啟動只發 1 個 `getInit`；備貨／剩餘的空白、`10abc`、負數、小數、全形數字、0、超過備貨皆被擋；單一 `openStall` 完成補登且快照欄位寫入；調價 55→99 後當日營業額不變；修改已收攤場次的備貨沿用舊快照；清空剩餘需 `confirm` 並回到開攤中；收攤表單即時預覽的「待輸入／數字有誤／超過備貨」；刪除品項後當日歷史金額保留；`loadStall`／`loadRecords` 進行中切到表單並打字，回應完成後輸入不被清掉；`_editSweets` 不被重設；舊版 GAS（`getInit` 回 error）退回 3 請求；離線載入失敗；紀錄頁區間／地點／圖表（前一輪）。
3. **追加功能端到端（前端＋真實後端程式碼＋假 Sheet）**：開攤→追加畫面（空白／亂碼／負數／0 的預覽與送出驗證）→追加 12 再追加 8（累加為 20）→收攤上限為總量→營收／報廢成本／毛利含追加→已收攤時追加畫面與後端皆拒絕→修改表單顯示原備貨／追加／剩餘、不動直接儲存結果不變、修正追加、清除追加→補登一次填完備貨＋追加＋剩餘→紀錄頁顯示「追加 N」→追加畫面輸入中背景載入完成不洗掉輸入。
4. **線上部署驗證**：GAS @46 的 `getInit`、`getHistory`（含 `profit` 與 `extra`）、`getItems` 對真實資料以唯讀 GET 驗證回應正常。

### 尚未驗證／未完成
- **未對真實試算表做寫入測試**（避免污染使用者資料）；所有寫入邏輯僅在假 Sheet 驗證。尤其 `setValues` 寫入以 `'` 開頭的字串在真實 Sheets 是否被當成文字前綴並隱藏（預期如此），以及 `deleteRows`、`insertColumnsAfter` 在真實環境的行為，需實機確認。
- 深色模式（預覽窗固定淺色）、iPhone 日期選擇器 `showPicker()`、實機版面未驗證。
- 無自動化測試入口與 CI（上述測試為一次性腳本，未納入 repo）。
- 品項固定最多 4 個欄位（`SLOTS=4`）。
- **舊資料未回填快照**：已存在的出攤紀錄（H、I 空白）仍以品項設定現價計算；若之後調價或刪除品項，這些舊場次仍會受影響。需要一次性回填函式（把現價寫入 H、I）才能把舊資料也凍結。

### 脆弱點／Workaround／已知問題（剩餘）
1. **後端完全無驗證**（依需求維持現狀）：`ANYONE_ANONYMOUS`＋公開的 `/exec` 網址即可讀寫刪所有資料。
2. **非真正交易**：已加 `LockService` 並先驗證再刪除，但 `openStall` 仍是「刪除舊列→寫入新列」兩步；若執行中途被 GAS 中斷（配額、逾時）仍可能留下缺資料的場次。
3. **以品項名稱為鍵**：`closeStall` 以（日期＋品項名稱）找第一列；同日同品項不同甜度會錯位（`openStall` 後端與前端皆禁止同日重複品項，已規避）。品項改名會同步更新出攤紀錄，但改名與快照無關。
4. **場次無獨立主鍵**：地點取該日第一列、狀態取最後一列；同日只能有一場。
5. **舊資料價格回溯風險**（見上「未回填」）；已有快照的新資料不受影響。
6. **前端表單值不在 state**：已用 `isFormScreen()` 守門避免非同步回應重繪，但仍有其他同步 `render()` 呼叫點（例如刪除後 `render()` 已加守門，其餘多為使用者操作觸發）；結構上仍是「全頁 innerHTML 重繪」，新增非同步路徑時需記得守門。
7. **效能**：每個 GET 仍整表讀取（資料量小無感）；冷啟動 1–2 秒。`getHistory` 每次整表掃描。
8. **日期**：字串 `yyyyMMdd`；前端 `todayStr()` 用裝置時區、GAS `today()` 用 `Asia/Taipei`（前端一律傳 `date`，後端預設值實際不用）。
9. **營業額偏高為設計取捨**：試喝杯數算成賣出。
10. 無 `fetch` timeout／重試；GAS 回應慢時僅顯示「載入中…」。
11. 使用者真實資料中已出現甜度選項存成單一字串 `正常，半糖，無糖`（全形逗號，修正前輸入）；新版 `addSweet` 會去逗號、後端 `saveItem` 也會清除，但已存在的資料需使用者手動編輯修正。
12. **追加功能的限制**：只能對「已在場次內的品項」追加（要新增品項請用「修改開攤／備貨資料」）；每品項只存累計追加杯數（J 欄），沒有每次追加的時間／明細；已收攤場次不能用追加畫面（後端也拒絕），需到修改表單調整；API 的 `prepared` 語意改為「總量」，若手機仍快取舊版前端，在已有追加的場次上修改開攤會把總量當原備貨寫回（重新整理即可避免）。

---

## 6. 待檢核重點清單 (Review Checklist)

1. **`gas/程式碼.js` 的寫入一致性**：審查 `openStall`（驗證→讀舊列取快照→`deleteRowRuns` 批次刪除→`setValues` 附加）與 `closeStall`（讀 A~G→記憶體更新→單次寫 F~G）在鎖內的正確性：`getLastRow()` 在刪除後重新計算是否可靠、`deleteRows` 在「刪除到只剩表頭」時是否安全、中途丟例外時是否可能只刪不寫；是否值得改成「先寫新列再刪舊列」或整日區段原地覆寫。
2. **快照與舊資料相容邏輯**：`rowToItem`/`num`/`hasVal` 對 H、I 欄的各種內容（空字串、`0`、`null`、文字、僅 H 有值）的判斷是否正確；`0` 成本是否會被誤判為「無值」（目前以 `!== ''` 判斷，`0` 視為有值）；舊資料回填的最佳做法（一次性函式 vs 讀取時自動補寫）。
3. **`safeText` 的實機行為與副作用**：以 `'` 前綴寫入後，`getValues()` 讀回是否已去除前綴（否則品項名稱比對、改名、`closeStall` 以名稱找列都會失敗）；日期欄 A 目前仍以字串寫入，是否也該處理；`saveItem` 對 `originalName` 與讀回值的比對是否與前綴互相影響。
4. **前端非同步與重繪安全**：審查所有 `render()` 呼叫路徑（`loadAll`、`loadStall`、`loadRecords`、`confirmDelete*`、各 `go()`）的競態；`isFormScreen()` 守門是否遺漏（例如設定頁、紀錄頁篩選器輸入中被背景重繪）；快速切換日期時 `loadStall` 的過期回應處理；雙擊送出（按鈕已 `disabled`，但 `confirm` 前後的時序）。
5. **輸入驗證與前後端一致性**：`parseNonNegInt` 與後端 `isNonNegInt` 是否對齊（前端半形整數字串 vs 後端 `Number()` 轉換，例如 `"1e2"`、`" 5"`）；`calc()`（前端）與 `getHistory`（後端）的營業額／毛利公式是否一致；inline `onclick` 字串拼接與 `esc()` 的 XSS／引號安全性；備貨量上限、品項名稱長度等未設限處；`prepared`（總量）與 `extra` 的語意在 `rowToItem`／`openStall`／`closeStall`／`addStock`／前端表單還原（`prepared − extra`）之間是否一致，尤其修改開攤時 `extra` 未帶、帶 0、與 `waste` 上限的交互。

---
*附註：`.claude/settings.local.json` 為本機工具設定，與專案功能無關，未納入。專案中不存在 `.env` 或任何私密金鑰。*
