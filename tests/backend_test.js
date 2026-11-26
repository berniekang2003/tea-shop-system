// 後端單元測試：以假 Sheet 載入 gas/程式碼.js 執行。用法：node tests/backend_test.js
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const SRC = path.join(__dirname, '..', 'gas', '程式碼.js');
let stats;

class Sheet {
  constructor(rows, maxCols) { this.rows = rows; this.maxCols = maxCols; }
  getLastRow() { return this.rows.length; }
  getMaxColumns() { return this.maxCols; }
  insertColumnsAfter(c, n) { this.maxCols += n; stats.insertCols++; }
  insertRowsAfter(pos, n) { stats.insertRows++; this.rows.splice(pos, 0, ...Array.from({ length: n }, () => [])); }
  getRange(r, c, n = 1, m = 1) {
    const s = this;
    if (c - 1 + m > s.maxCols) throw new Error('range outside sheet dimensions');
    return {
      getValues() { stats.get++; return Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => { const v = (s.rows[r - 1 + i] || [])[c - 1 + j]; return v === undefined ? '' : v; })); },
      setValues(v) { stats.set++; v.forEach((row, i) => { while (s.rows.length < r + i) s.rows.push([]); row.forEach((val, j) => { s.rows[r - 1 + i][c - 1 + j] = val; }); }); },
      getValue() { return this.getValues()[0][0]; }
    };
  }
  appendRow(x) { stats.append++; this.rows.push(x); }
  deleteRow(i) { stats.deleteRow++; this.rows.splice(i - 1, 1); }
  deleteRows(i, n) { stats.deleteRows++; this.rows.splice(i - 1, n); }
}

function setup(opts = {}) {
  stats = { get: 0, set: 0, append: 0, deleteRow: 0, deleteRows: 0, insertCols: 0, insertRows: 0, lock: 0, release: 0 };
  const sheets = {
    '品項設定': new Sheet([['名稱', '售價', '成本', '甜度'], ['仙草奶茶', 55, 20, '無糖,半糖'], ['烏龍綠茶', 40, 14, '微糖']], 26),
    '地點設定': new Sheet([['地點'], ['中友']], 26),
    '出攤紀錄': new Sheet(opts.rec || [['日期', '地點', '品項', '甜度', '備貨', '剩餘', '狀態']], opts.maxCols || 26)
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => sheets[n] }) },
    ContentService: { createTextOutput: o => ({ o, setMimeType() { return this; } }), MimeType: { JSON: 1 } },
    Utilities: { formatDate: () => 'DATE' },
    LockService: { getScriptLock: () => ({ waitLock() { stats.lock++; if (opts.lockFail) throw new Error('timeout'); }, releaseLock() { stats.release++; } }) },
    console
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(SRC, 'utf8').replace(/^const /gm, 'var '), ctx);
  const post = d => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(d) } }).o);
  const get = p => JSON.parse(ctx.doGet({ parameter: p }).o);
  return { sheets, post, get, ctx };
}
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('PASS', name); };

t('legacy rows fallback to current price', () => {
  const { get } = setup({ rec: [['d', 'l', 'i', 's', 'e', 'f', 'g'], ['20261101', '中友', '仙草奶茶', '半糖', 30, 6, '已收攤'], ['20261101', '中友', '烏龍綠茶', '微糖', 20, 2, '已收攤']], maxCols: 7 });
  const r = get({ action: 'getHistory' }).records[0];
  assert.strictEqual(r.revenue, (24 * 55) + (18 * 40)); assert.strictEqual(r.wasteCost, 6 * 20 + 2 * 14);
  assert.strictEqual(r.profit, r.revenue - (30 * 20 + 20 * 14));
  assert.strictEqual(get({ action: 'getStallData', date: '20261101' }).items[0].price, 55);
});
t('openStall writes snapshot; later price change does not rewrite history', () => {
  const { post, get, sheets } = setup();
  assert.deepStrictEqual(post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', sweetness: '半糖', prepared: 30 }, { name: '烏龍綠茶', sweetness: '微糖', prepared: 20 }] }), { ok: true });
  const rows = sheets['出攤紀錄'].rows; assert.deepStrictEqual(rows[1].slice(7), [55, 20, 0]); assert.deepStrictEqual(rows[2].slice(7), [40, 14, 0]);
  assert.deepStrictEqual(rows[0].slice(7), ['售價快照', '成本快照', '追加杯數'], '表頭自動補上');
  post({ action: 'closeStall', date: '20261105', items: [{ name: '仙草奶茶', waste: 5 }, { name: '烏龍綠茶', waste: 0 }] });
  post({ action: 'saveItem', originalName: '仙草奶茶', name: '仙草奶茶', price: 99, cost: 50, sweetnesses: ['半糖'] });
  const s = get({ action: 'getStallData', date: '20261105' });
  assert.strictEqual(s.items[0].price, 55); assert.strictEqual(s.items[0].cost, 20);
  assert.strictEqual(get({ action: 'getHistory' }).records[0].revenue, 25 * 55 + 20 * 40);
  post({ action: 'deleteItem', name: '烏龍綠茶' });
  assert.strictEqual(get({ action: 'getHistory' }).records[0].revenue, 25 * 55 + 20 * 40);
});
t('single-request backfill sets 已收攤; partial waste ignored', () => {
  const { post, sheets } = setup();
  post({ action: 'openStall', date: '20261104', location: '中友', items: [{ name: '仙草奶茶', sweetness: '', prepared: 24, waste: 10 }, { name: '烏龍綠茶', sweetness: '', prepared: 20, waste: 0 }] });
  let rows = sheets['出攤紀錄'].rows; assert.deepStrictEqual([rows[1][5], rows[1][6], rows[2][5], rows[2][6]], [10, '已收攤', 0, '已收攤']);
  post({ action: 'openStall', date: '20261103', location: '中友', items: [{ name: '仙草奶茶', prepared: 24, waste: 10 }, { name: '烏龍綠茶', prepared: 20 }] });
  rows = sheets['出攤紀錄'].rows; assert.deepStrictEqual([rows[3][5], rows[3][6]], ['', '開攤中']);
});
t('edit keeps same-day snapshot, new item uses current price', () => {
  const { post, sheets } = setup();
  post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: 30 }] });
  post({ action: 'saveItem', originalName: '仙草奶茶', name: '仙草奶茶', price: 99, cost: 50, sweetnesses: [] });
  post({ action: 'saveItem', originalName: '烏龍綠茶', name: '烏龍綠茶', price: 60, cost: 30, sweetnesses: [] });
  post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: 33 }, { name: '烏龍綠茶', prepared: 10 }] });
  const rows = sheets['出攤紀錄'].rows;
  assert.deepStrictEqual([rows[1][4], rows[1][7], rows[1][8]], [33, 55, 20]); assert.deepStrictEqual(rows[2].slice(7, 9), [60, 30]);
  assert.strictEqual(rows.length, 3, '舊列已刪除、無重複');
});
t('batched deleteRows', () => {
  const rec = [['h'], ['20261105', 'a', 'x', '', 1, '', '開攤中', 1, 1], ['20261105', 'a', 'y', '', 1, '', '開攤中', 1, 1], ['20261105', 'a', 'z', '', 1, '', '開攤中', 1, 1], ['20261101', 'a', 'x', '', 1, '', '開攤中', 1, 1], ['20261105', 'a', 'w', '', 1, '', '開攤中', 1, 1]];
  const { post, sheets } = setup({ rec });
  stats.deleteRows = 0; stats.deleteRow = 0;
  post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: 5 }] });
  assert.strictEqual(stats.deleteRows, 2, '兩段連續區段'); assert.strictEqual(stats.deleteRow, 0);
  assert.strictEqual(sheets['出攤紀錄'].rows.filter(r => r[0] === '20261105').length, 1);
  assert.strictEqual(sheets['出攤紀錄'].rows.filter(r => r[0] === '20261101').length, 1);
});
t('closeStall single batch write', () => {
  const { post, sheets } = setup();
  post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: 30 }, { name: '烏龍綠茶', prepared: 20 }] });
  post({ action: 'openStall', date: '20261104', location: '中友', items: [{ name: '仙草奶茶', prepared: 10 }] });
  stats.set = 0;
  assert.deepStrictEqual(post({ action: 'closeStall', date: '20261105', items: [{ name: '仙草奶茶', waste: 7 }, { name: '烏龍綠茶', waste: 0 }] }), { ok: true });
  assert.strictEqual(stats.set, 1);
  assert.deepStrictEqual(sheets['出攤紀錄'].rows.slice(1).map(x => [x[0], x[5], x[6]]), [['20261105', 7, '已收攤'], ['20261105', 0, '已收攤'], ['20261104', '', '開攤中']]);
  assert.ok(post({ action: 'closeStall', date: '20261105', items: [{ name: '仙草奶茶', waste: 99 }] }).error);
  assert.ok(post({ action: 'closeStall', date: '20261105', items: [{ name: '仙草奶茶', waste: -1 }] }).error);
  assert.ok(post({ action: 'closeStall', date: '20261105', items: [{ name: '不存在', waste: 1 }] }).error);
});
t('LockService acquire/release', () => {
  const a = setup(); a.post({ action: 'saveLocation', name: 'X' }); a.post({ action: 'nope' }); a.ctx.doPost({ postData: { contents: 'not json' } });
  assert.strictEqual(stats.lock, 3); assert.strictEqual(stats.release, 3);
  const b = setup({ lockFail: true }); assert.ok(/忙碌/.test(b.post({ action: 'saveLocation', name: 'Y' }).error)); assert.strictEqual(stats.release, 0);
  assert.strictEqual(b.sheets['地點設定'].rows.length, 2);
});
t('safeText prevents formula injection', () => {
  const { post, sheets, ctx } = setup();
  for (const s of ['=1+1', '+1', '-2', '@SUM(A1)', '\tx', '\rx']) assert.strictEqual(ctx.safeText(s), "'" + s);
  assert.strictEqual(ctx.safeText('正常'), '正常');
  post({ action: 'saveLocation', name: '=HYPERLINK("x")' }); assert.strictEqual(sheets['地點設定'].rows[2][0], "'=HYPERLINK(\"x\")");
  post({ action: 'saveItem', name: '=cmd', price: 1, cost: 1, sweetnesses: ['+a'] }); assert.strictEqual(sheets['品項設定'].rows[3][0], "'=cmd"); assert.strictEqual(sheets['品項設定'].rows[3][3], "'+a");
  post({ action: 'openStall', date: '20261105', location: '@x', items: [{ name: '仙草奶茶', sweetness: '-1', prepared: 3 }] });
  const r = sheets['出攤紀錄'].rows[1]; assert.deepStrictEqual([r[1], r[3]], ["'@x", "'-1"]);
});
t('getInit returns items/locations/stall in one call', () => {
  const { post, get } = setup(); post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: 30 }] });
  const r = get({ action: 'getInit', date: '20261105' });
  assert.strictEqual(r.items.length, 2); assert.deepStrictEqual(r.locations, ['中友']); assert.strictEqual(r.stall.found, true); assert.strictEqual(r.stall.items[0].price, 55);
  assert.strictEqual(get({ action: 'getInit', date: '20200101' }).stall.found, false);
  assert.ok(get({ action: 'getItems' }).items && get({ action: 'getLocations' }).locations && get({ action: 'getStallData', date: '20261105' }).found);
});
t('sheet with only 7 columns is auto-extended on write', () => {
  const { post, get } = setup({ maxCols: 7 });
  assert.doesNotThrow(() => get({ action: 'getHistory' }));
  assert.deepStrictEqual(post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: 3 }] }), { ok: true });
  assert.ok(stats.insertCols >= 1); assert.strictEqual(get({ action: 'getStallData', date: '20261105' }).items[0].price, 55);
});
t('invalid openStall does not delete existing day', () => {
  const { post, sheets } = setup(); post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: 3 }] });
  assert.ok(post({ action: 'openStall', date: '20261105', location: '中友', items: [] }).error);
  assert.ok(post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: -3 }] }).error);
  assert.ok(post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: 3, waste: 9 }] }).error);
  assert.ok(post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: 3 }, { name: '仙草奶茶', prepared: 2 }] }).error);
  assert.strictEqual(sheets['出攤紀錄'].rows.length, 2);
});
t('rename sync, duplicate guard, sweetness comma strip', () => {
  const { post, sheets } = setup(); post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: 3 }] });
  assert.deepStrictEqual(post({ action: 'saveItem', originalName: '仙草奶茶', name: '仙草鮮奶茶', price: 55, cost: 20, sweetnesses: ['半,糖', '全，糖'] }), { ok: true });
  assert.strictEqual(sheets['出攤紀錄'].rows[1][2], '仙草鮮奶茶'); assert.strictEqual(sheets['品項設定'].rows[1][3], '半糖,全糖');
  assert.ok(post({ action: 'saveItem', originalName: '烏龍綠茶', name: '仙草鮮奶茶', price: 1, cost: 1 }).error);
});

// ===== 追加功能 =====
const base = () => { const e = setup(); e.post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', sweetness: '半糖', prepared: 30 }, { name: '烏龍綠茶', sweetness: '微糖', prepared: 20 }] }); return e; };
t('addStock accumulates, prepared = base + extra, single write', () => {
  const { post, get, sheets } = base(); stats.set = 0;
  assert.deepStrictEqual(post({ action: 'addStock', date: '20261105', items: [{ name: '仙草奶茶', add: 12 }] }), { ok: true });
  assert.strictEqual(stats.set, 1);
  post({ action: 'addStock', date: '20261105', items: [{ name: '仙草奶茶', add: 8 }, { name: '烏龍綠茶', add: 5 }] });
  const s = get({ action: 'getStallData', date: '20261105' });
  assert.deepStrictEqual(s.items.map(i => [i.name, i.prepared, i.extra]), [['仙草奶茶', 50, 20], ['烏龍綠茶', 25, 5]]);
  assert.strictEqual(sheets['出攤紀錄'].rows[1][4], 30, 'E 欄維持原備貨');
  assert.strictEqual(sheets['出攤紀錄'].rows[1][9], 20);
});
t('addStock validation (positive int, duplicates, unknown item, closed day, empty) and no partial write', () => {
  const { post, sheets } = base(); const before = JSON.stringify(sheets['出攤紀錄'].rows);
  for (const bad of [0, -1, 1.5, 'x', null]) assert.ok(post({ action: 'addStock', date: '20261105', items: [{ name: '仙草奶茶', add: bad }] }).error, 'add=' + bad);
  assert.ok(post({ action: 'addStock', date: '20261105', items: [{ name: '仙草奶茶', add: 1 }, { name: '仙草奶茶', add: 1 }] }).error);
  assert.ok(post({ action: 'addStock', date: '20261105', items: [{ name: '不存在', add: 1 }] }).error);
  assert.ok(post({ action: 'addStock', date: '20261105', items: [] }).error);
  assert.ok(post({ action: 'addStock', date: '20200101', items: [{ name: '仙草奶茶', add: 1 }] }).error);
  assert.ok(post({ action: 'addStock', date: '20261105', items: [{ name: '仙草奶茶', add: 3 }, { name: '不存在', add: 1 }] }).error);
  assert.strictEqual(JSON.stringify(sheets['出攤紀錄'].rows), before, '任何錯誤都不寫入（含部分有效項）');
  post({ action: 'closeStall', date: '20261105', items: [{ name: '仙草奶茶', waste: 1 }, { name: '烏龍綠茶', waste: 1 }] });
  assert.ok(/已收攤/.test(post({ action: 'addStock', date: '20261105', items: [{ name: '仙草奶茶', add: 5 }] }).error));
});
t('closeStall waste bound uses base + extra; wasteCost/profit use total', () => {
  const { post, get } = base(); post({ action: 'addStock', date: '20261105', items: [{ name: '仙草奶茶', add: 10 }] });
  assert.ok(post({ action: 'closeStall', date: '20261105', items: [{ name: '仙草奶茶', waste: 41 }] }).error, '41 > 30+10');
  assert.deepStrictEqual(post({ action: 'closeStall', date: '20261105', items: [{ name: '仙草奶茶', waste: 40 }, { name: '烏龍綠茶', waste: 0 }] }), { ok: true });
  const h = get({ action: 'getHistory' }).records[0];
  assert.strictEqual(h.revenue, 20 * 40); assert.strictEqual(h.wasteCost, 40 * 20);
  assert.strictEqual(h.profit, h.revenue - (40 * 20 + 20 * 14), '毛利以總備貨成本計');
});
t('revenue/profit/totalPrepared include extra cups', () => {
  const { post, get } = base(); post({ action: 'addStock', date: '20261105', items: [{ name: '仙草奶茶', add: 20 }] });
  post({ action: 'closeStall', date: '20261105', items: [{ name: '仙草奶茶', waste: 6 }, { name: '烏龍綠茶', waste: 2 }] });
  const h = get({ action: 'getHistory' }).records[0];
  assert.strictEqual(h.revenue, (50 - 6) * 55 + (20 - 2) * 40); assert.strictEqual(h.totalPrepared, 70);
  assert.strictEqual(h.profit, h.revenue - (50 * 20 + 20 * 14));
});
t('openStall edit preserves extra when not given; explicit extra overrides (incl. 0)', () => {
  const { post, get, sheets } = base(); post({ action: 'addStock', date: '20261105', items: [{ name: '仙草奶茶', add: 12 }] });
  post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: 32 }, { name: '烏龍綠茶', prepared: 20 }] });
  let s = get({ action: 'getStallData', date: '20261105' }); assert.deepStrictEqual(s.items.map(i => [i.prepared, i.extra]), [[44, 12], [20, 0]], '未帶 extra 沿用');
  post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: 32, extra: 5 }, { name: '烏龍綠茶', prepared: 20, extra: 0 }] });
  s = get({ action: 'getStallData', date: '20261105' }); assert.deepStrictEqual(s.items.map(i => [i.prepared, i.extra]), [[37, 5], [20, 0]]);
  post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: 32, extra: 0 }, { name: '烏龍綠茶', prepared: 20 }] });
  assert.strictEqual(get({ action: 'getStallData', date: '20261105' }).items[0].extra, 0, 'extra:0 可清除');
  assert.ok(post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: 32, extra: -1 }] }).error);
  assert.ok(post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: 10, extra: 5, waste: 16 }] }).error, 'waste 16 > 10+5');
  assert.deepStrictEqual(post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: 10, extra: 5, waste: 15 }] }), { ok: true });
  assert.strictEqual(sheets['出攤紀錄'].rows[1][9], 5); assert.strictEqual(sheets['出攤紀錄'].rows[1][6], '已收攤');
});
t('openStall edit keeps price snapshot AND extra together; new item gets current price with extra 0', () => {
  const { post, get } = base(); post({ action: 'addStock', date: '20261105', items: [{ name: '仙草奶茶', add: 12 }] });
  post({ action: 'saveItem', originalName: '仙草奶茶', name: '仙草奶茶', price: 99, cost: 50, sweetnesses: [] });
  post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: 30 }, { name: '烏龍綠茶', prepared: 20 }, { name: '未登錄品項', prepared: 5, price: 7, cost: 3 }] });
  const s = get({ action: 'getStallData', date: '20261105' });
  assert.deepStrictEqual([s.items[0].price, s.items[0].extra], [55, 12]); assert.deepStrictEqual([s.items[2].price, s.items[2].cost, s.items[2].extra], [7, 3, 0]);
});
t('legacy 7-col and 9-col rows read with extra=0; 9-col sheet auto-extends to 10 on addStock', () => {
  const a = setup({ rec: [['d', 'l', 'i', 's', 'e', 'f', 'g'], ['20261101', '中友', '仙草奶茶', '', 30, 6, '已收攤']], maxCols: 7 });
  assert.strictEqual(a.get({ action: 'getStallData', date: '20261101' }).items[0].extra, 0);
  const b = setup({ rec: [['d', 'l', 'i', 's', 'e', 'f', 'g', 'h', 'i'], ['20261105', '中友', '仙草奶茶', '', 30, '', '開攤中', 55, 20]], maxCols: 9 });
  assert.strictEqual(b.get({ action: 'getStallData', date: '20261105' }).items[0].prepared, 30);
  assert.deepStrictEqual(b.post({ action: 'addStock', date: '20261105', items: [{ name: '仙草奶茶', add: 4 }] }), { ok: true });
  assert.strictEqual(b.get({ action: 'getStallData', date: '20261105' }).items[0].prepared, 34); assert.ok(stats.insertCols >= 1);
  assert.strictEqual(b.sheets['出攤紀錄'].rows[0][9], '追加杯數');
  assert.deepStrictEqual(b.sheets['出攤紀錄'].rows[0].slice(7, 9), ['h', 'i'], '自訂表頭不被覆寫');
});
t('getInit carries extra; addStock takes the lock', () => {
  const { post, get } = base(); post({ action: 'addStock', date: '20261105', items: [{ name: '烏龍綠茶', add: 3 }] });
  assert.strictEqual(get({ action: 'getInit', date: '20261105' }).stall.items[1].extra, 3);
  stats.lock = 0; stats.release = 0; post({ action: 'addStock', date: '20261105', items: [{ name: 'x', add: 1 }] }); assert.strictEqual(stats.lock, 1); assert.strictEqual(stats.release, 1);
});

// ===== 追加新品項（開攤時沒帶、後來才補上）=====
const stall = () => {
  const e = setup();
  e.post({ action: 'openStall', date: '20261110', location: '一中', items: [{ name: '烏龍綠茶', prepared: 10 }] });
  e.post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', sweetness: '半糖', prepared: 30 }] });
  e.post({ action: 'openStall', date: '20261101', location: '逢甲', items: [{ name: '烏龍綠茶', prepared: 5 }] });
  return e;
};
t('addStock create:true inserts new item row right after the day (not at sheet end), with snapshot + location', () => {
  const { post, get, sheets } = stall(); stats.insertRows = 0;
  assert.deepStrictEqual(post({ action: 'addStock', date: '20261105', items: [{ name: '烏龍綠茶', sweetness: '微糖', add: 20, create: true }, { name: '仙草奶茶', add: 4 }] }), { ok: true });
  assert.strictEqual(stats.insertRows, 1);
  const rows = sheets['出攤紀錄'].rows;
  const idx = rows.map((r, i) => r[0] === '20261105' ? i : -1).filter(i => i >= 0);
  assert.strictEqual(idx.length, 2); assert.strictEqual(idx[1] - idx[0], 1, '同日列連續');
  assert.deepStrictEqual(rows[idx[1]], ['20261105', '中友', '烏龍綠茶', '微糖', 0, '', '開攤中', 40, 14, 20]);
  assert.strictEqual(rows[idx[0]][9], 4);
  assert.deepStrictEqual(rows.slice(1).map(r => r[0]), ['20261110', '20261105', '20261105', '20261101'], '其他日期順序不變');
  const s = get({ action: 'getStallData', date: '20261105' });
  assert.deepStrictEqual(s.items.map(i => [i.name, i.prepared, i.extra, i.price]), [['仙草奶茶', 34, 4, 55], ['烏龍綠茶', 20, 20, 40]]); assert.strictEqual(s.location, '中友'); assert.strictEqual(s.status, '開攤中');
});
t('addStock create guards: needs flag, not on closed day, unknown day, no partial write', () => {
  const { post, sheets } = stall(); const before = JSON.stringify(sheets['出攤紀錄'].rows);
  assert.ok(/找不到/.test(post({ action: 'addStock', date: '20261105', items: [{ name: '烏龍綠茶', add: 5 }] }).error), '沒帶 create');
  assert.ok(post({ action: 'addStock', date: '20200101', items: [{ name: '烏龍綠茶', add: 5, create: true }] }).error, '沒有這一天');
  assert.ok(post({ action: 'addStock', date: '20261105', items: [{ name: '烏龍綠茶', add: 5, create: true }, { name: '仙草奶茶', add: 0 }] }).error, '混合含無效項');
  assert.ok(post({ action: 'addStock', date: '20261105', items: [{ name: '烏龍綠茶', add: 5, create: true }, { name: '烏龍綠茶', add: 1, create: true }] }).error, '重複');
  assert.ok(post({ action: 'addStock', date: '20261105', items: [{ name: '  ', add: 5, create: true }] }).error);
  assert.strictEqual(JSON.stringify(sheets['出攤紀錄'].rows), before);
  post({ action: 'closeStall', date: '20261105', items: [{ name: '仙草奶茶', waste: 1 }] });
  assert.ok(/已收攤/.test(post({ action: 'addStock', date: '20261105', items: [{ name: '烏龍綠茶', add: 5, create: true }] }).error));
});
t('create with an existing name just adds to it (no duplicate row)', () => {
  const { post, get, sheets } = stall();
  post({ action: 'addStock', date: '20261105', items: [{ name: '仙草奶茶', add: 6, create: true }] });
  assert.strictEqual(sheets['出攤紀錄'].rows.filter(r => r[0] === '20261105').length, 1); assert.strictEqual(get({ action: 'getStallData', date: '20261105' }).items[0].prepared, 36);
});
t('new item flows through closeStall, history and later edits', () => {
  const { post, get } = stall(); post({ action: 'addStock', date: '20261105', items: [{ name: '烏龍綠茶', sweetness: '微糖', add: 20, create: true }] });
  assert.ok(post({ action: 'closeStall', date: '20261105', items: [{ name: '仙草奶茶', waste: 1 }, { name: '烏龍綠茶', waste: 21 }] }).error, '21 > 0+20');
  assert.deepStrictEqual(post({ action: 'closeStall', date: '20261105', items: [{ name: '仙草奶茶', waste: 1 }, { name: '烏龍綠茶', waste: 5 }] }), { ok: true });
  const h = get({ action: 'getHistory' }).records.find(r => r.date === '20261105');
  assert.strictEqual(h.revenue, 29 * 55 + 15 * 40); assert.strictEqual(h.wasteCost, 1 * 20 + 5 * 14); assert.strictEqual(h.profit, h.revenue - (30 * 20 + 20 * 14)); assert.strictEqual(h.totalPrepared, 50);
});
t('openStall allows base 0 only when extra > 0 (given or preserved); >4 items ok', () => {
  const { post, get } = stall(); post({ action: 'addStock', date: '20261105', items: [{ name: '烏龍綠茶', add: 20, create: true }] });
  assert.deepStrictEqual(post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: 30 }, { name: '烏龍綠茶', prepared: 0 }] }), { ok: true }, '沿用舊追加 20');
  assert.strictEqual(get({ action: 'getStallData', date: '20261105' }).items[1].prepared, 20);
  assert.deepStrictEqual(post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: 30 }, { name: '烏龍綠茶', prepared: 0, extra: 7 }] }), { ok: true });
  assert.ok(post({ action: 'openStall', date: '20261105', location: '中友', items: [{ name: '仙草奶茶', prepared: 30 }, { name: '烏龍綠茶', prepared: 0, extra: 0 }] }).error, '0+0');
  assert.ok(post({ action: 'openStall', date: '20261106', location: '中友', items: [{ name: '烏龍綠茶', prepared: 0 }] }).error, '新場次 0 且無追加');
  assert.ok(post({ action: 'openStall', date: '20261106', location: '中友', items: [{ name: '烏龍綠茶', prepared: -1, extra: 5 }] }).error);
  const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((n, i) => ({ name: n, prepared: i + 1 }));
  assert.deepStrictEqual(post({ action: 'openStall', date: '20261107', location: '中友', items: six }), { ok: true }); assert.strictEqual(get({ action: 'getStallData', date: '20261107' }).items.length, 6);
});
console.log('\nALL', n, 'backend tests passed');
