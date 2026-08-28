const SS = SpreadsheetApp.getActiveSpreadsheet();

function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === 'getItems')        return getItems();
    if (action === 'getInventory')    return getInventory(e.parameter.date);
    if (action === 'getOrder') return getOrder(e.parameter);
    if (action === 'getHistory')      return getHistory();
    if (action === 'getWasteHistory') return getWasteHistory(e.parameter);
    if (action === 'getAll')          return getAll(e.parameter);
    if (action === 'getDailyData')       return getDailyData(e.parameter);
    if (action === 'getSoldOutHistory')  return getSoldOutHistory(e.parameter);
    return respond({ error: '未知的 action' });
  } catch(err) {
    return respond({ error: err.message });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    if (action === 'saveInventory')   return saveInventory(data);
    if (action === 'submitOrder')     return submitOrder(data);
    if (action === 'confirmShipping') return confirmShipping(data);
    if (action === 'confirmArrival')  return confirmArrival(data);
    if (action === 'markSoldOut')     return markSoldOut(data.item);
    if (action === 'togglePause')     return togglePause(data.item);
    if (action === 'updateOrder')     return updateOrder(data);
    if (action === 'addWaste')        return addWaste(data);
    if (action === 'deleteOrder')     return deleteOrder(data);
    return respond({ error: '未知的 action' });
  } catch(err) {
    return respond({ error: err.message });
  }
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function today() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd');
}

function now() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm');
}

function toStr(val) {
  if (!val && val !== 0) return '';
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Taipei', 'yyyy/MM/dd');
  return String(val);
}

function toDateTime(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Taipei', 'yyyy/MM/dd HH:mm');
  return String(val);
}

function getItems() {
  const sheet = SS.getSheetByName('設定');
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  const fixed = [], rotating = [], rotatingAll = [];
  rows.forEach(r => {
    const [name, type, cups, order, status, paused] = r;
    if (!name) return;
    if (type === '固定') {
      fixed.push({ name, cups });
    } else if (type === '輪替') {
      const item = { name, cups, order, status, paused: !!paused };
      rotatingAll.push(item);
      if (status === '現售') rotating.push(item);
    }
  });
  rotatingAll.sort((a, b) => a.order - b.order);
  rotating.sort((a, b) => a.order - b.order);
  const nextItem = rotatingAll.find(r => r.status === '候補' && !r.paused) || null;
  return respond({ fixed, rotating, rotatingAll, nextItem });
}

function togglePause(itemName) {
  const sheet = SS.getSheetByName('設定');
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === itemName && rows[i][1] === '輪替') {
      sheet.getRange(i + 2, 6).setValue(!rows[i][5]);
      break;
    }
  }
  return respond({ ok: true });
}

function markSoldOut(itemName) {
  const sheet = SS.getSheetByName('設定');
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === itemName && rows[i][1] === '輪替') {
      sheet.getRange(i + 2, 5).setValue('售完');
      break;
    }
  }
  const updated = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  const next = updated
    .filter(r => r[1] === '輪替' && r[4] === '候補' && !r[5])
    .sort((a, b) => a[3] - b[3])[0];
  if (next) {
    for (let i = 0; i < updated.length; i++) {
      if (updated[i][0] === next[0]) { sheet.getRange(i + 2, 5).setValue('現售'); break; }
    }
  }
  return respond({ ok: true });
}

function saveInventory(data) {
  const sheet = SS.getSheetByName('庫存登記');
  const timestamp = now();
  const rows = data.items.map(item => [
    "'" + data.date, timestamp, item.name, item.qty,
    item.openDate ? ("'" + item.openDate) : '',
    item.soldOutTime ? ("'" + item.soldOutTime) : '',
    data.isClosing ? '閉店' : data.isOpening ? '開局' : ''
  ]);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 7).setValues(rows);
  sendLineNotify('📋 分店已完成今日庫存登記。');
  return respond({ ok: true });
}

function getInventory(date) {
  const sheet = SS.getSheetByName('庫存登記');
  if (sheet.getLastRow() <= 1) return respond({ items: [], openingItems: [], todayUpdated: false, updateTime: '' });
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  const targetDate = date || today();
  const latestMap = {};
  const openingMap = {};
  rows.forEach(r => {
    const name = toStr(r[2]);
    if (!name) return;
    const entry = { name, qty: r[3], openDate: toStr(r[4]), soldOutTime: r[5] instanceof Date ? Utilities.formatDate(r[5], Session.getScriptTimeZone(), 'HH:mm') : toStr(r[5]) };
    latestMap[name] = entry;
    if (toStr(r[0]) === targetDate && toStr(r[6]) === '開局') {
      openingMap[name] = entry;
    }
  });
  const todayRows = rows.filter(r => toStr(r[0]) === targetDate);
  const todayUpdated = todayRows.length > 0;
  const updateTime = todayUpdated ? toDateTime(todayRows[todayRows.length - 1][1]) : '';
  return respond({ items: Object.values(latestMap), openingItems: Object.values(openingMap), todayUpdated, updateTime });
}

// ── 以下三個函式已更新：支援一天多張叫貨單 + 確認出貨自動更新庫存 ──

function submitOrder(data) {
  const orderSheet  = SS.getSheetByName('叫貨單');
  const detailSheet = SS.getSheetByName('叫貨明細');
  const date = data.date || today();
  const datePrefix = date.replace(/\//g, '');
  const timestamp = now();
  const existing = orderSheet.getLastRow() > 1
    ? orderSheet.getRange(2, 1, orderSheet.getLastRow() - 1, 1).getValues().flat().map(String)
    : [];
  const todayCount = existing.filter(id => id.startsWith(datePrefix)).length;
  const orderId = datePrefix + '-' + (todayCount + 1);
  orderSheet.appendRow([orderId, "'" + date, timestamp, '', '', '已申請']);
  const rows = data.items.map(item => [orderId, item.cat, item.name, item.qty, '', '']);
  if (rows.length > 0) {
    detailSheet.getRange(detailSheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  }
  sendLineNotify('📦 分店已送出叫貨申請，請至系統審核。');
  return respond({ ok: true, orderId });
}

function getOrder(params) {
  const orderSheet  = SS.getSheetByName('叫貨單');
  const detailSheet = SS.getSheetByName('叫貨明細');
  if (orderSheet.getLastRow() <= 1) return respond({ found: false, totalCount: 0 });
  const orders = orderSheet.getRange(2, 1, orderSheet.getLastRow() - 1, 6).getValues();

  let order, totalCount = 0;
  if (params.orderId) {
    order = orders.find(r => String(r[0]) === params.orderId);
    if (!order) return respond({ found: false, totalCount: 0 });
    totalCount = 1;
  } else {
    const datePrefix = (params.date || params || today()).replace(/\//g, '');
    const todayOrders = orders.filter(r => String(r[0]).startsWith(datePrefix));
    totalCount = todayOrders.length;
    if (totalCount === 0) return respond({ found: false, totalCount: 0 });
    order = todayOrders[todayOrders.length - 1];
  }

  const orderId = String(order[0]);
  const details = detailSheet.getLastRow() > 1
    ? detailSheet.getRange(2, 1, detailSheet.getLastRow() - 1, 6).getValues()
        .filter(r => String(r[0]) === orderId)
        .map(r => ({ cat: toStr(r[1]), name: toStr(r[2]), requested: r[3], shipped: r[4], arrived: r[5] }))
    : [];
  return respond({
    found: true, orderId,
    date: toStr(order[1]),
    requestTime: toDateTime(order[2]),
    shippingTime: toDateTime(order[3]),
    arrivalTime: toDateTime(order[4]),
    status: toStr(order[5]),
    totalCount,
    items: details
  });
}

function confirmShipping(data) {
  const orderSheet  = SS.getSheetByName('叫貨單');
  const detailSheet = SS.getSheetByName('叫貨明細');
  const invSheet    = SS.getSheetByName('庫存登記');
  const orderId = data.orderId;

  // 更新叫貨單狀態
  const orders = orderSheet.getRange(2, 1, orderSheet.getLastRow() - 1, 6).getValues();
  for (let i = 0; i < orders.length; i++) {
    if (String(orders[i][0]) === orderId) {
      orderSheet.getRange(i + 2, 4).setValue(now());
      orderSheet.getRange(i + 2, 6).setValue('已出貨');
      break;
    }
  }

  // 更新明細出貨量，同時收集茶品出貨資訊
  const details = detailSheet.getRange(2, 1, detailSheet.getLastRow() - 1, 6).getValues();
  const shippedTea = {};
  for (let i = 0; i < details.length; i++) {
    if (String(details[i][0]) === orderId) {
      const item = data.items.find(d => d.name === toStr(details[i][2]));
      if (item !== undefined) {
        if (item.requested !== undefined) detailSheet.getRange(i + 2, 4).setValue(item.requested);
        detailSheet.getRange(i + 2, 5).setValue(item.shipped);
        if (toStr(details[i][1]) === '茶品' && Number(item.shipped) > 0) {
          shippedTea[toStr(details[i][2])] = Number(item.shipped);
        }
      }
    }
  }

  // 自動更新庫存：出貨量加到現有庫存，保留開桶日與完售時間
  if (Object.keys(shippedTea).length > 0) {
    const invRows = invSheet.getLastRow() > 1
      ? invSheet.getRange(2, 1, invSheet.getLastRow() - 1, 7).getValues()
      : [];
    const currentInv = {};
    invRows.forEach(r => {
      const name = toStr(r[2]);
      if (name) currentInv[name] = {
        qty: Number(r[3]) || 0,
        openDate: toStr(r[4]),
        soldOutTime: r[5] instanceof Date ? Utilities.formatDate(r[5], Session.getScriptTimeZone(), 'HH:mm') : toStr(r[5])
      };
    });
    const timestamp = now();
    const todayDate = today();
    const newRows = Object.entries(shippedTea).map(([name, shipped]) => {
      const cur = currentInv[name] || { qty: 0, openDate: '', soldOutTime: '' };
      return [
        "'" + todayDate, timestamp, name, cur.qty + shipped,
        cur.openDate ? ("'" + cur.openDate) : '',
        cur.soldOutTime ? ("'" + cur.soldOutTime) : '',
        '補給後'
      ];
    });
    if (newRows.length > 0) {
      invSheet.getRange(invSheet.getLastRow() + 1, 1, newRows.length, 7).setValues(newRows);
    }
  }

  sendLineNotify('🚚 叫貨已確認出貨，等待分店確認到貨。');
  return respond({ ok: true });
}

// ── 以上三個函式已更新 ──

function confirmArrival(data) {
  const orderSheet  = SS.getSheetByName('叫貨單');
  const detailSheet = SS.getSheetByName('叫貨明細');
  const orderId = data.orderId;
  const orders = orderSheet.getRange(2, 1, orderSheet.getLastRow() - 1, 6).getValues();
  for (let i = 0; i < orders.length; i++) {
    if (String(orders[i][0]) === orderId) {
      orderSheet.getRange(i + 2, 5).setValue(now());
      orderSheet.getRange(i + 2, 6).setValue('已完結');
      break;
    }
  }
  const details = detailSheet.getRange(2, 1, detailSheet.getLastRow() - 1, 6).getValues();
  for (let i = 0; i < details.length; i++) {
    if (String(details[i][0]) === orderId) {
      const item = data.items.find(d => d.name === toStr(details[i][2]));
      if (item !== undefined) detailSheet.getRange(i + 2, 6).setValue(item.arrived);
    }
  }
  sendLineNotify('✅ 分店已確認到貨，本單完結。');
  return respond({ ok: true });
}

function getSoldOutHistory(params) {
  const sheet = SS.getSheetByName('庫存登記');
  if (sheet.getLastRow() <= 1) return respond({ records: [] });
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();

  const start = (params.startDate || '').replace(/\//g, '');
  const end   = (params.endDate   || '').replace(/\//g, '');

  // Group rows by date+name
  const grouped = {};
  rows.forEach(r => {
    const date = toStr(r[0]).replace(/\//g, '');
    if (!date) return;
    if (start && date < start) return;
    if (end   && date > end)   return;
    const name = toStr(r[2]);
    if (!name) return;
    const key = date + '|' + name;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({
      timestamp: r[1],
      qty: Number(r[3]) || 0,
      soldOutTime: r[5] instanceof Date
        ? Utilities.formatDate(r[5], Session.getScriptTimeZone(), 'HH:mm')
        : toStr(r[5]),
      tag: toStr(r[6])
    });
  });

  const records = [];
  Object.keys(grouped).sort().forEach(key => {
    const [date, name] = key.split('|');
    const entries = grouped[key];

    // Opening qty from 開局 tag
    const openingEntry = entries.find(e => e.tag === '開局');
    const openingQty = openingEntry ? openingEntry.qty : null;

    // Sold-out time from any entry with soldOutTime filled
    const soldOutEntry = entries.find(e => e.soldOutTime);
    const soldOutTime = soldOutEntry ? soldOutEntry.soldOutTime : '';

    // Closing qty from 閉店 tag
    const closingEntry = entries.find(e => e.tag === '閉店');
    const closingQty = closingEntry ? closingEntry.qty : null;

    // 追加: if there's a soldOutTime entry AND a later entry without soldOutTime with qty > 0
    let addedAt = '';
    if (soldOutEntry) {
      const soldOutTime_ = soldOutEntry.timestamp;
      const laterEntry = entries.find(e =>
        !e.soldOutTime && e.qty > 0 && e.timestamp > soldOutTime_ && e.tag !== '閉店'
      );
      if (laterEntry) addedAt = soldOutTime; // time when sold out before restock

      // Revised opening: 開局 qty + 追加 qty
      if (laterEntry && openingEntry) {
        // openingQty already set; add追加 batch
        const addedQty = laterEntry.qty;
        records.push({ date, name, openingQty: openingEntry.qty + addedQty, soldOutTime, closingQty, addedAt });
        return;
      }
    }

    records.push({ date, name, openingQty, soldOutTime, closingQty, addedAt });
  });

  return respond({ records });
}

function deleteOrder(data) {
  const orderSheet  = SS.getSheetByName('叫貨單');
  const detailSheet = SS.getSheetByName('叫貨明細');
  const orderId = data.orderId;
  // Delete from 叫貨單 (reverse to avoid row shift issues)
  const orders = orderSheet.getLastRow() > 1
    ? orderSheet.getRange(2, 1, orderSheet.getLastRow() - 1, 1).getValues() : [];
  for (let i = orders.length - 1; i >= 0; i--) {
    if (String(orders[i][0]) === orderId) {
      orderSheet.deleteRow(i + 2);
      break;
    }
  }
  // Delete from 叫貨明細
  if (detailSheet.getLastRow() > 1) {
    const details = detailSheet.getRange(2, 1, detailSheet.getLastRow() - 1, 1).getValues();
    for (let i = details.length - 1; i >= 0; i--) {
      if (String(details[i][0]) === orderId) {
        detailSheet.deleteRow(i + 2);
      }
    }
  }
  return respond({ ok: true });
}

function getHistory() {
  const orderSheet = SS.getSheetByName('叫貨單');
  if (orderSheet.getLastRow() <= 1) return respond({ records: [] });
  const rows = orderSheet.getRange(2, 1, orderSheet.getLastRow() - 1, 6).getValues();
  const records = rows.filter(r => r[0]).map(r => ({
    orderId: String(r[0]), date: toStr(r[1]),
    requestTime: toDateTime(r[2]), shippingTime: toDateTime(r[3]),
    arrivalTime: toDateTime(r[4]), status: toStr(r[5])
  })).reverse();
  return respond({ records });
}

function updateOrder(data) {
  const orderSheet  = SS.getSheetByName('叫貨單');
  const detailSheet = SS.getSheetByName('叫貨明細');
  const orderId = data.orderId;
  const timestamp = now();

  if (orderSheet.getLastRow() > 1) {
    const orders = orderSheet.getRange(2, 1, orderSheet.getLastRow() - 1, 6).getValues();
    for (let i = 0; i < orders.length; i++) {
      if (String(orders[i][0]) === orderId) {
        orderSheet.getRange(i + 2, 3).setValue(timestamp);
        break;
      }
    }
  }

  const lastRow = detailSheet.getLastRow();
  const shippedMap = {};
  const rowsToDelete = [];

  if (lastRow > 1) {
    const details = detailSheet.getRange(2, 1, lastRow - 1, 6).getValues();
    for (let i = 0; i < details.length; i++) {
      if (String(details[i][0]) === orderId) {
        const key = toStr(details[i][1]) + '|' + toStr(details[i][2]);
        shippedMap[key] = [details[i][4], details[i][5]];
        rowsToDelete.push(i + 2);
      }
    }
  }

  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    detailSheet.deleteRow(rowsToDelete[i]);
  }

  const rows = [];
  data.items.forEach(item => {
    if (item.cat === '配料') {
      rows.push([orderId, item.cat, item.name, item.qty, '', '']);
    } else if (Number(item.qty) > 0) {
      const key = item.cat + '|' + item.name;
      const prev = shippedMap[key] || ['', ''];
      rows.push([orderId, item.cat, item.name, item.qty, prev[0], prev[1]]);
    }
  });

  if (rows.length > 0) {
    detailSheet.getRange(detailSheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  }

  sendLineNotify('📦 分店已更新叫貨申請，請至系統確認。');
  return respond({ ok: true });
}

function addWaste(data) {
  const sheet = SS.getSheetByName('報廢紀錄');
  const id = 'W' + Date.now();
  const dt = now();
  const date = dt.split(' ')[0];
  const time = dt.split(' ')[1];
  sheet.appendRow([id, date, time, data.cat, data.name, Number(data.qty) || 1, data.reason || '']);
  return respond({ ok: true });
}

function getWasteHistory(data) {
  const sheet = SS.getSheetByName('報廢紀錄');
  const last = sheet.getLastRow();
  if (last < 2) return respond({ records: [] });
  const rows = sheet.getRange(2, 1, last - 1, 7).getValues();
  const records = rows
    .filter(r => r[0])
    .map(r => ({
      id:       toStr(r[0]),
      date:     toStr(r[1]),
      datetime: toStr(r[1]) + ' ' + toStr(r[2]),
      cat:      toStr(r[3]),
      name:     toStr(r[4]),
      qty:      r[5],
      reason:   toStr(r[6]),
    }))
    .reverse();
  return respond({ records });
}

function getAll(params) {
  const date = params.date || today();
  const items = JSON.parse(getItems().getContent());
  const inv   = JSON.parse(getInventory(date).getContent());
  const order = JSON.parse(getOrder(date).getContent());
  return respond({ items, inv, order });
}

function getDailyData(params) {
  const date = params.date || today();
  const inv   = JSON.parse(getInventory(date).getContent());
  const order = JSON.parse(getOrder(date).getContent());
  return respond({ inv, order });
}

function ping() {
  // 保持熱機，防止 cold start
}

const LINE_TOKEN    = 'Ol7yFXZIy+p+4SPujfSwcRl6heC54yah36nf83si9sMntzGKQUSpuMW3YFh5HdZlUtjoJa6kmuYfT+bEHKVCf28L/gD5aAB1uODaq7PysM4fbj41HdwOysDaWqXhMLIwCXUyLw3aUMWczDSlz5+LOAdB04t89/1O/w1cDnyilFU=';
const LINE_USER_ID  = 'U3a34970d376ff2c2cf1559cf975f8656';
const LINE_GROUP_ID = 'Cd095b6f04e03f92180078076fc9d1f6d';

function sendLineNotify(message) {
  return;
}

function testNotify() {
  sendLineNotify('📦 測試通知，群組收到請回覆。');
}