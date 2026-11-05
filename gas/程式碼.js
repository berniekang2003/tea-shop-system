const SS = SpreadsheetApp.getActiveSpreadsheet();
const REC_COLS = 9; // 出攤紀錄 A~I：日期,地點,品項,甜度,備貨,剩餘,狀態,售價快照,成本快照

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

// 讀出攤紀錄 A~I；欄數不足 9 的舊表以空字串補齊
function readRecords() {
  const sheet = SS.getSheetByName('出攤紀錄');
  if (!sheet || sheet.getLastRow() <= 1) return { sheet, rows: [] };
  const cols = Math.min(REC_COLS, Math.max(sheet.getMaxColumns(), 7));
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, cols).getValues().map(r => {
    while (r.length < REC_COLS) r.push('');
    return r;
  });
  return { sheet, rows };
}

// 優先使用該列的價格快照；舊資料（H、I 欄空白）退回品項設定的現行價格
function rowToItem(r, priceMap) {
  const name = toStr(r[2]);
  const pm = priceMap[name] || { price: 0, cost: 0 };
  return {
    name,
    sweetness: toStr(r[3]),
    prepared: Number(r[4]) || 0,
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
// 欄數不足 9 時補欄；表頭 H、I 空白時自動補上
function ensureRecCols(sheet) {
  const max = sheet.getMaxColumns();
  if (max < REC_COLS) sheet.insertColumnsAfter(max, REC_COLS - max);
  if (sheet.getLastRow() >= 1) {
    const h = sheet.getRange(1, 8, 1, 2).getValues()[0];
    if (!h[0] || !h[1]) sheet.getRange(1, 8, 1, 2).setValues([['售價快照', '成本快照']]);
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
  }
  const hasWaste = it => it.waste !== undefined && it.waste !== null && it.waste !== '';
  const allWaste = items.every(hasWaste);
  if (allWaste) {
    for (const it of items) {
      const w = Number(it.waste);
      if (!isNonNegInt(w) || w > Number(it.prepared)) return respond({ error: `「${it.name}」剩餘杯數需介於 0 到備貨量` });
    }
  }

  ensureRecCols(sheet);
  const priceMap = getPriceMap();
  const oldSnap = {};
  const toDelete = [];
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, REC_COLS).getValues().forEach((r, i) => {
      if (toStr(r[0]) !== date) return;
      toDelete.push(i + 2);
      if (hasVal(r[7]) && hasVal(r[8])) oldSnap[toStr(r[2])] = { price: Number(r[7]), cost: Number(r[8]) };
    });
  }
  deleteRowRuns(sheet, toDelete);

  const newRows = items.map(it => {
    const name = String(it.name).trim();
    const snap = oldSnap[name] || priceMap[name] || { price: num(it.price, 0), cost: num(it.cost, 0) };
    return [
      date, safeText(location), safeText(name), safeText(it.sweetness || ''),
      Number(it.prepared),
      allWaste ? Number(it.waste) : '',
      allWaste ? '已收攤' : '開攤中',
      snap.price, snap.cost
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
  const n = sheet.getLastRow() - 1;
  const rows = sheet.getRange(2, 1, n, 7).getValues();
  const fg = rows.map(r => [r[5], r[6]]);

  for (const it of items) {
    const waste = Number(it.waste);
    const i = rows.findIndex(r => toStr(r[0]) === date && toStr(r[2]) === it.name);
    if (i < 0) return respond({ error: `找不到「${it.name}」的開攤紀錄` });
    if (!isNonNegInt(waste) || waste > Number(rows[i][4])) return respond({ error: `「${it.name}」剩餘杯數需介於 0 到備貨量` });
    fg[i] = [waste, '已收攤'];
  }
  sheet.getRange(2, 6, n, 2).setValues(fg);
  return respond({ ok: true });
}
