const SS = SpreadsheetApp.getActiveSpreadsheet();

function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === 'getItems')     return getItems();
    if (action === 'getLocations') return getLocations();
    if (action === 'getStallData') return getStallData(e.parameter.date);
    if (action === 'getHistory')   return getHistory(e.parameter);
    return respond({ error: '未知的 action' });
  } catch(err) {
    return respond({ error: err.message });
  }
}

function doPost(e) {
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
  }
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function today() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd');
}

function toStr(val) {
  if (val === null || val === undefined || val === '') return '';
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Taipei', 'yyyyMMdd');
  return String(val);
}

function getPriceMap() {
  const sheet = SS.getSheetByName('品項設定');
  const map = {};
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues().forEach(r => {
      if (r[0]) map[toStr(r[0])] = { price: Number(r[1]) || 0, cost: Number(r[2]) || 0 };
    });
  }
  return map;
}

function getItems() {
  const sheet = SS.getSheetByName('品項設定');
  if (!sheet || sheet.getLastRow() <= 1) return respond({ items: [] });
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  const items = rows.filter(r => r[0]).map(r => ({
    name: toStr(r[0]),
    price: Number(r[1]) || 0,
    cost: Number(r[2]) || 0,
    sweetnesses: toStr(r[3]).split(',').map(s => s.trim()).filter(Boolean)
  }));
  return respond({ items });
}

function getLocations() {
  const sheet = SS.getSheetByName('地點設定');
  if (!sheet || sheet.getLastRow() <= 1) return respond({ locations: [] });
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  return respond({ locations: rows.filter(r => r[0]).map(r => toStr(r[0])) });
}

function getStallData(date) {
  const targetDate = (date || today()).replace(/\//g, '').replace(/-/g, '');
  const sheet = SS.getSheetByName('出攤紀錄');
  if (!sheet || sheet.getLastRow() <= 1) return respond({ found: false });
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  const dayRows = rows.filter(r => toStr(r[0]) === targetDate);
  if (dayRows.length === 0) return respond({ found: false });

  const priceMap = getPriceMap();
  const location = toStr(dayRows[0][1]);
  const status = toStr(dayRows[dayRows.length - 1][6]);
  const items = dayRows.map(r => {
    const name = toStr(r[2]);
    const prepared = Number(r[4]) || 0;
    const wasteRaw = r[5];
    const waste = (wasteRaw !== '' && wasteRaw !== null && wasteRaw !== undefined) ? Number(wasteRaw) : null;
    const p = priceMap[name] || { price: 0, cost: 0 };
    return { name, sweetness: toStr(r[3]), prepared, waste, price: p.price, cost: p.cost };
  });

  return respond({ found: true, date: targetDate, location, status, items });
}

function getHistory(params) {
  const sheet = SS.getSheetByName('出攤紀錄');
  if (!sheet || sheet.getLastRow() <= 1) return respond({ records: [] });
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();

  const start = (params.startDate || '').replace(/\//g, '').replace(/-/g, '');
  const end   = (params.endDate   || '').replace(/\//g, '').replace(/-/g, '');
  const priceMap = getPriceMap();

  const grouped = {};
  rows.forEach(r => {
    const date = toStr(r[0]);
    if (!date) return;
    if (start && date < start) return;
    if (end   && date > end)   return;
    if (!grouped[date]) grouped[date] = { date, location: toStr(r[1]), status: '', items: [] };
    const name = toStr(r[2]);
    const prepared = Number(r[4]) || 0;
    const wasteRaw = r[5];
    const waste = (wasteRaw !== '' && wasteRaw !== null && wasteRaw !== undefined) ? Number(wasteRaw) : null;
    const p = priceMap[name] || { price: 0, cost: 0 };
    grouped[date].items.push({ name, sweetness: toStr(r[3]), prepared, waste, price: p.price, cost: p.cost });
    grouped[date].status = toStr(r[6]);
  });

  const records = Object.values(grouped).sort((a, b) => b.date.localeCompare(a.date)).map(rec => {
    let revenue = 0, wasteCost = 0, totalPrepared = 0, totalWaste = 0;
    rec.items.forEach(item => {
      if (item.waste !== null) {
        revenue   += (item.prepared - item.waste) * item.price;
        wasteCost += item.waste * item.cost;
        totalPrepared += item.prepared;
        totalWaste    += item.waste;
      }
    });
    return { ...rec, revenue, wasteCost, totalPrepared, totalWaste };
  });

  return respond({ records });
}

function saveItem(data) {
  const sheet = SS.getSheetByName('品項設定');
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues() : [];
  const searchName = data.originalName || data.name;
  const idx = rows.findIndex(r => toStr(r[0]) === searchName);
  const row = [data.name, Number(data.price) || 0, Number(data.cost) || 0, (data.sweetnesses || []).join(',')];
  if (idx >= 0) {
    sheet.getRange(idx + 2, 1, 1, 4).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
  return respond({ ok: true });
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
  const sheet = SS.getSheetByName('地點設定');
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues() : [];
  if (!rows.some(r => toStr(r[0]) === data.name)) sheet.appendRow([data.name]);
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

function openStall(data) {
  const sheet = SS.getSheetByName('出攤紀錄');
  const date = (data.date || today()).replace(/\//g, '').replace(/-/g, '');
  if (sheet.getLastRow() > 1) {
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (toStr(rows[i][0]) === date) sheet.deleteRow(i + 2);
    }
  }
  const newRows = data.items.map(item => [
    date, data.location, item.name, item.sweetness || '',
    Number(item.prepared) || 0, '', '開攤中'
  ]);
  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 7).setValues(newRows);
  }
  return respond({ ok: true });
}

function closeStall(data) {
  const sheet = SS.getSheetByName('出攤紀錄');
  if (sheet.getLastRow() <= 1) return respond({ error: '無出攤紀錄' });
  const date = (data.date || today()).replace(/\//g, '').replace(/-/g, '');
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  data.items.forEach(item => {
    for (let i = 0; i < rows.length; i++) {
      if (toStr(rows[i][0]) === date && toStr(rows[i][2]) === item.name) {
        sheet.getRange(i + 2, 6).setValue(Number(item.waste));
        sheet.getRange(i + 2, 7).setValue('已收攤');
        break;
      }
    }
  });
  return respond({ ok: true });
}
