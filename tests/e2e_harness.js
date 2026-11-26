// 端到端測試輔助：在頁面內以假試算表執行真實的 gas/程式碼.js，並把 fetch 導向它。
// 用法：專案根目錄 `python3 -m http.server 8765`，瀏覽器開 http://localhost:8765/index.html，
// 於 console 載入本檔後呼叫 `await installBackend({items:[...], locs:[...], rows:[...]}); await loadAll();`
window.installBackend = async function (seed = {}) {
  const code = await (await fetch(encodeURI('/gas/程式碼.js'))).text();
  class Sheet {
    constructor(rows, maxCols) { this.rows = rows; this.maxCols = maxCols; }
    getLastRow() { return this.rows.length; }
    getMaxColumns() { return this.maxCols; }
    insertColumnsAfter(c, n) { this.maxCols += n; }
    insertRowsAfter(pos, n) { this.rows.splice(pos, 0, ...Array.from({ length: n }, () => [])); }
    getRange(r, c, n = 1, m = 1) {
      const s = this;
      return {
        getValues() { return Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => { const v = (s.rows[r - 1 + i] || [])[c - 1 + j]; return v === undefined ? '' : v; })); },
        setValues(v) { v.forEach((row, i) => { while (s.rows.length < r + i) s.rows.push([]); row.forEach((val, j) => { s.rows[r - 1 + i][c - 1 + j] = val; }); }); },
        getValue() { return this.getValues()[0][0]; }
      };
    }
    appendRow(x) { this.rows.push(x); }
    deleteRow(i) { this.rows.splice(i - 1, 1); }
    deleteRows(i, n) { this.rows.splice(i - 1, n); }
  }
  const sheets = {
    '品項設定': new Sheet([['名稱', '售價', '成本', '甜度']].concat(seed.items || []), 26),
    '地點設定': new Sheet([['地點']].concat(seed.locs || []), 26),
    '出攤紀錄': new Sheet([['日期', '地點', '品項', '甜度', '備貨', '剩餘', '狀態']].concat(seed.rows || []), seed.maxCols || 26)
  };
  const log = [];
  const api = new Function('SpreadsheetApp', 'ContentService', 'Utilities', 'LockService', code + '\n;return {doGet,doPost};')(
    { getActiveSpreadsheet: () => ({ getSheetByName: n => sheets[n] }) },
    { createTextOutput: o => ({ o, setMimeType() { return this; } }), MimeType: { JSON: 1 } },
    { formatDate: () => 'DATE' },
    { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) });
  window.SHEETS = sheets; window.REQLOG = log; window.LATENCY = 60;
  window.fetch = async (url, opts) => {
    await new Promise(r => setTimeout(r, window.LATENCY));
    let out;
    if (opts && opts.method === 'POST') { log.push(JSON.parse(opts.body).action); out = api.doPost({ postData: { contents: opts.body } }).o; }
    else { const u = new URL(url, location.href); const p = Object.fromEntries(u.searchParams); log.push(p.action); out = api.doGet({ parameter: p }).o; }
    return { json: async () => JSON.parse(out) };
  };
};
