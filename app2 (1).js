/**
 * ============================================================
 *  app.js — 作業指示書管理システム v2 メインロジック
 * ============================================================
 */

// ─── Supabase初期化 ───────────────────────────────────────────
let sb      = null;
let sbReady = false;

function initSupabase() {
  try {
    sb      = window.supabase.createClient(SUPABASE.URL, SUPABASE.ANON_KEY);
    sbReady = true;
  } catch(e) { console.log('Supabase初期化エラー:', e); }
}

// ─── アプリ状態 ───────────────────────────────────────────────
let S = {
  items: {
    notice: [...DEF_NOTICE],
    work:   [...DEF_WORK],
  },
  skItems:            JSON.parse(JSON.stringify(DEF_SK)),
  skTruckItems:       JSON.parse(JSON.stringify(DEF_SK_TRUCK)),
  truckRepairItems:   [...DEF_TRUCK_REPAIR],
  carRepairItems:     [...DEF_CAR_REPAIR],
  airconRepairItems:  [...DEF_AIRCON_REPAIR],
  insuranceCompanies: [],
  preventOkNg:        {},
  orders:             [],
  checkState:         { notice:{}, work:{} },
  carRepairCheckState:{},
  truckCheckState:    {},
  airconCheckState:   {},
  skCheckState:       {},
  skTruckCheckState:  {},
  skTruckNotice:      {},
  skTruckPrevent:     {},
  skTruckLights:      {},
  counter:            {},
};

let currentSubStaff = [];
let currentOrder    = null;

// ─── ローカルストレージ ───────────────────────────────────────
function loadState() {
  try {
    const s = localStorage.getItem('ws3_state');
    if (s) {
      const p = JSON.parse(s);
      S = { ...S, ...p };
      if (!S.items.notice?.length) S.items.notice = [...DEF_NOTICE];
      if (!S.items.work?.length)   S.items.work   = [...DEF_WORK];
      if (!S.skItems?.length)      S.skItems      = JSON.parse(JSON.stringify(DEF_SK));
      if (!S.counter)              S.counter      = {};
    }
  } catch(e) {}
}

function saveState() {
  _dniCache.t = 0;
  const toSave = { ...S, orders: [] };
  localStorage.setItem('ws3_state', JSON.stringify(toSave));
}

// ─── トースト通知 ─────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = 'info', duration = 3000) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  if (toastTimer) clearTimeout(toastTimer);
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { toast.classList.add('show'); });
  });
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

function hideToast() {
  const toast = document.getElementById('toast');
  if (toast) toast.classList.remove('show');
  if (toastTimer) clearTimeout(toastTimer);
}

// ─── 二重保存防止 ─────────────────────────────────────────────
let isSaving = false;

function setSaving(btnId, saving) {
  isSaving = saving;
  const btn = document.getElementById(btnId);
  if (!btn) return;
  if (saving) {
    btn.disabled = true;
    btn.classList.add('btn-saving');
    btn.dataset.origText = btn.textContent;
    btn.textContent = '保存中...';
  } else {
    btn.disabled = false;
    btn.classList.remove('btn-saving');
    btn.textContent = btn.dataset.origText || '💾 保存する';
  }
}

// ─── Supabase CRUD ────────────────────────────────────────────
// ─── 汎用の耐障害性のある書き込み（注文以外の全テーブル用） ──────────────────
function getPendingWrites() {
  try { return JSON.parse(localStorage.getItem('ws3_pending_writes') || '[]'); } catch(e) { return []; }
}
function setPendingWrites(list) { localStorage.setItem('ws3_pending_writes', JSON.stringify(list)); }
function queuePendingWrite(item) { const list = getPendingWrites(); list.push(item); setPendingWrites(list); }
async function sbWriteOnce(table, op, payload, matchId) {
  if (op === 'insert') { const { error } = await sb.from(table).insert(payload); if (error) throw error; }
  else if (op === 'update') { const { error } = await sb.from(table).update(payload).eq('id', matchId); if (error) throw error; }
  else if (op === 'delete') { const { error } = await sb.from(table).delete().eq('id', matchId); if (error) throw error; }
}
async function sbWrite(table, op, payload, matchId, _attempt) {
  if (!sb) { queuePendingWrite({ table, op, payload, matchId }); return false; }
  _attempt = _attempt || 1;
  try { await sbWriteOnce(table, op, payload, matchId); return true; }
  catch(e) {
    console.log('Supabase書き込みエラー:', table, op, e);
    if (_attempt < 3) {
      await new Promise(res => setTimeout(res, 1000 * _attempt));
      return sbWrite(table, op, payload, matchId, _attempt + 1);
    }
    queuePendingWrite({ table, op, payload, matchId });
    return false;
  }
}
async function flushPendingWrites() {
  const list = getPendingWrites();
  if (!list.length || !sb) return;
  const remaining = [];
  for (const item of list) {
    try { await sbWriteOnce(item.table, item.op, item.payload, item.matchId); }
    catch(e) { remaining.push(item); }
  }
  setPendingWrites(remaining);
  if (remaining.length === 0 && list.length > 0) showToast(`✅ 保留中だった${list.length}件を送信しました`, 'success');
}

async function sbSaveOrderOnce(order) {
  const { error } = await sb.from(DB_TABLES.KIROKU).upsert({
    id: order.id, order_num: order.orderNum, order_type: order.type,
    status: order.status, cust_name: order.custName, car_name: order.carName,
    car_plate: order.carPlate, date_in: order.dateIn || null, date_out: order.dateOut || null,
    mech_name: order.mechName, mech_id: order.mechId,
    sub_staff: order.subStaff || [],
    reception_name: order.receptionName, remarks: order.remarks,
    insurance: order.insurance, repair_type: order.repairType,
    car_items: order.carItems, truck_items: order.truckItems, aircon_items: order.airconItems,
    notice_items: order.noticeItems, work_items: order.workItems,
    prevent_results: order.preventResults, sk_results: order.skResults,
    sk_truck_check: order.skTruckCheckState, sk_truck_notice: order.skTruckNotice,
    sk_truck_prevent: order.skTruckPrevent, sk_truck_lights: order.skTruckLights,
    saved_at: order.savedAt, completed_at: order.completedAt || null,
    nyuko_method: order.nyukoMethod||'', nyuko_time: order.nyukoTime||'',
    nyuko_place: order.nyukoPlace||'', parts_pending: order.partsPending||false,
    planned_staff: order.plannedStaff||'', invoice_done: order.invoiceDone||false, record_done: order.recordDone||false, bookmarked: order.bookmarked||false, progress: order.progress||[],
  });
  if (error) throw error;
}
function getPendingOrders() {
  try { return JSON.parse(localStorage.getItem('ws3_pending_orders') || '[]'); } catch(e) { return []; }
}
function setPendingOrders(list) {
  localStorage.setItem('ws3_pending_orders', JSON.stringify(list));
}
function queuePendingOrder(order) {
  const list = getPendingOrders().filter(o => o.id !== order.id);
  list.push(order);
  setPendingOrders(list);
}
function removePendingOrder(id) {
  setPendingOrders(getPendingOrders().filter(o => o.id !== id));
}
async function flushPendingOrders() {
  const list = getPendingOrders();
  if (!list.length || !sb) return;
  for (const order of list) {
    try { await sbSaveOrderOnce(order); removePendingOrder(order.id); }
    catch(e) { console.log('保留中の指示書、再送信も失敗:', order.orderNum, e); }
  }
}
async function sbSaveOrder(order, _attempt) {
  if (!sb) { queuePendingOrder(order); return false; }
  _attempt = _attempt || 1;
  try {
    await sbSaveOrderOnce(order);
    removePendingOrder(order.id);
    return true;
  } catch(e) {
    console.log('Supabase保存エラー:', e);
    if (_attempt < 3) {
      await new Promise(res => setTimeout(res, 1000 * _attempt));
      return sbSaveOrder(order, _attempt + 1);
    }
    queuePendingOrder(order);
    return false;
  }
}

function _rowToOrder(row) {
  return {
      id: row.id, orderNum: row.order_num, type: row.order_type, status: row.status,
      custName: row.cust_name, carName: row.car_name, carPlate: row.car_plate,
      dateIn: row.date_in, dateOut: row.date_out,
      mechName: row.mech_name, mechId: row.mech_id,
      subStaff: row.sub_staff || [],
      receptionName: row.reception_name, remarks: row.remarks, insurance: row.insurance,
      repairType: row.repair_type,
      carItems: row.car_items || [], truckItems: row.truck_items || [],
      airconItems: row.aircon_items || [], noticeItems: row.notice_items || [],
      workItems: row.work_items || [], preventResults: row.prevent_results || {},
      skResults: row.sk_results || {}, skTruckCheckState: row.sk_truck_check || {},
      skTruckNotice: row.sk_truck_notice || {}, skTruckPrevent: row.sk_truck_prevent || {},
      skTruckLights: row.sk_truck_lights || {}, savedAt: row.saved_at, completedAt: row.completed_at||'',
      nyukoMethod: row.nyuko_method || '', nyukoTime: row.nyuko_time || '',
      nyukoPlace: row.nyuko_place || '', partsPending: row.parts_pending || false,
      plannedStaff: row.planned_staff || '', invoiceDone: row.invoice_done || false, recordDone: row.record_done || false, bookmarked: row.bookmarked || false, progress: row.progress || [],
  };
}

async function sbLoadOrders(loadAll, monthFilter) {
  if (!sb) return null;
  try {
    let query = sb.from(DB_TABLES.KIROKU).select('*').order('created_at', { ascending: false });
    if (monthFilter) {
      // 指定月の入庫日 ＋ まだ完了していないもの（他の月の入庫予定でも）を両方取得する
      const start = monthFilter + '-01';
      const [y, m] = monthFilter.split('-').map(Number);
      const nextMonth = m === 12 ? `${y+1}-01-01` : `${y}-${String(m+1).padStart(2,'0')}-01`;
      query = query.or(`and(date_in.gte.${start},date_in.lt.${nextMonth}),and(status.neq.完了,status.neq.引渡済)`);
    } else if (!loadAll) {
      // デフォルトは今月の入庫分 ＋ まだ完了していないもの（月をまたぐ入庫予定を見失わないため）
      const now = new Date();
      const thisMonth = _todayStr().slice(0,7);
      const start = thisMonth + '-01';
      const y = now.getFullYear(), m = now.getMonth() + 1;
      const nextMonth = m === 12 ? `${y+1}-01-01` : `${y}-${String(m+1).padStart(2,'0')}-01`;
      query = query.or(`and(date_in.gte.${start},date_in.lt.${nextMonth}),and(status.neq.完了,status.neq.引渡済)`);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data.map(_rowToOrder);
  } catch(e) { console.log('Supabase読み込みエラー:', e); return null; }
}

async function sbDeleteOrder(id) {
  if (!sb) { queuePendingWrite({ table: DB_TABLES.KIROKU, op: 'delete', payload: null, matchId: id }); return false; }
  const ok = await sbWrite(DB_TABLES.KIROKU, 'delete', null, id);
  return ok;
}

// ─── 写真管理 ────────────────────────────────────────────────
let photoCounter = 0;

// ─── 写真の保存先（Supabase Storage）────────────────────────
// 新しい写真は Storage に置き、データベースには URL だけ保存する（一覧・詳細が軽くなる）
// Storage が使えない時（オフライン・未設定）は従来どおりデータベースに直接保存する
const PHOTO_BUCKET = 'sagyou-photos';
var _storageReady = null; // null=未確認 / false=未設定
function _photoSrc(p) { return p.photo_url || p.photo_b64 || ''; }
function _dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
function _storagePathFromUrl(url) {
  const key = `/object/public/${PHOTO_BUCKET}/`;
  const i = (url || '').indexOf(key);
  return i >= 0 ? decodeURIComponent(url.slice(i + key.length).split('?')[0]) : '';
}
async function _uploadPhotoToStorage(orderId, dataUrl) {
  if (!sb || !sbReady || !sb.storage || _storageReady === false || navigator.onLine === false) return null;
  try {
    const path = `${orderId}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.jpg`;
    const { error } = await sb.storage.from(PHOTO_BUCKET).upload(path, _dataUrlToBlob(dataUrl), { contentType: 'image/jpeg', upsert: false });
    if (error) throw error;
    _storageReady = true;
    return sb.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch (e) {
    console.log('Storage保存エラー（データベースに直接保存します）:', e);
    if (/bucket not found/i.test(e?.message || '')) _storageReady = false;
    return null;
  }
}
async function _buildPhotoRows(orderId, list) {
  return Promise.all(list.map(async ({ type, dataUrl }) => {
    const url = await _uploadPhotoToStorage(orderId, dataUrl);
    return url
      ? { kiroku_id: orderId, photo_type: type, photo_b64: '', photo_url: url, memo: '' }
      : { kiroku_id: orderId, photo_type: type, photo_b64: dataUrl, memo: '' };
  }));
}

async function loadPhotosForOrder(orderId) {
  if (!sb) return [];
  try {
    const { data, error } = await sb.from(DB_TABLES.PHOTOS).select('*').eq('kiroku_id', orderId).order('created_at');
    if (error) throw error;
    return data || [];
  } catch(e) { return []; }
}

function _compressAndRun(file, callback) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxW = 1200;
      let w = img.width, h = img.height;
      if (w > maxW) { h = h * maxW / w; w = maxW; }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      callback(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function addPhotoSlot(containerId, type) {
  const fileId = 'photo-file-' + (++photoCounter);
  const input  = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
  input.style.display = 'none'; input.id = fileId;
  document.body.appendChild(input);
  input.onchange = () => {
    Array.from(input.files).forEach(file => {
      const slotId = 'photo-slot-' + (++photoCounter);
      _compressAndRun(file, compressed => {
        const container = document.getElementById(containerId);
        const div = document.createElement('div');
        div.id = slotId;
        div.style.cssText = 'background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px';
        div.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-size:11px;font-weight:700;color:var(--accent)">${type}</span>
            <button onclick="removePhotoSlot('${slotId}')" style="background:none;border:none;color:var(--danger);font-size:16px;cursor:pointer">×</button>
          </div>
          <img src="${compressed}" style="width:100%;border-radius:6px">`;
        if (container) container.appendChild(div);
        window._pendingPhotos = window._pendingPhotos || {};
        window._pendingPhotos[slotId] = { type, dataUrl: compressed };
      });
    });
    input.remove();
  };
  input.click();
}

function removePhotoSlot(slotId) {
  const el = document.getElementById(slotId);
  if (el) { el.remove(); delete (window._pendingPhotos || {})[slotId]; }
}

async function uploadPendingPhotos(orderId) {
  const pending = window._pendingPhotos || {};
  const keys    = Object.keys(pending);
  if (!keys.length || !sb) return;
  const rows = await _buildPhotoRows(orderId, keys.map(k => ({ type: pending[k].type, dataUrl: pending[k].dataUrl })));
  const ok = await sbWrite(DB_TABLES.PHOTOS, 'insert', rows, null);
  if (!ok) showToast('⚠️ 写真の保存に失敗。自動で再送信します', 'error');
  window._pendingPhotos = {};
}

function previewPhoto(inputId, previewId) {
  const file = document.getElementById(inputId).files[0];
  if (!file) return;
  _compressAndRun(file, compressed => {
    document.getElementById(previewId).innerHTML = `<img src="${compressed}" style="width:100%;border-radius:8px;margin-top:4px">`;
    window._pendingPhotos = window._pendingPhotos || {};
    window._pendingPhotos[inputId] = { type: inputId.includes('receipt') ? '納品書' : '修理箇所', dataUrl: compressed };
  });
}

async function deletePhoto(photoId, slotId) {
  if (!confirm('この写真を削除しますか？')) return;
  const slot = document.getElementById(slotId);
  const url  = slot?.querySelector('img')?.dataset.url || '';
  slot?.remove();
  if (sb && photoId) { await sbWrite(DB_TABLES.PHOTOS, 'delete', null, photoId); }
  const path = _storagePathFromUrl(url);
  if (sb && path) { try { await sb.storage.from(PHOTO_BUCKET).remove([path]); } catch(e) {} }
}

function selectAllPhotos(val) { document.querySelectorAll('[id^="photo-check-"]').forEach(cb => cb.checked = val); }

function downloadSelectedPhotos() {
  const checked = document.querySelectorAll('[id^="photo-check-"]:checked');
  if (!checked.length) { showToast('写真を選択してください', 'error'); return; }
  checked.forEach(async (cb, i) => {
    let href = cb.dataset.src;
    // Storage の写真は一度取り込んでから保存（別サイト扱いでファイル名が付かないため）
    if (/^https?:/.test(href)) {
      try { href = URL.createObjectURL(await (await fetch(href)).blob()); } catch(e) {}
    }
    const a = document.createElement('a');
    a.href = href; a.download = `${cb.dataset.type||'写真'}_${i+1}.jpg`; a.click();
  });
}

// ─── 自動採番（データベース基準） ─────────────────────────────
async function fetchNextOrderNum() {
  const year = new Date().getFullYear();
  let maxN = 0;
  if (sb) {
    try {
      const { data, error } = await sb
        .from(DB_TABLES.KIROKU)
        .select('order_num,created_at')
        .gte('created_at', `${year}-01-01`)
        .lt('created_at', `${year+1}-01-01`);
      if (error) throw error;
      (data||[]).forEach(r => {
        if (r.order_num && /^\d+$/.test(r.order_num)) {
          const n = parseInt(r.order_num, 10);
          if (n > maxN) maxN = n;
        }
      });
    } catch(e) { console.log('番号取得エラー:', e); }
  }
  // クラウドにまだ同期できていないローカル保存分も念のため考慮
  (S.orders||[]).forEach(o => {
    if (o.orderNum && /^\d+$/.test(o.orderNum) && String(new Date(o.dateIn||o.savedAt||'').getFullYear())===String(year)) {
      const n = parseInt(o.orderNum, 10);
      if (n > maxN) maxN = n;
    }
  });
  return maxN + 1;
}

async function genOrderNum() {
  // サーバー側で1つずつ採番（同時に保存しても番号が重ならない）
  if (sb && sbReady) {
    try {
      const { data, error } = await sb.rpc('next_order_num');
      if (!error && Number.isInteger(data) && data > 0) return String(data).padStart(4, '0');
      if (error) console.log('サーバー採番エラー（端末側で採番）:', error);
    } catch(e) { console.log('サーバー採番エラー（端末側で採番）:', e); }
  }
  // オフライン・SQL未設定時は従来どおり端末側で計算
  const next = await fetchNextOrderNum();
  return String(next).padStart(4, '0');
}

async function peekOrderNum() {
  const next = await fetchNextOrderNum();
  return String(next).padStart(4, '0');
}

function resetCounter() {
  showToast('番号は共有データベースから自動計算されるため、リセットは不要です', 'info');
}

async function updateNumDisplay() {
  const n = await peekOrderNum();
  ['repairOrderNum','skOrderNum','accOrderNum'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = n;
  });
}

// ─── タブ切り替え ─────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.getElementById('tab-'+tab);
  if (activeTab) activeTab.classList.add('active');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-'+tab)?.classList.add('active');
  if (tab==='list')     loadList();
  if (tab==='settings') renderSettings();
  if (tab==='repair')   { updateNumDisplay(); renderAllChecklists(); renderSubStaffArea(); }
  if (tab==='shakken')  { updateNumDisplay(); renderSkItems(); }
  if (tab==='accident') { updateNumDisplay(); renderInsuranceSelect(); }
  if (tab==='owner')    renderOwnerPanel();
}

function openNewOrderModal() {
  document.getElementById('newOrderModal').classList.add('open');
}
function closeNewOrderModal() {
  document.getElementById('newOrderModal').classList.remove('open');
}

function toggleSection(bodyId, titleEl) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  const arrow = titleEl.querySelector('span');
  if (arrow) arrow.textContent = isOpen ? '▼' : '▲';
}

// ─── 担当者（スタッフ選択式） ────────────────────────────────
async function renderMechSelect(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  let allStaff = [];
  if (sb) {
    try {
      const { data } = await sb.from(DB_TABLES.STAFF).select('id,name,is_owner').order('name');
      allStaff = data || [];
    } catch(e) {}
  }
  const btnStyle = (s) => `padding:10px 16px;border:2px solid var(--border);border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;background:var(--bg);color:var(--text);transition:.12s`;
  el.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">
      ${allStaff.map(s => `
        <button id="mech-btn-${containerId}-${s.id}"
          onclick="selectMech('${containerId}','${jsArg(s.id)}','${jsArg(s.name)}')"
          style="${btnStyle(s)}"
        >${s.is_owner ? '👑' : '👤'} ${esc(s.name)}</button>`).join('')}
    </div>
    <input type="hidden" id="mech-id-${containerId}" value="">
    <input type="hidden" id="mech-name-${containerId}" value="">
  `;
}

function selectMech(containerId, id, name) {
  document.getElementById(`mech-id-${containerId}`).value = id;
  document.getElementById(`mech-name-${containerId}`).value = name;
  // ボタンの見た目を更新
  const parent = document.getElementById(containerId);
  if (!parent) return;
  parent.querySelectorAll('button[id^="mech-btn-"]').forEach(btn => {
    btn.style.background = 'var(--bg)';
    btn.style.color = 'var(--text)';
    btn.style.borderColor = 'var(--border)';
  });
  const selected = document.getElementById(`mech-btn-${containerId}-${id}`);
  if (selected) {
    selected.style.background = 'var(--accent)';
    selected.style.color = '#000';
    selected.style.borderColor = 'var(--accent)';
  }
}

function getMechName(containerId) {
  return document.getElementById(`mech-name-${containerId}`)?.value || '';
}
function getMechId(containerId) {
  return document.getElementById(`mech-id-${containerId}`)?.value || '';
}

// ─── サブ担当 ────────────────────────────────────────────────
async function renderSubStaffArea() {
  const area = document.getElementById('subStaffArea');
  if (!area) return;
  let allStaff = [];
  if (sb) {
    try {
      const { data } = await sb.from(DB_TABLES.STAFF).select('id,name').order('name');
      allStaff = (data || []).filter(s => s.id !== currentUser?.id);
    } catch(e) {}
  }
  const subTags = currentSubStaff.map(s =>
    `<span class="sub-staff-tag">👤 ${esc(s.name)}<button onclick="removeSubStaff('${jsArg(s.id)}')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px;margin-left:4px">×</button></span>`
  ).join('');
  const staffBtns = allStaff
    .filter(s => !currentSubStaff.find(sub => sub.id === s.id))
    .map(s => `<button class="btn btn-gray btn-sm" onclick="addSubStaff('${jsArg(s.id)}','${jsArg(s.name)}')">＋ ${esc(s.name)}</button>`)
    .join('');
  area.innerHTML = `
    <div class="sub-staff-area">
      <div style="color:var(--sub);font-size:11px;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">サブ担当（任意）</div>
      <div class="sub-staff-list" id="subStaffList">${subTags || '<span style="color:var(--sub);font-size:13px">なし</span>'}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${staffBtns}</div>
    </div>`;
}

function addSubStaff(id, name) {
  if (currentSubStaff.find(s => s.id === id)) return;
  currentSubStaff.push({ id, name });
  renderSubStaffArea();
}

function removeSubStaff(id) {
  currentSubStaff = currentSubStaff.filter(s => s.id !== id);
  renderSubStaffArea();
}

// ─── チェックリスト ───────────────────────────────────────────
function renderChecklist(section, id) {
  const c = document.getElementById(id);
  if (!c) return;
  c.innerHTML = '';
  (S.items[section]||[]).forEach(label => {
    const checked = S.checkState[section]?.[label] || false;
    const d = document.createElement('div');
    d.className = 'check-item' + (checked?' checked':'');
    d.innerHTML = `<span>${checked?'✅':'⬜'}</span><span>${label}</span>`;
    d.onclick = () => {
      S.checkState[section] = S.checkState[section]||{};
      S.checkState[section][label] = !S.checkState[section][label];
      renderChecklist(section, id);
    };
    c.appendChild(d);
  });
}

function renderAllChecklists() {
  renderChecklist('notice','check-notice');
  renderPreventOkNg();
  renderChecklist('work','check-work');
}

function renderPreventOkNg() {
  const c = document.getElementById('check-prevent-okng');
  if (!c) return;
  c.innerHTML = DEF_PREVENT_OKNG.map(label => {
    const val = S.preventOkNg?.[label] || '';
    return `<div style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:6px">
      <span style="flex:1;font-size:15px">${label}</span>
      <button onclick="setPreventOkNg('${label}','OK')" style="padding:8px 18px;border:none;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer;background:${val==='OK'?'var(--ok)':'var(--border)'};color:${val==='OK'?'#fff':'var(--sub)'}">OK</button>
      <button onclick="setPreventOkNg('${label}','NG')" style="padding:8px 18px;border:none;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer;background:${val==='NG'?'var(--danger)':'var(--border)'};color:${val==='NG'?'#fff':'var(--sub)'}">NG</button>
    </div>`;
  }).join('');
}

function setPreventOkNg(label, val) {
  S.preventOkNg = S.preventOkNg||{};
  S.preventOkNg[label] = S.preventOkNg[label]===val ? '' : val;
  renderPreventOkNg();
}

// ─── 修理タイプ切り替え ───────────────────────────────────────
let repairType = 'car';

let freezerWorkshop = '';

function setFreezerWorkshop(w) { freezerWorkshop = freezerWorkshop===w?'':w; renderFreezerItems(); }
function renderFreezerItems() {
  const ws = ['DENSO','菱重','トプレック','サーモキング','自社'];
  const we = document.getElementById('repair-freezer-workshop');
  if (we) {
    we.innerHTML = '';
    ws.forEach(function(w) {
      const btn = document.createElement('button');
      btn.textContent = w;
      btn.style.cssText = 'padding:8px 14px;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;margin:3px;background:' + (freezerWorkshop===w?'var(--accent)':'var(--border)') + ';color:' + (freezerWorkshop===w?'#000':'var(--text)');
      btn.onclick = (function(name){ return function(){ setFreezerWorkshop(name); }; })(w);
      we.appendChild(btn);
    });
  }
}

// ─── 3ヶ月点検（トラック専用） ─────────────────────────────────
const DEF_3MONTH_TRUCK_REPAIR = [
  'エンジンオイルエレメント交換','エンジンオイル交換',
  '燃料エレメント交換【メイン】','燃料エレメント交換【サブ】',
  'ブローバイエレメント交換','ベルト調整','バッテリー点検',
];
let threeMonthCheckState = {};

function renderThreeMonthItems() {
  _renderCheckGrid('repair-3month-items', DEF_3MONTH_TRUCK_REPAIR, threeMonthCheckState, label => {
    threeMonthCheckState[label] = !threeMonthCheckState[label];
    renderThreeMonthItems();
  });
}

function switchRepairType(type) {
  repairType = type;
  ['car','truck','aircon','freezer','3month'].forEach(t => {
    document.getElementById('repair-'+t+'-items').style.display = t===type ? '' : 'none';
    document.getElementById('r-tab-'+t).className = 'btn btn-sm ' + (t===type?'btn-primary':'btn-gray');
  });
  if (type==='car')     renderCarRepairItems();
  if (type==='truck')   renderTruckItems();
  if (type==='aircon')  renderAirconItems();
  if (type==='freezer') renderFreezerItems();
  if (type==='3month')  renderThreeMonthItems();
}

// ─── 「種類を選んでください」からのショートカット入場 ───────────
function openRepairItemsSection() {
  const body = document.getElementById('repair-items-body');
  if (!body) return;
  if (body.style.display === 'none') {
    const title = body.previousElementSibling;
    if (title) toggleSection('repair-items-body', title);
  } else {
    body.style.display = 'block';
  }
}

function quickEnter(subtype) {
  closeNewOrderModal();
  switchTab('repair');
  openRepairItemsSection();
  switchRepairType(subtype);
}

function _renderCheckGrid(cid, items, stateObj, onToggle) {
  const c = document.getElementById(cid);
  if (!c) return;
  c.innerHTML = '';
  items.forEach(label => {
    const checked = stateObj?.[label] || false;
    const d = document.createElement('div');
    d.className = 'check-item' + (checked?' checked':'');
    d.innerHTML = `<span>${checked?'✅':'⬜'}</span><span>${label}</span>`;
    d.onclick = () => onToggle(label);
    c.appendChild(d);
  });
}

function renderCarRepairItems() {
  _renderCheckGrid('repair-car-items', S.carRepairItems||DEF_CAR_REPAIR, S.carRepairCheckState, label => {
    S.carRepairCheckState = S.carRepairCheckState||{};
    S.carRepairCheckState[label] = !S.carRepairCheckState[label];
    renderCarRepairItems();
  });
}
function renderAirconItems() {
  _renderCheckGrid('repair-aircon-items', S.airconRepairItems||DEF_AIRCON_REPAIR, S.airconCheckState, label => {
    S.airconCheckState = S.airconCheckState||{};
    S.airconCheckState[label] = !S.airconCheckState[label];
    renderAirconItems();
  });
}
function renderTruckItems() {
  _renderCheckGrid('repair-truck-items', S.truckRepairItems||[], S.truckCheckState, label => {
    S.truckCheckState = S.truckCheckState||{};
    S.truckCheckState[label] = !S.truckCheckState[label];
    renderTruckItems();
  });
}

// ─── 車検 ────────────────────────────────────────────────────
let skType = 'car';

function switchSkType(type) {
  skType = type;
  document.getElementById('sk-car-section').style.display   = type==='car'   ? '' : 'none';
  document.getElementById('sk-truck-section').style.display = type==='truck' ? '' : 'none';
  document.getElementById('sk-tab-car').className   = 'btn btn-sm '+(type==='car'?'btn-primary':'btn-gray');
  document.getElementById('sk-tab-truck').className = 'btn btn-sm '+(type==='truck'?'btn-primary':'btn-gray');
  if (type==='truck') { renderSkTruckItems(); renderSkTruckLights(); renderSkTruckNotice(); renderSkTruckPrevent(); }
}

function renderSkItems() {
  const c = document.getElementById('sk-items'); if (!c) return;
  c.innerHTML = '';
  (S.skItems||[]).forEach((item,idx) => {
    const st   = S.skCheckState[item.label]||{};
    const opts = (item.opts||'良好').split('/');
    const d    = document.createElement('div'); d.className = 'sk-item';
    d.innerHTML = `<span class="sk-item-label">${item.label}</span><div class="sk-btns">${opts.map(o=>`<button class="sk-btn${st.work===o?' sel':''}" onclick="setSkWork(${idx},'${o}')">${o}</button>`).join('')}</div>`;
    c.appendChild(d);
  });
}
function setSkWork(idx, opt) {
  const item = S.skItems[idx];
  S.skCheckState[item.label] = S.skCheckState[item.label]||{};
  S.skCheckState[item.label].work = opt;
  renderSkItems();
}
function renderSkTruckItems() {
  const c = document.getElementById('sk-truck-items'); if (!c) return;
  c.innerHTML = '';
  (S.skTruckItems||DEF_SK_TRUCK).forEach((item,idx) => {
    const st   = S.skTruckCheckState?.[item.label]||{};
    const opts = (item.opts||'交換/不要').split('/');
    const d    = document.createElement('div'); d.className = 'sk-item';
    d.innerHTML = `<span class="sk-item-label">${item.label}</span><div class="sk-btns">${opts.map(o=>`<button class="sk-btn${st.work===o?' sel':''}" onclick="setSkTruckWork(${idx},'${o}')">${o}</button>`).join('')}</div>`;
    c.appendChild(d);
  });
}
function setSkTruckWork(idx, opt) {
  const item = (S.skTruckItems||DEF_SK_TRUCK)[idx];
  S.skTruckCheckState = S.skTruckCheckState||{};
  S.skTruckCheckState[item.label] = S.skTruckCheckState[item.label]||{};
  S.skTruckCheckState[item.label].work = opt;
  renderSkTruckItems();
}

function _renderOkNgGrid(cid, items, stateKey, setFn) {
  const c = document.getElementById(cid); if (!c) return;
  const stateObj = S[stateKey]||{};
  c.innerHTML = items.map(label => {
    const val = stateObj[label]||'';
    return `<div style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:6px">
      <span style="flex:1;font-size:15px">${label}</span>
      <button onclick="${setFn}('${label}','OK')" style="padding:8px 18px;border:none;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer;background:${val==='OK'?'var(--ok)':'var(--border)'};color:${val==='OK'?'#fff':'var(--sub)'}">OK</button>
      <button onclick="${setFn}('${label}','NG')" style="padding:8px 18px;border:none;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer;background:${val==='NG'?'var(--danger)':'var(--border)'};color:${val==='NG'?'#fff':'var(--sub)'}">NG</button>
    </div>`;
  }).join('');
}

function renderSkTruckNotice()  { S.skTruckNotice  = S.skTruckNotice||{};  _renderOkNgGrid('sk-truck-notice',  DEF_SK_TRUCK_NOTICE,  'skTruckNotice',  'setSkTruckNotice'); }
function renderSkTruckPrevent() { S.skTruckPrevent = S.skTruckPrevent||{}; _renderOkNgGrid('sk-truck-prevent', DEF_SK_TRUCK_PREVENT, 'skTruckPrevent', 'setSkTruckPrevent'); }
function setSkTruckNotice(l,v)  { S.skTruckNotice[l]  = S.skTruckNotice[l]===v?'':v;  renderSkTruckNotice(); }
function setSkTruckPrevent(l,v) { S.skTruckPrevent[l] = S.skTruckPrevent[l]===v?'':v; renderSkTruckPrevent(); }

function renderSkTruckLights() {
  const c = document.getElementById('sk-truck-lights'); if (!c) return;
  S.skTruckLights = S.skTruckLights||{};
  const headItems  = ['ヘッドライト球（HID）左','ヘッドライト球（HID）右','ヘッドライト球（ハロゲン）左','ヘッドライト球（ハロゲン）右'];
  const countItems = ['ポジション球','ウインカー球','車高灯','ナンバー灯球','マーカー球','マーカーASSY','メーターパネル球','フォグランプ球','スイッチ球'];
  let html = '';
  headItems.forEach(label => {
    const val = S.skTruckLights[label]||'';
    html += `<div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--border);flex-wrap:wrap">
      <span style="flex:1;min-width:100px;font-size:13px">${label}</span>
      <div style="display:flex;gap:4px">
        <button class="sk-btn${val==='交換'?' sel':''}" onclick="setSkTruckLight('${label}','交換')">交換</button>
        <button class="sk-btn${val==='不要'?' sel':''}" onclick="setSkTruckLight('${label}','不要')">不要</button>
      </div></div>`;
  });
  countItems.forEach(label => {
    const val  = S.skTruckLights[label]||'';
    const opts = ['不要','1個','2個','3個','4個','5個'];
    html += `<div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--border);flex-wrap:wrap">
      <span style="flex:1;min-width:100px;font-size:13px">${label}</span>
      <div style="display:flex;gap:4px;flex-wrap:wrap">${opts.map(o=>`<button class="sk-btn${val===o?' sel':''}" onclick="setSkTruckLight('${label}','${o}')">${o}</button>`).join('')}</div></div>`;
  });
  c.innerHTML = html;
}
function setSkTruckLight(label, val) {
  S.skTruckLights = S.skTruckLights||{};
  S.skTruckLights[label] = S.skTruckLights[label]===val ? '' : val;
  renderSkTruckLights();
}

// ─── マスタ管理 ───────────────────────────────────────────────
async function loadMasters() {
  if (!sb) return;
  try {
    const { data, error } = await sb.from(DB_TABLES.MASTERS).select('*').order('created_at');
    if (error) throw error;
    const customers = data.filter(d => d.category==='customer');
    const cars      = data.filter(d => d.category==='car');
    document.getElementById('custNameList').innerHTML = customers.map(c=>`<option value="${esc(c.name)}">`).join('');
    document.getElementById('carNameList').innerHTML  = cars.map(c=>`<option value="${esc(c.name)}">`).join('');
  } catch(e) { console.log('マスター読み込みエラー:', e); }
}

async function addCustomer() {
  const cust = document.getElementById('newCustName').value.trim();
  const car  = document.getElementById('newCarName').value.trim();
  if (!cust && !car) return;
  if (!sb) { showToast('Supabaseに接続されていません', 'error'); return; }
  const rows = [];
  if (cust) rows.push({ category:'customer', name:cust });
  if (car)  rows.push({ category:'car',      name:car  });
  const ok = await sbWrite(DB_TABLES.MASTERS, 'insert', rows, null);
  document.getElementById('newCustName').value = '';
  document.getElementById('newCarName').value  = '';
  await loadMasters();
  showToast(ok ? '登録しました' : '⚠️ 通信失敗。自動で再送信します', ok ? 'success' : 'error');
}

async function removeMaster(id) {
  if (!sb) return;
  const ok = await sbWrite(DB_TABLES.MASTERS, 'delete', null, id);
  await loadMasters();
  showToast(ok ? '削除しました' : '⚠️ 通信失敗。自動で再送信します', ok ? 'info' : 'error');
}

// ─── スタッフ管理 ─────────────────────────────────────────────
async function loadStaffForSettings() {
  if (!sb) return;
  try {
    const { data, error } = await sb.from(DB_TABLES.STAFF).select('id,name,is_owner').order('is_owner', { ascending: false });
    if (error) throw error;
    const el = document.getElementById('staffList');
    if (el) {
      el.innerHTML = data.length
        ? data.map(s => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:6px">
            <span style="font-size:18px">${s.is_owner?'👑':'👤'}</span>
            <div style="flex:1">
              <div style="font-size:15px;font-weight:700">${esc(s.name)}</div>
              <div style="font-size:11px;color:var(--sub)">${s.is_owner?'オーナー':'スタッフ'} · PIN: ●●●●</div>
            </div>
            ${!s.is_owner ? `<button class="btn btn-danger btn-sm" onclick="removeStaff('${jsArg(s.id)}')">削除</button>` : ''}
          </div>`).join('')
        : '<span style="color:var(--sub);font-size:13px">スタッフがいません</span>';
    }
  } catch(e) { console.log('スタッフ読み込みエラー:', e); }
}

async function addStaff() {
  const name = document.getElementById('newStaffName').value.trim();
  const pin  = document.getElementById('newStaffPin').value.trim();
  if (!name || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
    showToast('名前と4桁の数字PINを入力してください', 'error'); return;
  }
  if (!sb) return;
  const id = 'staff_' + Date.now();
  const ok = await sbWrite(DB_TABLES.STAFF, 'insert', [{ id, name, pin, is_owner: false }], null);
  document.getElementById('newStaffName').value = '';
  document.getElementById('newStaffPin').value  = '';
  await loadStaffForSettings();
  showToast(ok ? `${name} を追加しました` : '⚠️ 通信失敗。自動で再送信します', ok ? 'success' : 'error');
}

async function removeStaff(id) {
  if (!confirm('このスタッフを削除しますか？')) return;
  if (!sb) return;
  const ok = await sbWrite(DB_TABLES.STAFF, 'delete', null, id);
  await loadStaffForSettings();
  showToast(ok ? '削除しました' : '⚠️ 通信失敗。自動で再送信します', ok ? 'info' : 'error');
}

// ─── 保険会社 ────────────────────────────────────────────────
function addInsurance() {
  const inp = document.getElementById('newInsurance');
  const name = inp.value.trim();
  if (!name) return;
  S.insuranceCompanies = S.insuranceCompanies||[];
  if (S.insuranceCompanies.includes(name)) return;
  S.insuranceCompanies.push(name);
  inp.value = '';
  saveState();
  renderSettings();
  renderInsuranceSelect();
}
function removeInsurance(i) {
  if (!confirm(`「${S.insuranceCompanies[i]}」を削除しますか？`)) return;
  S.insuranceCompanies.splice(i,1);
  saveState();
  renderSettings();
  renderInsuranceSelect();
}
function renderInsuranceSelect() {
  const sel = document.getElementById('ac-insurance'); if (!sel) return;
  sel.innerHTML = '<option value="">選択してください</option>' +
    (S.insuranceCompanies||[]).map(n=>`<option value="${n}">${n}</option>`).join('');
}

// ─── 設定画面 ────────────────────────────────────────────────
const repairSections = [
  {key:'carRepairItems',    label:'🚗 乗用車', def:DEF_CAR_REPAIR},
  {key:'truckRepairItems',  label:'🚛 トラック', def:DEF_TRUCK_REPAIR},
  {key:'airconRepairItems', label:'❄️ エアコン', def:DEF_AIRCON_REPAIR},
];
let activeRepairTab = 'carRepairItems';

function renderRepairSettingTab() {
  const sec = repairSections.find(s=>s.key===activeRepairTab);
  const el  = document.getElementById('repairSettingContent'); if (!el) return;
  el.innerHTML = `
    <div style="display:flex;gap:6px;margin-bottom:6px">
      <input id="ni-repair" placeholder="新しい項目を追加" style="flex:1;font-size:13px;padding:7px 10px" onkeydown="if(event.key==='Enter')addRepairItem()">
      <button class="btn btn-primary btn-sm" onclick="addRepairItem()">追加</button>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:4px">
      ${(S[sec.key]||sec.def).map((item,i)=>`<span class="staff-tag" style="font-size:12px">${item}<button onclick="removeRepairItem(${i})">×</button></span>`).join('')}
    </div>`;
  repairSections.forEach(s => {
    const btn = document.getElementById('rtab-'+s.key);
    if (btn) btn.className = 'btn btn-sm '+(s.key===activeRepairTab?'btn-primary':'btn-gray');
  });
}
function switchRepairSettingTab(key) { activeRepairTab=key; renderRepairSettingTab(); }
function addRepairItem() {
  const inp = document.getElementById('ni-repair'); const v=inp.value.trim(); if(!v) return;
  const sec = repairSections.find(s=>s.key===activeRepairTab);
  S[activeRepairTab] = S[activeRepairTab]||[...sec.def]; S[activeRepairTab].push(v); inp.value='';
  saveState(); renderRepairSettingTab();
}
function removeRepairItem(i) {
  const sec = repairSections.find(s=>s.key===activeRepairTab);
  S[activeRepairTab] = S[activeRepairTab]||[...sec.def]; S[activeRepairTab].splice(i,1);
  saveState(); renderRepairSettingTab();
}
function addItem(sec) {
  const inp=document.getElementById('ni-'+sec); const v=inp.value.trim(); if(!v) return;
  S.items[sec]=S.items[sec]||[]; S.items[sec].push(v); inp.value='';
  saveState(); renderSettings(); renderAllChecklists();
}
function removeItem(sec,i) { S.items[sec].splice(i,1); saveState(); renderSettings(); renderAllChecklists(); }
function addSkItem() {
  const inp=document.getElementById('newSkItem'); const v=inp.value.trim(); if(!v) return;
  S.skItems.push({label:v,req:false,opts:'良好/要観察/交換'}); inp.value='';
  saveState(); renderSettings();
}
function toggleSkReq(i) { S.skItems[i].req=!S.skItems[i].req; saveState(); renderSettings(); renderSkItems(); }
function removeSkItem(i) { S.skItems.splice(i,1); saveState(); renderSettings(); }

function renderSettings() {
  loadStaffForSettings();
  const snames = {notice:'気がついた事', work:'作業内容'};
  const ic = document.getElementById('itemSettings');
  ic.innerHTML = `
    <div style="margin-bottom:16px">
      <div style="color:var(--accent);font-size:13px;font-weight:700;margin-bottom:8px">依頼事項</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px">
        ${repairSections.map(s=>`<button class="btn btn-sm" id="rtab-${s.key}" onclick="switchRepairSettingTab('${s.key}')">${s.label}</button>`).join('')}
      </div>
      <div id="repairSettingContent"></div>
    </div>` +
    Object.keys(snames).map(sec=>`
    <div style="margin-bottom:16px">
      <div style="color:var(--accent);font-size:13px;font-weight:700;margin-bottom:6px">${snames[sec]}</div>
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <input id="ni-${sec}" placeholder="新しい項目を追加" style="flex:1;font-size:13px;padding:7px 10px" onkeydown="if(event.key==='Enter')addItem('${sec}')">
        <button class="btn btn-primary btn-sm" onclick="addItem('${sec}')">追加</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px">
        ${(S.items[sec]||[]).map((item,i)=>`<span class="staff-tag" style="font-size:12px">${item}<button onclick="removeItem('${sec}',${i})">×</button></span>`).join('')}
      </div>
    </div>`).join('');
  renderRepairSettingTab();

  document.getElementById('shakkenItemSettings').innerHTML = `
    <div style="display:flex;gap:6px;margin-bottom:12px">
      <input id="newSkItem" placeholder="新しい車検項目" style="flex:1;font-size:13px;padding:7px 10px">
      <button class="btn btn-primary btn-sm" onclick="addSkItem()">追加</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${(S.skItems||[]).map((item,i)=>`
        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:8px">
          <span style="flex:1;font-size:14px">${item.label}</span>
          <button onclick="toggleSkReq(${i})" style="padding:5px 12px;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;background:${item.req?'#2e0d0d':'#1a2030'};color:${item.req?'#ff7070':'#7080a0'}">${item.req?'必須':'任意'}</button>
          <button onclick="removeSkItem(${i})" style="background:none;border:none;color:var(--danger);font-size:18px;cursor:pointer">×</button>
        </div>`).join('')}
    </div>`;

  const ic2 = document.getElementById('insuranceSettings');
  if (ic2) ic2.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:8px">
      <input id="newInsurance" placeholder="保険会社名を入力" style="flex:1;font-size:13px;padding:7px 10px" onkeydown="if(event.key==='Enter')addInsurance()">
      <button class="btn btn-primary btn-sm" onclick="addInsurance()">追加</button>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:4px">
      ${(S.insuranceCompanies||[]).map((name,i)=>`<span class="staff-tag" style="font-size:12px">${esc(name)}<button onclick="removeInsurance(${i})">×</button></span>`).join('')}
    </div>`;

  document.getElementById('gasUrl').value = S.gasUrl||'';
  updateSyncUI();
}

function updateSyncUI() {
  ['syncDot','syncDot2'].forEach(id => { const el=document.getElementById(id); if(el) el.classList.toggle('on',sbReady); });
  ['syncLabel','listSyncLabel'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=sbReady?'クラウド同期':'ローカル保存'; });
}
function saveGasUrl() { S.gasUrl=document.getElementById('gasUrl').value.trim(); saveState(); showToast('保存しました','success'); }
function clearGasUrl() { S.gasUrl=''; document.getElementById('gasUrl').value=''; saveState(); showToast('削除しました','info'); }

// ─── 車番から前回の作業を表示 ─────────────────────────────────
const PLATE_FORMS = [
  { plate: 'r-carPlate',  cust: 'r-custName',  car: 'r-carName'  },
  { plate: 'sk-carPlate', cust: 'sk-custName', car: 'sk-carName' },
  { plate: 'ac-carPlate', cust: 'ac-custName', car: 'ac-carName' },
];
const _plateHistTimers = {};
const _plateHistCache  = {};
function _orderTypeLabel(o) {
  if (o.type === 'shakken')  return '車検';
  if (o.type === 'accident') return '事故修理';
  return ({ '3month': '3か月点検', aircon: 'クーラー修理', freezer: '冷凍機修理' })[o.repairType] || '一般修理';
}
function _orderWorkSummary(o) {
  const items = [
    ...(o.carItems||[]), ...(o.truckItems||[]), ...(o.airconItems||[]),
    ...Object.entries(o.skResults||{}).filter(([k,v]) => v && k.trim()).map(([k,v]) => `${k}(${v})`),
    ...(o.workItems||[]),
  ];
  const memo = (o.remarks||'').trim().split('\n')[0];
  return { items, memo };
}
async function fetchPlateHistory(plate) {
  const np = _normPlate(plate);
  if (np.length < 4) return [];
  if (_plateHistCache[np] && Date.now() - _plateHistCache[np].t < 60000) return _plateHistCache[np].list;
  const found = new Map();
  (S.orders||[]).forEach(o => { if (_normPlate(o.carPlate) === np) found.set(o.id, o); });
  const digits = (np.match(/(\d{2,4})$/) || [])[1];
  if (sb && sbReady && digits) {
    try {
      // 末尾2桁で大まかに取ってから、スペース等を無視して完全一致するものだけ残す
      const { data, error } = await sb.from(DB_TABLES.KIROKU)
        .select('id,order_num,order_type,repair_type,status,cust_name,car_name,car_plate,date_in,mech_name,car_items,truck_items,aircon_items,work_items,sk_results,remarks')
        .ilike('car_plate', `%${digits.slice(-2)}%`)
        .order('date_in', { ascending: false })
        .limit(300);
      if (!error) (data||[]).forEach(r => {
        if (_normPlate(r.car_plate) === np && !found.has(r.id)) found.set(r.id, { ..._rowToOrder(r), _partial: true });
      });
    } catch(e) { console.log('履歴取得エラー:', e); }
  }
  const list = [...found.values()].sort((a,b) => (b.dateIn||'').localeCompare(a.dateIn||''));
  _plateHistCache[np] = { t: Date.now(), list };
  return list;
}
async function renderPlateHistory(form) {
  const input = document.getElementById(form.plate); if (!input) return;
  const boxId = form.plate + '-history';
  let box = document.getElementById(boxId);
  const plate = input.value.trim();
  if (_normPlate(plate).length < 4) { box?.remove(); return; }
  const list = await fetchPlateHistory(plate);
  if (input.value.trim() !== plate) return; // 入力が変わっていたら捨てる
  if (!list.length) { box?.remove(); return; }
  if (!box) {
    box = document.createElement('div');
    box.id = boxId; box.className = 'plate-history';
    let anchor = input;
    while (anchor.parentElement && !anchor.parentElement.classList.contains('card')) anchor = anchor.parentElement;
    anchor.after(box);
  }
  const latest = list[0];
  const custEl = document.getElementById(form.cust), carEl = document.getElementById(form.car);
  const canFill = (custEl && !custEl.value.trim() && latest.custName) || (carEl && !carEl.value.trim() && latest.carName);
  box.innerHTML = `
    <div style="margin:10px 0 4px;padding:12px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:14px;font-weight:700;color:#1d4ed8">🕘 この車の過去の作業 ${list.length}件</span>
        ${canFill ? `<button onclick="fillFromHistory('${form.plate}')" style="background:#1d4ed8;color:#fff;border:none;border-radius:8px;padding:7px 10px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">顧客名・車名を入れる</button>` : ''}
      </div>
      ${list.slice(0,3).map(o => {
        const { items, memo } = _orderWorkSummary(o);
        return `<div onclick="openHistoryOrder('${jsArg(o.id)}')" style="background:#fff;border:1px solid #dbeafe;border-radius:8px;padding:9px 10px;margin-bottom:6px;cursor:pointer">
          <div style="font-size:13px;font-weight:700;color:#1e2433">${esc(o.dateIn||'日付なし')}　${_orderTypeLabel(o)}　<span style="color:#64748b;font-weight:600">${esc(o.custName)} ${esc(o.carName)}${o.mechName?'・担当 '+esc(o.mechName):''}</span></div>
          ${items.length ? `<div style="font-size:13px;color:#c2410c;margin-top:3px">🔧 ${esc(items.slice(0,5).join('・'))}${items.length>5?' ほか'+(items.length-5)+'件':''}</div>` : ''}
          ${memo ? `<div style="font-size:12px;color:#64748b;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">📝 ${esc(memo)}</div>` : ''}
        </div>`;
      }).join('')}
      ${list.length>3 ? `<div style="font-size:12px;color:#64748b;text-align:right">ほか${list.length-3}件（一覧で車番検索すると全部見られます）</div>` : ''}
    </div>`;
}
function fillFromHistory(plateId) {
  const form = PLATE_FORMS.find(f => f.plate === plateId); if (!form) return;
  const list = _plateHistCache[_normPlate(document.getElementById(plateId).value)]?.list || [];
  const latest = list[0]; if (!latest) return;
  const custEl = document.getElementById(form.cust), carEl = document.getElementById(form.car);
  if (custEl && !custEl.value.trim()) custEl.value = latest.custName || '';
  if (carEl  && !carEl.value.trim())  carEl.value  = latest.carName  || '';
  renderPlateHistory(form);
  showToast('前回の顧客名・車名を入れました', 'success');
}
async function openHistoryOrder(id) {
  let order = S.orders.find(o => o.id === id);
  if (!order && sb) {
    try {
      const { data, error } = await sb.from(DB_TABLES.KIROKU).select('*').eq('id', id).single();
      if (!error && data) { order = _rowToOrder(data); S.orders.push(order); }
    } catch(e) {}
  }
  if (!order) { showToast('この指示書を開けませんでした', 'error'); return; }
  currentOrder = order;
  openShijishoView(order);
}
function hidePlateHistory(plateId) { document.getElementById(plateId + '-history')?.remove(); }
function setupPlateHistory() {
  PLATE_FORMS.forEach(form => {
    const input = document.getElementById(form.plate);
    if (!input || input.dataset.histReady) return;
    input.dataset.histReady = '1';
    const run = (delay) => {
      clearTimeout(_plateHistTimers[form.plate]);
      _plateHistTimers[form.plate] = setTimeout(() => renderPlateHistory(form), delay);
    };
    input.addEventListener('input',  () => run(600));
    input.addEventListener('change', () => run(0));
  });
}

// ─── 二重作成チェック ─────────────────────────────────────────
// 同じ車でも、入庫日が離れている過去の指示書（例：7月分）は別件なので対象外にする
const DUP_CHECK_DAYS = 14;
function _normPlate(v) {
  return (v||'').normalize('NFKC').replace(/[\s・\-ー－]/g, '');
}
function _orderBaseDate(o) {
  if (o.dateIn) return o.dateIn;
  // 入庫日が空なら作成時刻（id は Date.now()）から日付を出す
  if (/^\d{13}$/.test(o.id||'')) return _isoToJstDateStr(new Date(+o.id).toISOString());
  return '';
}
function _daysBetween(a, b) {
  const da = new Date(a + 'T00:00:00'), db = new Date(b + 'T00:00:00');
  if (isNaN(da) || isNaN(db)) return Infinity;
  return Math.abs(Math.round((da - db) / 86400000));
}
function findRecentDuplicate(plate, custName, carName, dateIn) {
  const p = _normPlate(plate);
  const base = dateIn || _todayStr();
  let best = null, bestDiff = Infinity;
  (S.orders||[]).forEach(o => {
    const same = p
      ? _normPlate(o.carPlate) === p
      : (custName && carName && (o.custName||'').trim()===custName && (o.carName||'').trim()===carName);
    if (!same) return;
    const diff = _daysBetween(_orderBaseDate(o), base);
    if (diff <= DUP_CHECK_DAYS && diff < bestDiff) { best = o; bestDiff = diff; }
  });
  return best;
}
function confirmIfDuplicate(plate, custName, carName, dateIn) {
  const dup = findRecentDuplicate(plate, custName, carName, dateIn);
  if (!dup) return true;
  return confirm(`⚠️ 同じ${plate?'車番':'顧客名・車名'}の指示書が近い日付にあります。\n\n${dup.orderNum||'（番号なし）'}　${dup.custName||''}　${dup.carName||''}${dup.carPlate?'【'+dup.carPlate+'】':''}\n入庫日：${dup.dateIn||'未設定'}　ステータス：${dup.status||'未設定'}\n\nこのまま新しく保存すると、2件に分かれてしまいます。\n本当にこのまま新規保存しますか？`);
}

// ─── 保存：一般修理 ───────────────────────────────────────────
async function saveRepair() {
  if (isSaving) return;
  const custName = document.getElementById('r-custName').value.trim();
  const carName  = document.getElementById('r-carName').value.trim();
  if (!custName && !carName) { showToast('顧客名か車名を入力してください', 'error'); return; }

  // 二重作成の防止：入庫日が近い（前後14日以内）同じ車番の指示書だけを確認する
  const carPlateVal = document.getElementById('r-carPlate').value.trim();
  if (!confirmIfDuplicate(carPlateVal, custName, carName, document.getElementById('r-dateIn').value)) return;

  setSaving('btnSaveRepair', true);
  const preventResults = {};
  DEF_PREVENT_OKNG.forEach(label => { if (S.preventOkNg?.[label]) preventResults[label]=S.preventOkNg[label]; });
  const carItems    = Object.entries(S.carRepairCheckState||{}).filter(([,v])=>v).map(([k])=>k);
  let truckItems  = Object.entries(S.truckCheckState||{}).filter(([,v])=>v).map(([k])=>k);
  const airconItems = Object.entries(S.airconCheckState||{}).filter(([,v])=>v).map(([k])=>k);
  if (repairType==='3month') {
    truckItems = Object.entries(threeMonthCheckState||{}).filter(([,v])=>v).map(([k])=>k);
  }
  let remarksVal = document.getElementById('r-remarks').value;
  if (repairType==='freezer' && freezerWorkshop) {
    remarksVal = `【業者：${freezerWorkshop}】\n` + remarksVal;
  }
  const orderNum    = await genOrderNum();
  const order = {
    id: Date.now().toString(), orderNum, type:'repair', repairType,
    status:    document.getElementById('r-status').value,
    custName, carName,
    carPlate:  document.getElementById('r-carPlate').value,
    dateIn:    document.getElementById('r-dateIn').value,
    dateOut:   document.getElementById('r-dateOut').value,
    nyukoMethod: document.getElementById('r-nyukoMethod')?.value||'',
    nyukoTime:   document.getElementById('r-nyukoTime')?.value||'',
    nyukoPlace:  document.getElementById('r-nyukoPlace')?.value.trim()||'',
    partsPending: document.getElementById('r-partsPending')?.checked||false,
    mechName:  getMechName('mechSelectRepair'),
    mechId:    getMechId('mechSelectRepair'),
    subStaff:  [...currentSubStaff],
    receptionName: '',
    remarks:   remarksVal,
    carItems, truckItems, airconItems,
    noticeItems: Object.entries(S.checkState.notice||{}).filter(([,v])=>v).map(([k])=>k),
    preventResults,
    workItems: Object.entries(S.checkState.work||{}).filter(([,v])=>v).map(([k])=>k),
    savedAt:   new Date().toLocaleString('ja-JP'),
  };

  try {
    S.orders.unshift(order);
    saveState();
    const ok = await sbSaveOrder(order);
    await uploadPendingPhotos(order.id);
    if (ok) {
      showToast(`✅ 保存しました（${orderNum}）`, 'success');
    } else {
      showToast(`⚠️ クラウド同期に失敗しました。自動で再送信します（次回起動時にも再試行）`, 'error', 5000);
    }
    clearRepair();
  } catch(e) {
    showToast('保存に失敗しました: ' + e.message, 'error');
  } finally {
    setSaving('btnSaveRepair', false);
  }
}

function clearRepair() {
  hidePlateHistory('r-carPlate');
  ['r-custName','r-carName','r-carPlate','r-dateIn','r-dateOut','r-remarks','r-nyukoPlace','r-nyukoTime'].forEach(id => {
    const el=document.getElementById(id); if(el) el.value='';
  });
  const nyukoMethod=document.getElementById('r-nyukoMethod'); if(nyukoMethod) nyukoMethod.value='';
  const partsPending=document.getElementById('r-partsPending'); if(partsPending) partsPending.checked=false;
  document.getElementById('r-status').value = '入庫待ち';
  document.getElementById('r-dateIn').value = _todayStr();
  S.checkState={notice:{},work:{}}; S.preventOkNg={}; S.carRepairCheckState={}; S.truckCheckState={}; S.airconCheckState={}; threeMonthCheckState={}; freezerWorkshop='';
  currentSubStaff=[];
  const pc=document.getElementById('r-photos'); if(pc) pc.innerHTML='';
  window._pendingPhotos={};
  switchRepairType('car');
  renderAllChecklists(); renderCarRepairItems(); renderTruckItems(); renderAirconItems();
  renderSubStaffArea();
  updateNumDisplay();
}

// ─── 保存：事故修理 ───────────────────────────────────────────
async function saveAccident() {
  if (isSaving) return;
  const custName = document.getElementById('ac-custName').value.trim();
  const carName  = document.getElementById('ac-carName').value.trim();
  if (!custName && !carName) { showToast('顧客名か車名を入力してください', 'error'); return; }
  if (!confirmIfDuplicate(document.getElementById('ac-carPlate').value.trim(), custName, carName, document.getElementById('ac-dateIn').value)) return;
  setSaving('btnSaveAccident', true);
  const insurance = document.getElementById('ac-insurance').value || document.getElementById('ac-insuranceDirect').value.trim();
  const orderNum  = await genOrderNum();
  const order = {
    id: Date.now().toString(), orderNum, type:'accident',
    status:   document.getElementById('ac-status').value,
    custName, carName,
    carPlate: document.getElementById('ac-carPlate').value,
    dateIn:   document.getElementById('ac-dateIn').value,
    dateOut:  document.getElementById('ac-dateOut').value,
    mechName: getMechName('mechSelectAccident'), mechId: getMechId('mechSelectAccident'),
    subStaff: [...currentSubStaff],
    insurance, remarks: document.getElementById('ac-remarks').value,
    savedAt:  new Date().toLocaleString('ja-JP'),
  };
  try {
    S.orders.unshift(order); saveState();
    const ok = await sbSaveOrder(order);
    await uploadPendingPhotos(order.id);
    showToast(ok ? `✅ 保存しました（${orderNum}）` : '⚠️ クラウド同期失敗。自動で再送信します', ok?'success':'error');
    clearAccident();
  } catch(e) { showToast('保存に失敗しました','error'); }
  finally { setSaving('btnSaveAccident', false); }
}

function clearAccident() {
  hidePlateHistory('ac-carPlate');
  ['ac-custName','ac-carName','ac-carPlate','ac-dateIn','ac-dateOut','ac-remarks','ac-insuranceDirect'].forEach(id => {
    const el=document.getElementById(id); if(el) el.value='';
  });
  document.getElementById('ac-status').value='入庫待ち';
  document.getElementById('ac-dateIn').value=_todayStr();
  document.getElementById('ac-insurance').value='';
  ['ac-preview-repair','ac-preview-receipt'].forEach(id => { const el=document.getElementById(id); if(el) el.innerHTML=''; });
  currentSubStaff=[];
  window._pendingPhotos={};
  updateNumDisplay();
}

// ─── 保存：車検 ───────────────────────────────────────────────
async function saveShakken() {
  if (isSaving) return;
  const custName = document.getElementById('sk-custName').value.trim();
  const carName  = document.getElementById('sk-carName').value.trim();
  if (!custName && !carName) { showToast('顧客名か車名を入力してください','error'); return; }
  if (!confirmIfDuplicate(document.getElementById('sk-carPlate')?.value.trim()||'', custName, carName, document.getElementById('sk-dateIn')?.value||'')) return;
  setSaving('btnSaveShakken', true);
  const skResults = {};
  if (skType==='truck') {
    (S.skTruckItems||DEF_SK_TRUCK).forEach(item => { skResults[item.label]=S.skTruckCheckState?.[item.label]?.work||''; });
  } else {
    (S.skItems||[]).forEach(item => { skResults[item.label]=S.skCheckState[item.label]?.work||''; });
  }
  const orderNum = await genOrderNum();
  const order = {
    id: Date.now().toString(), orderNum, type:'shakken', repairType:skType,
    status:   document.getElementById('sk-status').value,
    custName, carName,
    carPlate: document.getElementById('sk-carPlate').value,
    dateIn:   document.getElementById('sk-dateIn').value,
    dateOut:  document.getElementById('sk-dateOut').value,
    nyukoMethod: document.getElementById('sk-nyukoMethod')?.value||'',
    nyukoTime:   document.getElementById('sk-nyukoTime')?.value||'',
    nyukoPlace:  document.getElementById('sk-nyukoPlace')?.value.trim()||'',
    partsPending: document.getElementById('sk-partsPending')?.checked||false,
    mechName: getMechName('mechSelectShakken'), mechId: getMechId('mechSelectShakken'),
    subStaff: [...currentSubStaff],
    remarks:  document.getElementById('sk-remarks').value,
    skResults, savedAt: new Date().toLocaleString('ja-JP'),
  };
  try {
    S.orders.unshift(order); saveState();
    const ok = await sbSaveOrder(order);
    await uploadPendingPhotos(order.id);
    showToast(ok ? `✅ 保存しました（${orderNum}）` : '⚠️ クラウド同期失敗。自動で再送信します', ok?'success':'error');
    clearShakken();
  } catch(e) { showToast('保存に失敗しました','error'); }
  finally { setSaving('btnSaveShakken', false); }
}

function clearShakken() {
  hidePlateHistory('sk-carPlate');
  ['sk-custName','sk-carName','sk-carPlate','sk-dateIn','sk-dateOut','sk-remarks','sk-nyukoPlace','sk-nyukoTime'].forEach(id => {
    const el=document.getElementById(id); if(el) el.value='';
  });
  const skNyukoMethod=document.getElementById('sk-nyukoMethod'); if(skNyukoMethod) skNyukoMethod.value='';
  const skPartsPending=document.getElementById('sk-partsPending'); if(skPartsPending) skPartsPending.checked=false;
  document.getElementById('sk-dateIn').value=_todayStr();
  S.skCheckState={}; S.skTruckCheckState={}; S.skTruckNotice={}; S.skTruckPrevent={}; S.skTruckLights={};
  ['sk-preview-receipt','sk-preview-repair'].forEach(id => { const el=document.getElementById(id); if(el) el.innerHTML=''; });
  currentSubStaff=[];
  window._pendingPhotos={};
  renderSkItems();
  updateNumDisplay();
}

// ─── 一覧 ────────────────────────────────────────────────────
let _allMonthsLoaded = false;
async function ensureAllMonthsLoaded() {
  if (_allMonthsLoaded || !sbReady) return;
  const sbOrders = await sbLoadOrders(true);
  if (sbOrders !== null) {
    S.orders = sbOrders;
    _allMonthsLoaded = true;
    updateMonthFilter();
  }
}

function updateMonthFilter() {
  const sel=document.getElementById('filterMonth'); if(!sel) return;
  const current=sel.value;
  const isFirst=!sel.dataset.initialized;
  const months=new Set();
  S.orders.forEach(o => { const d=o.dateIn||''; if(d&&d.length>=7) months.add(d.substring(0,7)); });
  const sorted=Array.from(months).sort().reverse();
  sel.innerHTML='<option value="">全月</option>'+sorted.map(m => {
    const [y,mo]=m.split('-');
    return `<option value="${m}" ${m===current?'selected':''}>${y}年${parseInt(mo)}月</option>`;
  }).join('');
  if(isFirst&&sorted.length>0) {
    const today=_curYM();
    if(sorted.includes(today)) sel.value=today;
    sel.dataset.initialized='1';
  } else {
    sel.value=current;
  }
}

function clearFilter() {
  document.getElementById('filterStatus').value='';
  const fe=document.getElementById('filterExtra'); if(fe) fe.value='';
  document.getElementById('filterKeyword').value='';
  document.getElementById('filterType').value='';
  loadList(true);
}

async function manualRefresh() {
  const btn = document.getElementById('refreshBtn');
  if (btn) {
    btn.style.transition = 'transform .6s';
    btn.style.transform = 'rotate(360deg)';
    setTimeout(() => { btn.style.transform = 'rotate(0deg)'; }, 600);
  }
  showToast('最新データを取得中...', 'info');
  _allMonthsLoaded = false;
  await loadList(true);
  showToast('更新しました ✅', 'success');
}
function _todayStr(){
  const n=new Date();
  const p=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(n);
  return `${p.find(x=>x.type==='year').value}-${p.find(x=>x.type==='month').value}-${p.find(x=>x.type==='day').value}`;
}
function _curYM(){ return _todayStr().slice(0,7); }
// UTC保存されたISO日時を、日本時間の「YYYY-MM-DD」に変換する（深夜0時〜9時のズレ対策）
function _isoToJstDateStr(iso){
  if(!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
  return `${p.find(x=>x.type==='year').value}-${p.find(x=>x.type==='month').value}-${p.find(x=>x.type==='day').value}`;
}
function inMonthOrCarryover(o, filterMonth){
  if(!filterMonth) return true;
  const d=(o.dateIn||'');
  if(!d){
    // 入庫予定日が未定のものは、月で絞り込んでいても常に表示する（作成日時の書式に依存しない）
    return o.status!=='完了' && o.status!=='引渡済';
  }
  if(d.startsWith(filterMonth)) return true;
  // 過去・未来を問わず、未完了の指示書は月をまたいでも表示し続ける
  if(o.status!=='完了' && o.status!=='引渡済') return true;
  return false;
}
// ─── 引渡済なのに請求書がまだの件数 ───────────────────────────
var _dniCache = { t: 0, n: null };
async function countDeliveredUninvoiced() {
  if (_dniCache.n !== null && Date.now() - _dniCache.t < 60000) return _dniCache.n;
  let n = null;
  if (sb && sbReady) {
    try {
      // 前の月の引渡済は一覧に読み込まれていないことがあるので、サーバーで数える
      const { data, error } = await sb.from(DB_TABLES.KIROKU).select('id,progress')
        .eq('status', '引渡済').or('invoice_done.is.null,invoice_done.eq.false');
      if (!error) n = (data||[]).filter(r => !(r.progress||[]).includes('請求書済')).length;
    } catch(e) {}
  }
  if (n === null) n = (S.orders||[]).filter(o => o.status === '引渡済' && !_isInvoiced(o)).length;
  _dniCache = { t: Date.now(), n };
  return n;
}
function showDeliveredUninvoiced(on) {
  const sel = document.getElementById('filterExtra'); if (!sel) return;
  sel.value = on ? 'deliveredNoInvoice' : '';
  loadList();
}
async function renderDniBanner(c, active) {
  let el = document.getElementById('dniBanner');
  if (!el) { el = document.createElement('div'); el.id = 'dniBanner'; c.parentNode.insertBefore(el, c); }
  const n = await countDeliveredUninvoiced();
  if (active) {
    el.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;padding:12px 14px;background:#fef2f2;border:1.5px solid #fca5a5;border-radius:10px">
      <span style="font-size:15px;font-weight:700;color:#991b1b">🚨 引渡済・請求書未を表示中（${n}件）</span>
      <button onclick="showDeliveredUninvoiced(false)" style="background:#fff;border:1.5px solid #fca5a5;border-radius:8px;padding:8px 12px;font-size:14px;font-weight:700;color:#991b1b;cursor:pointer;white-space:nowrap">解除</button></div>`;
  } else if (n > 0) {
    el.innerHTML = `<div onclick="showDeliveredUninvoiced(true)" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;padding:12px 14px;background:#fef2f2;border:1.5px solid #fca5a5;border-radius:10px;cursor:pointer">
      <span style="font-size:15px;font-weight:700;color:#991b1b">🚨 引渡済なのに請求書がまだ：${n}件</span>
      <span style="background:#dc2626;color:#fff;border-radius:8px;padding:8px 12px;font-size:14px;font-weight:700;white-space:nowrap">確認する</span></div>`;
  } else {
    el.innerHTML = '';
  }
}

async function loadList(forceLoadAll) {
  const c=document.getElementById('orderList');
  c.innerHTML='<div class="loading"><span class="spinner"></span></div>';
  await flushPendingOrders();
  await flushPendingWrites();
  const filterMonth0  =document.getElementById('filterMonth')?.value;
  const filterKeyword0=document.getElementById('filterKeyword')?.value.trim();
  const isDni = document.getElementById('filterExtra')?.value==='deliveredNoInvoice';
  if (sbReady && !_allMonthsLoaded) {
    if (filterKeyword0 || forceLoadAll || isDni) {
      // 検索キーワードがある場合・全件ボタン押下時は全月対象
      const sbOrders = await sbLoadOrders(true);
      if (sbOrders !== null) { S.orders = sbOrders; _allMonthsLoaded = true; }
    } else if (filterMonth0) {
      // 月が指定されていればその月だけサーバー側で絞り込む
      const sbOrders = await sbLoadOrders(false, filterMonth0);
      if (sbOrders !== null) S.orders = sbOrders;
    } else {
      // デフォルトは今月分だけ（高速）
      const sbOrders = await sbLoadOrders(false);
      if (sbOrders !== null) S.orders = sbOrders;
    }
  } else if (sbReady && _allMonthsLoaded) {
    const sbOrders = await sbLoadOrders(true);
    if (sbOrders !== null) S.orders = sbOrders;
  }
  // まだクラウド送信できていない指示書は、一覧から消えないようここで合流させる
  const stillPending = getPendingOrders();
  if (stillPending.length) {
    const existingIds = new Set(S.orders.map(o => o.id));
    stillPending.forEach(o => { if (!existingIds.has(o.id)) S.orders.unshift(o); });
  }
  const filterMonth  =document.getElementById('filterMonth')?.value;
  const filterStatus =document.getElementById('filterStatus')?.value;
  const filterKeyword=document.getElementById('filterKeyword')?.value.trim();
  const filterType   =document.getElementById('filterType')?.value;
  updateMonthFilter();
  let orders=[...S.orders];
  // キーワード検索中は「全期間から探す」のが目的なので、月の絞り込みは適用しない
  if(!filterKeyword && !isDni) orders=orders.filter(o=>inMonthOrCarryover(o,filterMonth));
  if(isDni) orders=orders.filter(o=>o.status==='引渡済' && !_isInvoiced(o));
  renderDniBanner(c, isDni);
  if(filterStatus)  orders=orders.filter(o=>o.status===filterStatus);
  if(filterType)    orders=orders.filter(o=>o.type===filterType);
  const filterExtra = document.getElementById('filterExtra')?.value;
  if(filterExtra==='bookmark') orders=orders.filter(o=>o.bookmarked);
  if(filterExtra==='noInvoice') orders=orders.filter(o=>!o.invoiceDone && !(o.progress||[]).includes('請求書済'));
  if(filterExtra==='carryover') orders=orders.filter(o=>{
    const d=o.dateIn||'';
    return d && d<_curYM() && o.status!=='完了' && o.status!=='引渡済';
  });
  if(filterExtra==='inProgress') orders=orders.filter(o=>['作業中','車検中','入庫中'].includes(o.status));
  if(filterExtra==='todayIntake') orders=orders.filter(o=>(o.dateIn||'')===_todayStr());
  if(filterExtra==='noRecord') orders=orders.filter(o=>{
    const is3m = o.repairType==='3month' || [...(o.carItems||[]),...(o.truckItems||[])].some(i=>i.includes('3ヶ月')||i.includes('３ヶ月')||i.includes('3か月')||i.includes('３か月'));
    return is3m && !o.recordDone;
  });
  if(filterKeyword){
    const isNumericKw = /^\d+$/.test(filterKeyword);
    // 車番・指示書番号のように数字を含む文字列は、数字のまとまり（例：「50あ1234」→「50」「1234」）ごとに区切って
    // 検索語と完全一致するかを見る（「20」で検索した時に「201」「1520」のような部分一致を拾わないようにするため）
    const numSegMatch = (str, kw) => {
      if (!str) return false;
      const kwNum = parseInt(kw, 10);
      return str.split(/[^0-9]+/).filter(Boolean).some(seg => seg === kw || parseInt(seg, 10) === kwNum);
    };
    orders = orders.filter(o => {
      if (isNumericKw) {
        return numSegMatch(o.carPlate, filterKeyword) || numSegMatch(o.orderNum, filterKeyword) ||
               (o.custName||'').includes(filterKeyword) || (o.carName||'').includes(filterKeyword);
      }
      return (o.custName||'').includes(filterKeyword)||(o.carName||'').includes(filterKeyword)||
             (o.carPlate||'').includes(filterKeyword)||(o.orderNum||'').includes(filterKeyword);
    });
  }
  const _n=new Date();
  const _nParts=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(_n);
  const _td=`${_nParts.find(p=>p.type==='year').value}-${_nParts.find(p=>p.type==='month').value}-${_nParts.find(p=>p.type==='day').value}`;
  const _tmDateObj=new Date(`${_td}T12:00:00Z`); _tmDateObj.setDate(_tmDateObj.getDate()+1);
  const _tm=_tmDateObj.toISOString().split('T')[0];
  const statusOrder={'作業中':0,'車検中':1,'入庫中':2,'完了':5,'引渡済':6};
  function nyukoOrder(o){
    if(o.status!=='入庫待ち')return statusOrder[o.status]??99;
    const d=o.dateIn||'';
    if(d===_td)return 3;
    if(d===_tm)return 3.5;
    return 3.8;
  }
  orders.sort((a,b)=>{
    const aO=nyukoOrder(a);const bO=nyukoOrder(b);
    if(aO!==bO)return aO-bO;
    if(a.status==='入庫待ち'&&b.status==='入庫待ち')return (a.dateIn||'').localeCompare(b.dateIn||'');
    return (b.dateIn||'').localeCompare(a.dateIn||'');
  });
  const _now2=new Date();const _hh=String(_now2.getHours()).padStart(2,'0'),_mm=String(_now2.getMinutes()).padStart(2,'0');
  const el=document.getElementById('listSyncLabel'); if(el) el.textContent=(sbReady?'クラウド同期済み':'ローカル保存')+`　最終更新 ${_hh}:${_mm}　ver.19`;

  // 進捗バー（請求書未済・3ヵ月点検未済フィルター時）
  const filterExtraVal=document.getElementById('filterExtra')?.value;
  const progressBarEl=document.getElementById('filterProgressBar')||(() => {
    const div=document.createElement('div'); div.id='filterProgressBar';
    div.style.cssText='padding:10px 16px 4px;display:none';
    c.parentNode.insertBefore(div, c); return div;
  })();
  if(filterExtraVal==='noInvoice'||filterExtraVal==='noRecord'){
    const label=filterExtraVal==='noInvoice'?'請求書済':'3ヵ月点検済';
    const allOrders=S.orders||[];
    const total=allOrders.length;
    const doneCount=filterExtraVal==='noInvoice'
      ? allOrders.filter(o=>o.invoiceDone||(o.progress||[]).includes('請求書済')).length
      : allOrders.filter(o=>(o.progress||[]).includes('3ヵ月点検記録簿済')).length;
    const pct=total?Math.round(doneCount/total*100):0;
    progressBarEl.style.display='block';
    progressBarEl.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;font-size:13px;font-weight:700;color:#374151">
        <span>📄 ${label} ${doneCount}/${total}件</span>
        <span style="color:${pct===100?'#16a34a':'#f97316'}">残り${total-doneCount}件 ${pct}%</span>
      </div>
      <div style="background:#e5e7eb;border-radius:99px;height:12px;overflow:hidden">
        <div style="background:${pct===100?'#22c55e':'#f97316'};width:${pct}%;height:100%;border-radius:99px;transition:width 0.4s"></div>
      </div>`;
  } else {
    progressBarEl.style.display='none';
  }

  if(!orders.length) { c.innerHTML='<div class="empty">📋 指示書がありません</div>'; return; }

  const _today=_td;
  const _tomorrow=_tm;
  const weekdays=['日','月','火','水','木','金','土'];
  // 正午のUTC時刻にしてからgetDay()すれば日付ズレなく曜日を取得できる
  const _todayWeekday=weekdays[new Date(`${_today}T12:00:00Z`).getDay()];
  const _tomorrowWeekday=weekdays[new Date(`${_tomorrow}T12:00:00Z`).getDay()];

  function renderOrderCard(o) {
    const subNames=esc((o.subStaff||[]).map(s=>s.name).join('・'));
    const nyukoInfo=esc([o.nyukoMethod||'',o.nyukoPlace?`📍${o.nyukoPlace}`:'',o.nyukoTime?`⏰${o.nyukoTime}`:''].filter(Boolean).join('　'));
    const allItems=[...(o.carItems||[]),...(o.truckItems||[]),...(o.airconItems||[]),...(o.skResults?Object.keys(o.skResults).filter(k=>o.skResults[k]):[])].slice(0,3);
    const itemsPreview=allItems.length?`<div style="font-size:14px;color:#f97316;margin-top:4px;">🔧 ${esc(allItems.join('・'))}${(o.carItems||[]).length+(o.truckItems||[]).length+(o.airconItems||[]).length>3?'…':''}</div>`:'';
    const isPast=(o.dateIn||'')!==''&&(o.dateIn||'')<_today&&o.status!=='引渡済';
    const isUntaken=o.status==='入庫待ち'&&!o.mechName;
    const bookmarkBadge=o.bookmarked?`<span style="color:#7e22ce;font-size:14px;">⭐</span>`:'';
    const curFilterMonth=document.getElementById('filterMonth')?.value||'';
    const isCarry=curFilterMonth && (o.dateIn||'') && !(o.dateIn||'').startsWith(curFilterMonth);
    const carryBadge=isCarry?`<span style="background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;border-radius:6px;padding:2px 6px;margin-right:4px;">📌 前月から繰越</span>`:'';
    const alertMark=isPast?'⚠ ':'';
    const cardBorder=o.status==='作業中'?'2px solid #ef4444':isPast?'2px solid #f97316':'1.5px solid var(--border)';
    // 備考1行目
    const remarksPreview=o.remarks?(()=>{const first=o.remarks.trim().split('\n')[0];return first?`<div style="font-size:13px;color:#64748b;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">📝 ${esc(first)}</div>`:''})():'';
    // ステータスボタン4つ
    const statuses=[['入庫待ち','入庫待ち','#f97316'],['作業中','作業中','#ef4444'],['作業完了','完了','#8b5cf6'],['引渡済','引渡済','#64748b']];
    const statusBtns=statuses.map(([label,val,c])=>`<button onclick="quickStatus('${o.id}','${val}');return false;" style="flex:1;padding:10px 4px;font-size:13px;font-weight:700;background:${o.status===val?c:'#f8fafc'};color:${o.status===val?'#fff':'#94a3b8'};border:1.5px solid ${o.status===val?c:'#e2e8f0'};border-radius:10px;cursor:pointer;">${label}</button>`).join('');
    // 進捗ボタン6つ
    const progressDef=[['📦','部品発注済','#fef9c3','#854d0e'],['⏳','部品待ち','#fef2f2','#991b1b'],['✅','点検完了','#dcfce7','#15803d'],['📘','3ヵ月点検記録簿済','#dbeafe','#1d4ed8'],['🚙','納車準備OK','#f0fdf4','#166534'],['📄','請求書済','#f3e8ff','#7e22ce']];
    const prog=o.progress||[];
    const progressBtns=progressDef.map(([icon,key,bg,color])=>`<button onclick="quickProgress('${o.id}','${key}');return false;" style="padding:9px 6px;font-size:13px;font-weight:700;text-align:center;background:${prog.includes(key)?bg:'#f8fafc'};color:${prog.includes(key)?color:'#94a3b8'};border:1.5px solid ${prog.includes(key)?color:'#e2e8f0'};border-radius:10px;cursor:pointer;">${icon} ${key}</button>`).join('');
    // 車検専用：陸運局まわりの進捗ボタン（車検の指示書のみ表示）
    const shakkenProgressDef=[['🏢','先に陸運局','#e0f2fe','#0369a1'],['✅','陸運局回送済','#dcfce7','#166534']];
    const shakkenProgressBtns=o.type==='shakken'?`<div style="margin-top:8px;">
        <div style="font-size:12px;color:#94a3b8;margin-bottom:6px;">🏢 陸運局</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">${shakkenProgressDef.map(([icon,key,bg,color])=>`<button onclick="quickProgress('${o.id}','${key}');return false;" style="padding:9px 6px;font-size:13px;font-weight:700;text-align:center;background:${prog.includes(key)?bg:'#f8fafc'};color:${prog.includes(key)?color:'#94a3b8'};border:1.5px solid ${prog.includes(key)?color:'#e2e8f0'};border-radius:10px;cursor:pointer;">${icon} ${key}</button>`).join('')}</div>
      </div>`:'';
    // 陸運局バッジ（一覧で一目で分かるように）
    const rikuunBadge=o.type==='shakken'?(prog.includes('陸運局回送済')?`<span style="background:#dcfce7;color:#166534;font-size:11px;font-weight:700;border-radius:6px;padding:2px 6px;margin-right:4px;">🏢 回送済</span>`:prog.includes('先に陸運局')?`<span style="background:#e0f2fe;color:#0369a1;font-size:11px;font-weight:700;border-radius:6px;padding:2px 6px;margin-right:4px;">🏢 陸運局へ先に</span>`:''):'';
    // 私が担当しますボタン
    const takeBtn=isUntaken?`<div onclick="takeOrder('${o.id}')" style="margin-top:10px;background:#f97316;border-radius:10px;color:#fff;font-size:17px;font-weight:700;padding:14px;cursor:pointer;text-align:center;width:100%;box-sizing:border-box;">✋ 私が担当します</div>`:'';
    return `<div class="order-item" onclick="if(!event.target.closest('button'))showDetail('${o.id}')" style="border:${cardBorder};box-shadow:0 1px 4px rgba(0,0,0,0.06);margin-bottom:10px;cursor:pointer;">
      <div class="top">
        <span class="order-num">${carryBadge}${bookmarkBadge}${rikuunBadge}${alertMark}${esc(o.orderNum||'（番号なし）')}</span>
      </div>
      <div style="font-size:17px;font-weight:600;color:var(--text);margin-bottom:6px;">${o.type==='shakken'?'🔍 ':o.type==='accident'?'🚨 ':''}${esc(o.custName)}　${esc(o.carName)}${o.carPlate?'　【'+esc(o.carPlate)+'】':''}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px 16px;color:var(--sub);font-size:15px;line-height:1.8;">
        <span>📅 ${o.dateIn||'未設定'}</span>
        <span>👤 ${esc(o.mechName||'未定')}${subNames?'・'+subNames:''}</span>
      </div>
      ${nyukoInfo?`<div style="color:#1d4ed8;font-size:15px;font-weight:600;margin-top:6px;">🚗 ${nyukoInfo}</div>`:''}
      ${itemsPreview}
      ${remarksPreview}
      <div style="border-top:1px solid #e2e8f0;margin-top:10px;padding-top:10px;">
        <div style="font-size:12px;color:#94a3b8;margin-bottom:6px;">ステータス</div>
        <div style="display:flex;gap:6px;">${statusBtns}</div>
      </div>
      <div style="margin-top:8px;">
        <div style="font-size:12px;color:#94a3b8;margin-bottom:6px;">進捗</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">${progressBtns}</div>
      </div>
      ${shakkenProgressBtns}
      ${takeBtn}
    </div>`;
  }


  function renderGroup(label,icon,headerBg,headerColor,borderColor,badgeBg,groupOrders,collapsed=false) {
    const count=groupOrders.length;
    const countBadge=`<span style="background:${badgeBg};color:#fff;font-size:14px;font-weight:700;border-radius:20px;padding:4px 14px;flex-shrink:0;">${count}件</span>`;
    const header=`<div style="display:flex;align-items:center;gap:10px;padding:16px;background:${headerBg};border-top:4px solid ${borderColor};border-radius:12px 12px 0 0;cursor:pointer;min-height:56px;" onclick="const b=this.nextElementSibling;b.style.display=b.style.display==='none'?'block':'none';">
      <span style="font-size:22px;">${icon}</span>
      <span style="color:${headerColor};font-weight:600;font-size:17px;flex:1;">${label}</span>
      ${countBadge}
    </div>`;
    const display=collapsed?'none':'block';
    const body=`<div style="display:${display};padding:${count>0?'10px 10px 4px':'14px'};background:var(--card);border-radius:0 0 12px 12px;border:1px solid var(--border);border-top:none;">
      ${count>0?groupOrders.map(renderOrderCard).join(''):`<div style="color:var(--sub);font-size:16px;text-align:center;padding:8px 0;">作業なし</div>`}
    </div>`;
    return `<div style="border-radius:12px;margin-bottom:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.07);">${header}${body}</div>`;
  }

  const _fm=filterMonth||_curYM();
  const carryoverOrders=orders.filter(o=>{
    const d=o.dateIn||'';
    return d && d<_fm && o.status!=='完了' && o.status!=='引渡済';
  });
  const carryIds=new Set(carryoverOrders.map(o=>o.id));
  const inProgressOrders=orders.filter(o=>!carryIds.has(o.id)&&(o.status==='作業中'||o.status==='入庫中'||o.status==='車検中'));
  const todayOrders=orders.filter(o=>{
    if(carryIds.has(o.id))return false;
    const d=o.dateIn||'';return o.status==='入庫待ち'&&(d===_today||(d!==''&&d<_today));
  });
  const tomorrowOrders=orders.filter(o=>!carryIds.has(o.id)&&o.status==='入庫待ち'&&(o.dateIn||'')===_tomorrow);
  const futureOrders=orders.filter(o=>!carryIds.has(o.id)&&o.status==='入庫待ち'&&(o.dateIn||'')>_tomorrow);
  const undecidedOrders=orders.filter(o=>!carryIds.has(o.id)&&o.status==='入庫待ち'&&!o.dateIn);
  const doneOrders=orders.filter(o=>!carryIds.has(o.id)&&(o.status==='完了'||o.status==='引渡済'));
  // どのグループにも当てはまらない指示書（ステータスが空・想定外の値など）も取りこぼさず表示する
  const _knownStatuses=['入庫待ち','作業中','入庫中','車検中','完了','引渡済'];
  const unknownStatusOrders=orders.filter(o=>!carryIds.has(o.id)&&!_knownStatuses.includes(o.status));
  const todayDoneOrders=doneOrders.filter(o=>_isoToJstDateStr(o.completedAt)===_today);
  const doneOrdersRest=doneOrders.filter(o=>_isoToJstDateStr(o.completedAt)!==_today);

  const todayLabel=`今日の入庫予定　${_today.slice(5).replace('-','/')}（${_todayWeekday}）`;
  const tomorrowLabel=`明日の入庫予定　${_tomorrow.slice(5).replace('-','/')}（${_tomorrowWeekday}）`;

  c.innerHTML=
    renderGroup(`📌 前月から繰越（未完成）　${carryoverOrders.length}件`,'📌','#fef3c7','#92400e','#f59e0b','#f59e0b',carryoverOrders,carryoverOrders.length===0)+
    renderGroup(`🎉 今日の完了実績　${todayDoneOrders.length}件`,'🎉','#f0fdf4','#166534','#22c55e','#16a34a',todayDoneOrders,todayDoneOrders.length===0)+
    renderGroup('現在進行中','🔨','#fef2f2','#991b1b','#ef4444','#ef4444',inProgressOrders)+
    renderGroup(todayLabel,'🔥','#fff7ed','#c2410c','#f97316','#f97316',todayOrders)+
    renderGroup(tomorrowLabel,'📋','#eff6ff','#1d4ed8','#3b82f6','#3b82f6',tomorrowOrders)+
    renderGroup('明日以降の入庫予定','📅','#f0fdf4','#15803d','#22c55e','#22c55e',futureOrders,futureOrders.length===0)+
    renderGroup(`⚠️ ステータス未設定（要確認）　${unknownStatusOrders.length}件`,'⚠️','#fef2f2','#991b1b','#ef4444','#ef4444',unknownStatusOrders,unknownStatusOrders.length===0)+
    renderGroup(`🗓️ 日程未定　${undecidedOrders.length}件`,'🗓️','#f5f3ff','#6d28d9','#8b5cf6','#8b5cf6',undecidedOrders,undecidedOrders.length===0)+
    renderGroup(`それ以前の完了・引渡済　${doneOrdersRest.length}件`,'✅','#f8fafc','#64748b','#cbd5e1','#94a3b8',doneOrdersRest,true);
}

// ─── 作業引き受け ────────────────────────────────────────────

// ─── 「元に戻す」付きのお知らせ ───────────────────────────────
let _undoTimer = null;
function showUndoToast(msg, undoFn, ms = 6000) {
  hideToast();
  document.getElementById('undoToast')?.remove();
  clearTimeout(_undoTimer);
  const t = document.createElement('div');
  t.id = 'undoToast';
  t.style.cssText = 'position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:3000;display:flex;align-items:center;gap:12px;background:#1e2433;color:#fff;border-radius:12px;padding:12px 12px 12px 16px;box-shadow:0 6px 24px rgba(0,0,0,.25);font-size:15px;font-weight:600;width:max-content;max-width:calc(100% - 24px)';
  const span = document.createElement('span'); span.textContent = msg;
  const btn = document.createElement('button');
  btn.textContent = '↩ 元に戻す';
  btn.style.cssText = 'background:#f97316;color:#fff;border:none;border-radius:8px;padding:10px 14px;font-size:15px;font-weight:700;cursor:pointer;white-space:nowrap';
  btn.onclick = () => { clearTimeout(_undoTimer); t.remove(); undoFn(); };
  t.append(span, btn);
  document.body.appendChild(t);
  _undoTimer = setTimeout(() => t.remove(), ms);
}
async function revertStatus(orderId, prevStatus, prevCompletedAt) {
  const order = S.orders.find(o => o.id === orderId); if (!order) return;
  order.status = prevStatus;
  order.completedAt = prevCompletedAt || '';
  saveState();
  const ok = sb ? await sbWrite(DB_TABLES.KIROKU, 'update', { status: prevStatus, completed_at: prevCompletedAt || null }, orderId) : true;
  showToast(ok ? `↩ 「${prevStatus}」に戻しました` : '⚠️ 通信失敗。自動で再送信します', ok ? 'success' : 'error');
  loadList();
}

// ─── 一覧からのクイック操作 ──────────────────────────────────
async function quickStatus(orderId, newStatus) {
  const order = S.orders.find(o => o.id === orderId);
  if (!order) return;
  if (order.status === newStatus) return; // 同じボタンをもう一度押しても何もしない
  const prevStatus = order.status, prevCompletedAt = order.completedAt || '';
  // 処理中表示（通信が遅い時も「動いている」とわかるように）
  document.querySelectorAll(`button[onclick*="quickStatus('${orderId}','${newStatus}')"]`).forEach(btn => {
    btn.dataset.origText = btn.textContent;
    btn.textContent = '⏳ 送信中...';
    btn.disabled = true;
  });
  order.status = newStatus;
  const updatePayload = { status: newStatus };
  if((newStatus==='完了'||newStatus==='引渡済') && !order.completedAt){
    order.completedAt = new Date().toISOString();
    updatePayload.completed_at = order.completedAt;
  }
  saveState();
  let statusOk = true;
  if (sb) {
    statusOk = await sbWrite(DB_TABLES.KIROKU, 'update', updatePayload, orderId);
  }
  if (statusOk) showUndoToast(`「${newStatus}」に変更しました`, () => revertStatus(orderId, prevStatus, prevCompletedAt));
  else showToast(`⚠️ 通信失敗。自動で再送信します（表示は「${newStatus}」のまま）`, 'error');
  // ステータスボタンの見た目だけ即時更新（全件再読み込みしない）
  const statusMeta = [['入庫待ち','入庫待ち','#f97316'],['作業中','作業中','#ef4444'],['作業完了','完了','#8b5cf6'],['引渡済','引渡済','#64748b']];
  document.querySelectorAll(`button[onclick*="quickStatus('${orderId}'"]`).forEach(btn => {
    const m = btn.getAttribute('onclick')?.match(/quickStatus\('[^']+','([^']+)'\)/);
    if (!m) return;
    const val = m[1];
    const meta = statusMeta.find(x => x[1] === val);
    const c = meta?.[2] || '#94a3b8';
    const label = meta?.[0] || val;
    const on = val === newStatus;
    btn.style.background = on ? c : '#f8fafc';
    btn.style.color = on ? '#fff' : '#94a3b8';
    btn.style.border = `1.5px solid ${on ? c : '#e2e8f0'}`;
    btn.textContent = btn.dataset.origText || label;
    btn.disabled = false;
  });
}

async function quickProgress(orderId, key, _isUndo) {
  const order = S.orders.find(o => o.id === orderId);
  if (!order) return;
  // 処理中表示（通信が遅い時も「動いている」とわかるように）
  document.querySelectorAll(`button[onclick*="quickProgress('${orderId}','${key}')"]`).forEach(btn => {
    btn.dataset.origText = btn.textContent;
    btn.textContent = '⏳ 送信中...';
    btn.disabled = true;
  });
  order.progress = order.progress || [];
  const has = order.progress.includes(key);
  if (has) { order.progress = order.progress.filter(k => k !== key); }
  else { order.progress.push(key); }
  // 「請求書済」は請求書チェックとそろえる（片方だけだと件数がずれるため）
  if (key === '請求書済') order.invoiceDone = !has;
  saveState();
  if (!_isUndo) showUndoToast(`「${key}」を${has ? '外しました' : '付けました'}`, () => quickProgress(orderId, key, true));
  // Supabase保存完了後にloadList
  if (sb) {
    try { await sbSaveOrder(order); } catch(e) { console.log('progress保存エラー:', e); }
  }
  // loadListはSupabaseから再読み込みするのでローカルの変更を先に反映
  const c = document.getElementById('orderList');
  if (c) {
    // ボタンの色だけ即時更新
    const progressDef=[['📦','部品発注済','#fef9c3','#854d0e'],['⏳','部品待ち','#fef2f2','#991b1b'],['✅','点検完了','#dcfce7','#15803d'],['📘','3ヵ月点検記録簿済','#dbeafe','#1d4ed8'],['🚙','納車準備OK','#f0fdf4','#166534'],['📄','請求書済','#f3e8ff','#7e22ce'],['🏢','先に陸運局','#e0f2fe','#0369a1'],['✅','陸運局回送済','#dcfce7','#166534']];
    progressDef.forEach(([icon, k, bg, color]) => {
      const on = order.progress.includes(k);
      document.querySelectorAll(`button[onclick*="quickProgress('${orderId}','${k}')"]`).forEach(btn => {
        btn.style.background = on ? bg : '#f8fafc';
        btn.style.color = on ? color : '#94a3b8';
        btn.style.border = `1.5px solid ${on ? color : '#e2e8f0'}`;
        btn.textContent = btn.dataset.origText || `${icon} ${k}`;
        btn.disabled = false;
      });
    });
  }
}

async function takeOrder(id) {
  if(!currentUser) { showToast('ログインしてください','error'); return; }
  if(!confirm(`「${currentUser.name}」がこの作業を引き受けますか？`)) return;
  const order=S.orders.find(o=>o.id===id); if(!order) return;
  order.mechName = currentUser.name;
  order.mechId   = currentUser.id;
  order.status   = order.status==='入庫待ち'||order.status==='入庫中' ? '作業中' : order.status;
  saveState();
  const ok = await sbSaveOrder(order);
  showToast(ok?`✅ ${currentUser.name} が引き受けました`:'⚠️ 保存失敗', ok?'success':'error');
  loadList();
}

// ─── 詳細表示 ────────────────────────────────────────────────
function showDetail(id) {
  const order=S.orders.find(o=>o.id===id); if(!order) return;
  currentOrder=order;
  openShijishoView(order);
}

function shijishoField(label,value) {
  if(!value) return '';
  return `<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px">
    <div style="font-size:11px;color:var(--sub);font-weight:700;margin-bottom:6px">${label}</div>
    <div style="font-size:17px;font-weight:700;color:var(--text)">${esc(value)}</div>
  </div>`;
}
function shijishoSection(title,content) {
  return `<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:12px">
    <div style="color:var(--accent);font-size:13px;font-weight:700;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border)">${title}</div>${content}</div>`;
}
function tagList(items,color) {
  return `<div style="display:flex;flex-wrap:wrap;gap:6px">${items.map(i=>`<span style="background:rgba(240,160,48,0.15);border:1px solid ${color};border-radius:6px;padding:6px 12px;font-size:13px;font-weight:600;color:${color}">${esc(i)}</span>`).join('')}</div>`;
}

async function buildPhotoSectionAsync(orderId) {
  const photos = await loadPhotosForOrder(orderId);
  const ph = document.getElementById('photo-section-placeholder');
  if (!ph) return; // 画面が既に閉じられている場合
  if (!photos.length) { ph.innerHTML=''; return; }
  const typeOrder=['作業前','作業中','作業後','納品書','写真'];
  const grouped={}; photos.forEach(p=>{ if(!grouped[p.photo_type]) grouped[p.photo_type]=[]; grouped[p.photo_type].push(p); });
  const allPhotos=[]; typeOrder.forEach(t=>{ if(grouped[t]) grouped[t].forEach(p=>allPhotos.push(p)); });
  Object.keys(grouped).forEach(t=>{ if(!typeOrder.includes(t)) grouped[t].forEach(p=>allPhotos.push(p)); });
  const imgs=allPhotos.map((p,i)=>`
    <div id="photo-slot-view-${i}">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <input type="checkbox" id="photo-check-${i}" data-src="${esc(_photoSrc(p))}" data-type="${esc(p.photo_type)}" data-id="${p.id||''}" style="width:18px;height:18px;cursor:pointer;accent-color:var(--accent)">
        <span style="color:var(--sub);font-size:11px;font-weight:700">${esc(p.photo_type)}</span>
        <button onclick="deletePhoto('${p.id||''}','photo-slot-view-${i}')" style="margin-left:auto;background:var(--danger);border:none;border-radius:6px;color:#fff;font-size:11px;padding:3px 8px;cursor:pointer">🗑️</button>
      </div>
      <img src="${esc(_photoSrc(p))}" loading="lazy" data-url="${esc(p.photo_url||'')}" data-pid="${p.id||''}" data-ptype="${esc(p.photo_type)}" style="width:100%;border-radius:10px;border:2px solid var(--border);cursor:zoom-in" onclick="openPhotoFullscreen(this.src,this.dataset.ptype,this.dataset.pid)">
    </div>`).join('');
  ph.outerHTML = shijishoSection('📷 写真',`
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <button class="btn btn-gray btn-sm" onclick="selectAllPhotos(true)">✅ 全選択</button>
      <button class="btn btn-gray btn-sm" onclick="selectAllPhotos(false)">⬜ 全解除</button>
      <button class="btn btn-primary btn-sm" onclick="downloadSelectedPhotos()">📥 ダウンロード</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${imgs}</div>`);
}

function openShijishoView(order) {
  const typeLabel=order.type==='shakken'?'車検指示書':order.type==='accident'?'事故修理指示書':'作業指示書';
  const subNames=(order.subStaff||[]).map(s=>s.name).join('・');
  let sakugyoHtml='';
  if(order.type==='accident') {
    if(order.insurance) sakugyoHtml+=shijishoSection('🏢 保険会社',`<span style="font-size:16px;font-weight:700">${esc(order.insurance)}</span>`);
  } else if(order.type==='shakken'&&order.skResults) {
    const res=Object.entries(order.skResults).filter(([,v])=>v);
    if(res.length) sakugyoHtml+=shijishoSection('🔍 車検点検結果',res.map(([k,v])=>`
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #2a3050">
        <span style="font-size:14px">${k}</span>
        <span style="font-weight:700;color:${v==='良好'?'var(--ok)':v==='交換'?'var(--danger)':'var(--accent)'}">${v}</span>
      </div>`).join(''));
  } else {
    const allItems=[...(order.carItems||[]),...(order.truckItems||[]),...(order.airconItems||[])];
    if(allItems.length)           sakugyoHtml+=shijishoSection('✅ 依頼事項',tagList(allItems,'var(--accent)'));
    if(order.noticeItems?.length) sakugyoHtml+=shijishoSection('👁️ 気がついた事',tagList(order.noticeItems,'var(--info)'));
    const prev=Object.entries(order.preventResults||{}).filter(([,v])=>v);
    if(prev.length) sakugyoHtml+=shijishoSection('🛡️ 予防整備',prev.map(([k,v])=>`<span style="display:inline-block;margin:3px;padding:6px 14px;border-radius:20px;font-size:13px;font-weight:700;background:${v==='OK'?'rgba(48,176,96,0.2)':'rgba(224,64,64,0.2)'};color:${v==='OK'?'var(--ok)':'var(--danger)'}">${k}：${v}</span>`).join(''));
    if(order.workItems?.length)   sakugyoHtml+=shijishoSection('🔩 作業内容',tagList(order.workItems,'var(--ok)'));
  }
  if(order.remarks) sakugyoHtml+=shijishoSection('📝 備考・メモ',`<div style="white-space:pre-wrap;font-size:15px;line-height:1.8;background:var(--bg);padding:12px;border-radius:8px">${esc(order.remarks)}</div>`);

  let photoHtml='<div id="photo-section-placeholder"></div>';
  buildPhotoSectionAsync(order.id);

  const alreadyInOrder = order.mechId===currentUser?.id || (order.subStaff||[]).some(s=>s.id===currentUser?.id);
  const joinBtn = !alreadyInOrder ? `
    <button class="btn btn-info btn-sm" onclick="joinAsSubStaff('${order.id}')">🙋 サブ担当として参加</button>` : '';

  document.body.insertAdjacentHTML('beforeend', `
  <div style="position:fixed;inset:0;background:var(--bg);z-index:500;overflow-y:auto" id="shijishoView">
    <div style="position:sticky;top:0;background:var(--card);border-bottom:2px solid var(--accent);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;z-index:10;flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-size:11px;color:var(--sub);font-weight:700">${typeLabel}</div>
        <div style="font-size:20px;font-weight:800;color:var(--accent)">${esc(order.orderNum||'番号なし')}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button onclick="toggleBookmark('${order.id}')" style="background:${order.bookmarked?'#f3e8ff':'#f8fafc'};border:1.5px solid ${order.bookmarked?'#7e22ce':'var(--border)'};border-radius:10px;padding:10px 14px;font-size:18px;cursor:pointer;">${order.bookmarked?'⭐':'☆'}</button>
        <button onclick="if(deleteOrder('${order.id}')){closeShijishoView();loadList();}" style="background:#fee2e2;border:1.5px solid #fca5a5;border-radius:10px;padding:10px 14px;font-size:18px;cursor:pointer;">🗑️</button>
        <button onclick="openEditModal('${order.id}')" style="flex:1;background:#dbeafe;border:1.5px solid #93c5fd;border-radius:10px;padding:12px 16px;font-size:16px;font-weight:700;color:#1d4ed8;cursor:pointer;">✏️ 編集</button>
        <button onclick="closeShijishoView()" style="background:#f8fafc;border:1.5px solid var(--border);border-radius:10px;padding:10px 14px;font-size:20px;cursor:pointer;color:var(--sub);">×</button>
      </div>
    </div>
    ${(()=>{
      const filterMonth=document.getElementById('filterMonth')?.value||'';
      const all=(S.orders||[]).filter(o=>inMonthOrCarryover(o,filterMonth));
      const uninvoiced=all.filter(o=>!o.invoiceDone&&!(o.progress||[]).includes('請求書済')).length;
      const total=all.length;
      const done=total-uninvoiced;
      const pct=total?Math.round(done/total*100):0;
      const monthLabel=filterMonth?`${filterMonth.replace('-','年')}月`:'全期間';
      return uninvoiced>0?`<div id="invoiceBanner" style="padding:10px 16px;background:#fff7ed;border-bottom:1px solid #fed7aa">
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;color:#92400e;margin-bottom:5px">
          <span>📄 ${monthLabel}の請求書未済 残り${uninvoiced}件</span><span>${done}/${total}件完了 ${pct}%</span>
        </div>
        <div style="background:#fed7aa;border-radius:99px;height:8px;overflow:hidden">
          <div style="background:#f97316;width:${pct}%;height:100%;border-radius:99px"></div>
        </div>
      </div>`:`<div id="invoiceBanner" style="padding:8px 16px;background:#f0fdf4;border-bottom:1px solid #bbf7d0;font-size:12px;font-weight:700;color:#15803d">✅ ${monthLabel}の請求書はすべて完了しています</div>`;
    })()}
    <div style="max-width:900px;margin:0 auto;padding:16px">
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:16px">
        ${shijishoField('👤 顧客名',order.custName)}
        ${shijishoField('🚗 車名',order.carName)}
        ${shijishoField('🔢 ナンバー',order.carPlate)}
        ${shijishoField('📅 入庫日',order.dateIn)}
        ${shijishoField('📅 出庫予定',order.dateOut)}
        ${shijishoField('🔧 メイン担当',order.mechName)}
        ${subNames ? shijishoField('👥 サブ担当',subNames) : ''}
      </div>
      ${sakugyoHtml}${photoHtml}
      <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:12px">
        <div style="color:var(--accent);font-size:13px;font-weight:700;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border)">📄 請求書</div>
        <button id="invoiceBtn_${order.id}" onclick="toggleInvoiceDoneDetail('${order.id}')" style="width:100%;padding:12px;border-radius:10px;border:2px solid ${(order.invoiceDone||(order.progress||[]).includes('請求書済'))?'#7e22ce':'#d1d5db'};background:${(order.invoiceDone||(order.progress||[]).includes('請求書済'))?'#f3e8ff':'#f8fafc'};font-size:15px;font-weight:700;color:${(order.invoiceDone||(order.progress||[]).includes('請求書済'))?'#7e22ce':'#6b7280'};cursor:pointer">
          ${(order.invoiceDone||(order.progress||[]).includes('請求書済'))?'✅ 請求書済':'📄 請求書未済（タップで済にする）'}
        </button>
        ${(order.invoiceDone||(order.progress||[]).includes('請求書済'))?'':`
        <button id="invoiceSkipBtn_${order.id}" onclick="skipInvoice('${order.id}')" style="width:100%;margin-top:8px;padding:12px;border-radius:10px;border:1.5px solid #d1d5db;background:#fff;font-size:15px;font-weight:700;color:#475569;cursor:pointer">⏭ まだ作れない → 後回しにして次へ</button>`}
        ${_invoiceSkipped.size?`<div style="margin-top:8px;font-size:12px;color:#64748b;display:flex;justify-content:space-between;align-items:center;gap:8px"><span>後回し中：${_invoiceSkipped.size}件</span><button onclick="resetInvoiceSkips()" style="background:none;border:none;color:#7e22ce;font-size:12px;font-weight:700;cursor:pointer;text-decoration:underline">後回しを解除</button></div>`:''}
      </div>
      <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:12px">
        <div style="color:var(--accent);font-size:13px;font-weight:700;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border)">📷 写真を追加</div>
        <div style="margin-bottom:10px">
          <button class="btn btn-gray btn-sm" style="width:100%" onclick="addPhotoToOrder('${order.id}','shijisho-photos','写真')">📷 写真を追加</button>
        </div>
        <div id="shijisho-photos" style="display:grid;grid-template-columns:1fr 1fr;gap:8px"></div>
      </div>
    </div>
  </div>`);
}

async function joinAsSubStaff(orderId) {
  const order = S.orders.find(o=>o.id===orderId); if(!order||!currentUser) return;
  order.subStaff = order.subStaff||[];
  if(order.subStaff.find(s=>s.id===currentUser.id)) return;
  order.subStaff.push({ id:currentUser.id, name:currentUser.name });
  saveState();
  const ok = await sbSaveOrder(order);
  showToast(ok?`${currentUser.name} がサブ担当として参加しました`:'参加登録失敗', ok?'success':'error');
  closeShijishoView();
  openShijishoView(order);
}

function addPhotoToOrder(orderId,containerId,type) {
  const fileId='view-photo-file-'+(++photoCounter);
  const input=document.createElement('input');
  input.type='file'; input.accept='image/*'; input.multiple=true; input.style.display='none'; input.id=fileId;
  document.body.appendChild(input);
  input.onchange=async()=>{
    const container=document.getElementById(containerId);
    const fileCount = input.files.length;
    if (fileCount === 0) { input.remove(); return; }
    showToast(`📷 ${fileCount}枚アップロード中...`, 'info', 60000);
    let doneCount = 0;
    Array.from(input.files).forEach(file=>{
      _compressAndRun(file,async compressed=>{
        const div=document.createElement('div'); div.style.cssText='background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px';
        div.innerHTML=`<div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:4px">${type}</div><img src="${compressed}" style="width:100%;border-radius:6px"><div style="color:var(--sub);font-size:10px;margin-top:3px;text-align:center">保存中...</div>`;
        if(container) container.appendChild(div);
        if(sb){
          const rows=await _buildPhotoRows(orderId,[{type,dataUrl:compressed}]);
          const ok=await sbWrite(DB_TABLES.PHOTOS,'insert',rows,null);
          const s=div.querySelector('div:last-child');
          if(ok){ if(s){s.textContent='✅ 保存完了'; s.style.color='var(--ok)'; s.style.fontWeight='700';} }
          else { if(s){s.textContent='⚠️ 保留中（自動で再送信します）'; s.style.color='var(--danger)'; s.style.fontWeight='700';} }
        }
        doneCount++;
        if (doneCount === fileCount) {
          hideToast();
          showToast(`✅ ${fileCount}枚の写真を保存しました`, 'success', 3000);
        }
      });
    });
    input.remove();
  };
  input.click();
}

function sendLineReport(orderId) {
  const order=S.orders.find(o=>o.id===orderId); if(!order) return;
  const subNames=(order.subStaff||[]).map(s=>s.name).join('・');
  let text=`【${order.type==='shakken'?'車検':'作業'}指示書】${order.orderNum||''}\n`;
  if(order.custName) text+=`顧客: ${order.custName}\n`;
  if(order.carName)  text+=`車両: ${order.carName} ${order.carPlate||''}\n`;
  text+=`入庫: ${order.dateIn||''}　出庫予定: ${order.dateOut||''}\n`;
  text+=`担当: ${order.mechName||''}${subNames?'・'+subNames:''}\n`;
  if(order.remarks) text+=`\n【備考】${order.remarks}`;
  window.open('https://line.me/R/share?text='+encodeURIComponent(text),'_blank');
}

function closeShijishoView() { document.getElementById('shijishoView')?.remove(); }

// ─── 写真全画面表示 ───────────────────────────────────────────
let _fsRotation = 0;
let _fsPhotoId  = null;

function openPhotoFullscreen(src, type, photoId) {
  _fsRotation = 0;
  _fsPhotoId  = photoId || null;
  const div = document.createElement('div');
  div.id = 'photoFullscreen';
  div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:flex-start';
  const btnArea = document.createElement('div');
  btnArea.style.cssText = 'display:flex;align-items:center;gap:10px;padding:14px 12px;flex-wrap:wrap;justify-content:center;background:rgba(0,0,0,0.8);width:100%;box-sizing:border-box;flex-shrink:0';
  const label = document.createElement('span');
  label.textContent = type;
  label.style.cssText = 'color:#fff;font-size:13px;font-weight:700;opacity:0.8';
  const btnL = document.createElement('button');
  btnL.textContent = '↺';
  btnL.style.cssText = 'background:#444;border:none;border-radius:8px;color:#fff;font-size:20px;padding:8px 16px;cursor:pointer';
  btnL.onclick = () => rotateFs(-90);
  const btnR = document.createElement('button');
  btnR.textContent = '↻';
  btnR.style.cssText = 'background:#444;border:none;border-radius:8px;color:#fff;font-size:20px;padding:8px 16px;cursor:pointer';
  btnR.onclick = () => rotateFs(90);
  const btnSave = document.createElement('button');
  btnSave.textContent = '💾 保存';
  btnSave.style.cssText = 'background:var(--accent);border:none;border-radius:8px;color:#000;font-size:13px;font-weight:700;padding:8px 16px;cursor:pointer';
  btnSave.onclick = () => saveFsPhoto();
  const btnClose = document.createElement('button');
  btnClose.textContent = '✕ 閉じる';
  btnClose.style.cssText = 'background:#666;border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:700;padding:8px 16px;cursor:pointer';
  btnClose.onclick = () => closePhotoFullscreen();
  btnArea.appendChild(label); btnArea.appendChild(btnL); btnArea.appendChild(btnR); btnArea.appendChild(btnSave); btnArea.appendChild(btnClose);
  const imgWrap = document.createElement('div');
  imgWrap.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;width:100%';
  const imgEl = document.createElement('img');
  imgEl.id = 'fsPhoto';
  if (/^https?:/.test(src)) imgEl.crossOrigin = 'anonymous'; // 回転保存のため
  imgEl.src = src;
  imgEl.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;transition:transform 0.3s;transform-origin:center';
  imgWrap.appendChild(imgEl);
  div.appendChild(btnArea); div.appendChild(imgWrap);
  document.body.appendChild(div);
}

function rotateFs(deg) {
  _fsRotation = (_fsRotation + deg + 360) % 360;
  const img = document.getElementById('fsPhoto');
  if (img) img.style.transform = 'rotate(' + _fsRotation + 'deg)';
}

async function saveFsPhoto() {
  const img = document.getElementById('fsPhoto');
  if (!img) return;
  if (_fsRotation === 0) { closePhotoFullscreen(); return; }
  const rad = _fsRotation * Math.PI / 180;
  const sin = Math.abs(Math.sin(rad)), cos = Math.abs(Math.cos(rad));
  const sw = img.naturalWidth, sh = img.naturalHeight;
  const cw = Math.round(sw*cos+sh*sin), ch = Math.round(sw*sin+sh*cos);
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.translate(cw/2, ch/2); ctx.rotate(rad);
  ctx.drawImage(img, -sw/2, -sh/2);
  let newSrc;
  try { newSrc = canvas.toDataURL('image/jpeg', 0.85); }
  catch(e) { showToast('⚠️ この写真は回転保存できません', 'error'); closePhotoFullscreen(); return; }
  if (sb && _fsPhotoId) {
    const oldUrl = /^https?:/.test(img.src) ? img.src : '';
    const newUrl = await _uploadPhotoToStorage(currentOrder?.id || 'rotated', newSrc);
    const payload = newUrl ? { photo_url: newUrl, photo_b64: '' } : { photo_b64: newSrc };
    const ok = await sbWrite(DB_TABLES.PHOTOS, 'update', payload, _fsPhotoId);
    if (ok) {
      showToast('✅ 保存しました', 'success');
      const shown = newUrl || newSrc;
      document.querySelectorAll('img').forEach(el => { if (el.src === img.src && el !== img) { el.src = shown; el.dataset.url = newUrl || ''; } });
      const oldPath = newUrl ? _storagePathFromUrl(oldUrl) : '';
      if (oldPath) { try { await sb.storage.from(PHOTO_BUCKET).remove([oldPath]); } catch(e) {} }
    } else {
      showToast('⚠️ 通信失敗。自動で再送信します', 'error');
    }
  }
  closePhotoFullscreen();
}

function closePhotoFullscreen() {
  document.getElementById('photoFullscreen')?.remove();
  _fsRotation = 0; _fsPhotoId = null;
}

function openManageModal(id) {
  const order=S.orders.find(o=>o.id===id); if(!order) return;
  document.body.insertAdjacentHTML('beforeend',`
  <div style="position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:600;display:flex;align-items:center;justify-content:center;padding:20px" id="manageModal">
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;width:100%;max-width:400px">
      <div style="color:var(--accent);font-size:16px;font-weight:800;margin-bottom:16px">⚙️ 管理 - ${esc(order.orderNum)}</div>
      <div style="color:var(--sub);font-size:12px;font-weight:700;margin-bottom:8px">ステータス変更</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
        ${['入庫待ち','入庫中','作業中','完了','引渡済','車検中'].map(s=>`<button class="btn btn-sm${order.status===s?' btn-primary':' btn-gray'}" onclick="changeStatus('${id}','${s}');closeManageModal()">${s}</button>`).join('')}
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-danger btn-sm" style="flex:1" onclick="if(deleteOrder('${id}')){closeManageModal();closeShijishoView();loadList();}">🗑️ 削除</button>
        <button class="btn btn-gray btn-sm" style="flex:1" onclick="closeManageModal()">キャンセル</button>
      </div>
    </div>
  </div>`);
}

function closeManageModal() { document.getElementById('manageModal')?.remove(); }

// ─── 編集モーダル ─────────────────────────────────────────────
let editOrder = null;
let editRepairType = 'car';
let editSkType = 'car';
let editCarCheck = {};
let editTruckCheck = {};
let editAirconCheck = {};
let editSkCheck = {};
let editSkTruckCheck = {};

function openEditModal(id) {
  const order = S.orders.find(o => o.id === id);
  if (!order) return;
  editOrder = JSON.parse(JSON.stringify(order));
  editRepairType = order.repairType || 'car';
  editSkType = order.repairType || 'car';
  editCarCheck   = {};
  editTruckCheck = {};
  editAirconCheck= {};
  editSkCheck    = {};
  editSkTruckCheck = {};
  editSkNotice  = {};
  editSkPrevent = {};
  editSkLights  = {};
  editRepairNotice  = {};
  editRepairPrevent = {};

  // チェック状態を復元
  (order.carItems||[]).forEach(k => editCarCheck[k] = true);
  (order.truckItems||[]).forEach(k => editTruckCheck[k] = true);
  (order.airconItems||[]).forEach(k => editAirconCheck[k] = true);

  // 修理のnotice/preventを復元
  if (order.type === 'repair') {
    (order.noticeItems||[]).forEach(k => editRepairNotice[k] = true);
    Object.entries(order.preventResults||{}).forEach(([k,v]) => { if(v) editRepairPrevent[k] = v; });
  }

  // 車検の選択状態を復元（全項目に対して）
  if (order.type === 'shakken') {
    Object.entries(order.skResults||{}).forEach(([k,v]) => {
      if(v) {
        editSkCheck[k] = v;
        editSkTruckCheck[k] = {work: v};
      }
    });
    Object.entries(order.skTruckNotice||{}).forEach(([k,v]) => { if(v) editSkNotice[k] = v; });
    Object.entries(order.skTruckPrevent||{}).forEach(([k,v]) => { if(v) editSkPrevent[k] = v; });
    Object.entries(order.skTruckLights||{}).forEach(([k,v]) => { if(v) editSkLights[k] = v; });
  }

  document.body.insertAdjacentHTML('beforeend', `
  <div style="position:fixed;inset:0;background:var(--bg);z-index:700;overflow-y:auto" id="editModal">
    <div style="position:sticky;top:0;background:var(--card);border-bottom:2px solid var(--accent);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;z-index:10;gap:8px">
      <div style="font-size:16px;font-weight:800;color:var(--accent)">✏️ 編集 - ${esc(order.orderNum)}</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" onclick="saveEdit()">💾 保存</button>
        <button class="btn btn-gray btn-sm" onclick="closeEditModal()">✕</button>
      </div>
    </div>
    <div style="max-width:900px;margin:0 auto;padding:16px">

      <!-- 基本情報 -->
      <div class="card" style="margin-bottom:12px">
        <div class="card-title">基本情報</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">顧客名</div>
            <input id="edit-custName" value="${esc(order.custName)}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">車名</div>
            <input id="edit-carName" value="${esc(order.carName)}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">ナンバー</div>
            <input id="edit-carPlate" value="${esc(order.carPlate)}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">入庫日</div>
            <input id="edit-dateIn" type="date" value="${order.dateIn||''}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">出庫予定日</div>
            <input id="edit-dateOut" type="date" value="${order.dateOut||''}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">担当整備士</div>
            <input id="edit-mechName" value="${esc(order.mechName)}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">ステータス</div>
            <select id="edit-status" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box">
              ${['入庫待ち','入庫中','作業中','完了','引渡済','車検中'].map(s=>`<option value="${s}" ${order.status===s?'selected':''}>${s}</option>`).join('')}
            </select>
          </div>
          <div style="grid-column:1/-1">
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">👷 担当予定者（任意）</div>
            <input id="edit-plannedStaff" value="${order.plannedStaff||''}" placeholder="例：甲斐" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box">
          </div>
        </div>
        <div style="margin-top:10px">
          <div style="font-size:11px;color:var(--sub);margin-bottom:4px">備考・メモ</div>
          <textarea id="edit-remarks" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box;height:80px">${esc(order.remarks)}</textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
          <div>
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">入庫手段</div>
            <select id="edit-nyukoMethod" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box">
              <option value="" ${!order.nyukoMethod?'selected':''}>未設定</option>
              <option value="お客入庫" ${order.nyukoMethod==='お客入庫'?'selected':''}>🚗 お客入庫</option>
              <option value="引き取り" ${order.nyukoMethod==='引き取り'?'selected':''}>🔑 引き取り</option>
              <option value="レッカー" ${order.nyukoMethod==='レッカー'?'selected':''}>🚨 レッカー</option>
              <option value="現地修理" ${order.nyukoMethod==='現地修理'?'selected':''}>🔧 現地修理</option>
              <option value="車両入替" ${order.nyukoMethod==='車両入替'?'selected':''}>🔁 車両入替</option>
            </select>
          </div>
          <div>
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">入庫予定時間</div>
            <input id="edit-nyukoTime" type="time" value="${order.nyukoTime||''}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">引き取り場所</div>
            <input id="edit-nyukoPlace" value="${esc(order.nyukoPlace)}" placeholder="例：高槻市〇〇町" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box">
          </div>
          <div style="display:flex;align-items:center;gap:10px;padding-top:20px">
            <div style="font-size:13px;font-weight:700;color:#ff7070">🔴 部品待ち</div>
            <input type="checkbox" id="edit-partsPending" ${order.partsPending?'checked':''} style="width:22px;height:22px;cursor:pointer;accent-color:var(--danger)">
          </div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
            <div style="font-size:13px;font-weight:700;color:#40d070">📄 請求書作成済み</div>
            <input type="checkbox" id="edit-invoiceDone" ${order.invoiceDone?'checked':''} style="width:22px;height:22px;cursor:pointer;accent-color:#40d070">
          </div>
        </div>
      </div>

      <!-- 依頼事項（修理の場合） -->
      ${order.type==='repair' ? `
      <div class="card" style="margin-bottom:12px">
        <div class="card-title">✅ 依頼事項</div>
        <div style="display:flex;gap:6px;margin-bottom:12px">
          <button id="etab-car"    class="btn btn-sm ${editRepairType==='car'?'btn-primary':'btn-gray'}"    onclick="switchEditRepairType('car')">🚗 乗用車</button>
          <button id="etab-truck"  class="btn btn-sm ${editRepairType==='truck'?'btn-primary':'btn-gray'}"  onclick="switchEditRepairType('truck')">🚛 トラック</button>
          <button id="etab-aircon" class="btn btn-sm ${editRepairType==='aircon'?'btn-primary':'btn-gray'}" onclick="switchEditRepairType('aircon')">❄️ エアコン</button>
        </div>
        <div id="edit-car-items"    style="display:${editRepairType==='car'?'':'none'}"></div>
        <div id="edit-truck-items"  style="display:${editRepairType==='truck'?'':'none'}"></div>
        <div id="edit-aircon-items" style="display:${editRepairType==='aircon'?'':'none'}"></div>
      </div>

      <!-- 気がついた事（修理） -->
      <div class="card" style="margin-bottom:12px">
        <div class="card-title">👁️ 気がついた事</div>
        <div id="edit-repair-notice"></div>
      </div>

      <!-- 予防整備チェック（修理） -->
      <div class="card" style="margin-bottom:12px">
        <div class="card-title">🛡️ 予防整備チェック</div>
        <div id="edit-repair-prevent"></div>
      </div>` : ''}

      <!-- 車検点検項目（車検の場合） -->
      ${order.type==='shakken' ? `
      <div class="card" style="margin-bottom:12px">
        <div class="card-title">🔍 車検点検項目</div>
        <div style="display:flex;gap:6px;margin-bottom:12px">
          <button id="esk-tab-car"   class="btn btn-sm ${editSkType==='car'?'btn-primary':'btn-gray'}"   onclick="switchEditSkType('car')">🚗 乗用車</button>
          <button id="esk-tab-truck" class="btn btn-sm ${editSkType==='truck'?'btn-primary':'btn-gray'}" onclick="switchEditSkType('truck')">🚛 トラック</button>
        </div>
        <div id="edit-sk-car-items"   style="display:${editSkType==='car'?'':'none'}"></div>
        <div id="edit-sk-truck-items" style="display:${editSkType==='truck'?'':'none'}"></div>
      </div>

      <!-- 灯火類（トラックのみ） -->
      <div class="card" style="margin-bottom:12px;display:${editSkType==='truck'?'block':'none'}" id="edit-lights-card">
        <div class="card-title">💡 灯火類</div>
        <div id="edit-sk-lights"></div>
      </div>

      <!-- 気がついた事 -->
      <div class="card" style="margin-bottom:12px">
        <div class="card-title">👁️ 気がついた事</div>
        <div id="edit-sk-notice"></div>
      </div>

      <!-- 予防整備チェック -->
      <div class="card" style="margin-bottom:12px">
        <div class="card-title">🛡️ 予防整備チェック</div>
        <div id="edit-sk-prevent"></div>
      </div>` : ''}

    </div>
  </div>`);

  // チェックリスト描画
  if (order.type==='repair') {
    renderEditRepairItems();
    renderEditRepairNotice();
    renderEditRepairPrevent();
  }
  if (order.type==='shakken') {
    editSkType = order.repairType || 'car';
    renderEditSkItems();
    renderEditSkNotice();
    renderEditSkPrevent();
    if (editSkType === 'truck') renderEditSkLights();
  }
}

function switchEditRepairType(type) {
  editRepairType = type;
  ['car','truck','aircon'].forEach(t => {
    document.getElementById('edit-'+t+'-items').style.display = t===type ? '' : 'none';
    document.getElementById('etab-'+t).className = 'btn btn-sm ' + (t===type?'btn-primary':'btn-gray');
  });
  renderEditRepairItems();
}

function switchEditSkType(type) {
  editSkType = type;
  document.getElementById('edit-sk-car-items').style.display   = type==='car'   ? '' : 'none';
  document.getElementById('edit-sk-truck-items').style.display = type==='truck' ? '' : 'none';
  document.getElementById('esk-tab-car').className   = 'btn btn-sm '+(type==='car'?'btn-primary':'btn-gray');
  document.getElementById('esk-tab-truck').className = 'btn btn-sm '+(type==='truck'?'btn-primary':'btn-gray');
  const lightsCard = document.getElementById('edit-lights-card');
  if (lightsCard) lightsCard.style.display = type==='truck' ? 'block' : 'none';
  renderEditSkItems();
  if (type==='truck') renderEditSkLights();
}

let editSkNotice  = {};
let editSkPrevent = {};
let editSkLights  = {};
let editRepairNotice  = {};
let editRepairPrevent = {};

function renderEditRepairNotice() {
  const c = document.getElementById('edit-repair-notice'); if(!c) return;
  c.innerHTML = (S.items.notice||DEF_NOTICE).map(label => {
    const checked = editRepairNotice[label] || false;
    return `<div class="check-item${checked?' checked':''}" onclick="toggleEditRepairNotice('${label.replace(/'/g,"\\'")}')">
      <span>${checked?'✅':'⬜'}</span><span>${label}</span>
    </div>`;
  }).join('');
}

function toggleEditRepairNotice(label) {
  editRepairNotice[label] = !editRepairNotice[label];
  renderEditRepairNotice();
}

function renderEditRepairPrevent() {
  const c = document.getElementById('edit-repair-prevent'); if(!c) return;
  c.innerHTML = DEF_PREVENT_OKNG.map(label => {
    const val = editRepairPrevent[label]||'';
    return `<div style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:6px">
      <span style="flex:1;font-size:14px">${label}</span>
      <button onclick="setEditRepairPrevent('${label.replace(/'/g,"\\'")}','OK')" style="padding:8px 18px;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;background:${val==='OK'?'var(--ok)':'var(--border)'};color:${val==='OK'?'#fff':'var(--sub)'}">OK</button>
      <button onclick="setEditRepairPrevent('${label.replace(/'/g,"\\'")}','NG')" style="padding:8px 18px;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;background:${val==='NG'?'var(--danger)':'var(--border)'};color:${val==='NG'?'#fff':'var(--sub)'}">NG</button>
    </div>`;
  }).join('');
}

function setEditRepairPrevent(label, val) {
  editRepairPrevent[label] = editRepairPrevent[label]===val ? '' : val;
  renderEditRepairPrevent();
}

function renderEditSkNotice() {
  const c = document.getElementById('edit-sk-notice'); if(!c) return;
  // 初期値を復元
  if (editOrder) {
    Object.entries(editOrder.skTruckNotice||{}).forEach(([k,v])=>{ if(v) editSkNotice[k]=v; });
  }
  c.innerHTML = DEF_SK_TRUCK_NOTICE.map(label => {
    const val = editSkNotice[label]||'';
    return `<div style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:6px">
      <span style="flex:1;font-size:14px">${label}</span>
      <button onclick="setEditSkNotice('${label}','OK')" style="padding:8px 18px;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;background:${val==='OK'?'var(--ok)':'var(--border)'};color:${val==='OK'?'#fff':'var(--sub)'}">OK</button>
      <button onclick="setEditSkNotice('${label}','NG')" style="padding:8px 18px;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;background:${val==='NG'?'var(--danger)':'var(--border)'};color:${val==='NG'?'#fff':'var(--sub)'}">NG</button>
    </div>`;
  }).join('');
}

function setEditSkNotice(label, val) {
  editSkNotice[label] = editSkNotice[label]===val ? '' : val;
  renderEditSkNotice();
}

function renderEditSkPrevent() {
  const c = document.getElementById('edit-sk-prevent'); if(!c) return;
  if (editOrder) {
    Object.entries(editOrder.skTruckPrevent||{}).forEach(([k,v])=>{ if(v) editSkPrevent[k]=v; });
  }
  c.innerHTML = DEF_SK_TRUCK_PREVENT.map(label => {
    const val = editSkPrevent[label]||'';
    return `<div style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:6px">
      <span style="flex:1;font-size:14px">${label}</span>
      <button onclick="setEditSkPrevent('${label}','OK')" style="padding:8px 18px;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;background:${val==='OK'?'var(--ok)':'var(--border)'};color:${val==='OK'?'#fff':'var(--sub)'}">OK</button>
      <button onclick="setEditSkPrevent('${label}','NG')" style="padding:8px 18px;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;background:${val==='NG'?'var(--danger)':'var(--border)'};color:${val==='NG'?'#fff':'var(--sub)'}">NG</button>
    </div>`;
  }).join('');
}

function setEditSkPrevent(label, val) {
  editSkPrevent[label] = editSkPrevent[label]===val ? '' : val;
  renderEditSkPrevent();
}

function renderEditSkLights() {
  const c = document.getElementById('edit-sk-lights'); if(!c) return;
  if (editOrder) {
    Object.entries(editOrder.skTruckLights||{}).forEach(([k,v])=>{ if(v) editSkLights[k]=v; });
  }
  const headItems  = ['ヘッドライト球（HID）左','ヘッドライト球（HID）右','ヘッドライト球（ハロゲン）左','ヘッドライト球（ハロゲン）右'];
  const countItems = ['ポジション球','ウインカー球','車高灯','ナンバー灯球','マーカー球','マーカーASSY','メーターパネル球','フォグランプ球','スイッチ球'];
  let html = '';
  headItems.forEach(label => {
    const val = editSkLights[label]||'';
    html += `<div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--border);flex-wrap:wrap">
      <span style="flex:1;font-size:13px">${label}</span>
      <div style="display:flex;gap:4px">
        <button class="sk-btn${val==='交換'?' sel':''}" onclick="setEditSkLight('${label}','交換')">交換</button>
        <button class="sk-btn${val==='不要'?' sel':''}" onclick="setEditSkLight('${label}','不要')">不要</button>
      </div></div>`;
  });
  countItems.forEach(label => {
    const val = editSkLights[label]||'';
    const opts = ['不要','1個','2個','3個','4個','5個'];
    html += `<div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--border);flex-wrap:wrap">
      <span style="flex:1;font-size:13px">${label}</span>
      <div style="display:flex;gap:4px;flex-wrap:wrap">${opts.map(o=>`<button class="sk-btn${val===o?' sel':''}" onclick="setEditSkLight('${label}','${o}')">${o}</button>`).join('')}</div></div>`;
  });
  c.innerHTML = html;
}

function setEditSkLight(label, val) {
  editSkLights[label] = editSkLights[label]===val ? '' : val;
  renderEditSkLights();
}

function renderEditRepairItems() {
  const configs = {
    car:    { id:'edit-car-items',    items: S.carRepairItems||DEF_CAR_REPAIR,      state: editCarCheck },
    truck:  { id:'edit-truck-items',  items: S.truckRepairItems||DEF_TRUCK_REPAIR,  state: editTruckCheck },
    aircon: { id:'edit-aircon-items', items: S.airconRepairItems||DEF_AIRCON_REPAIR, state: editAirconCheck },
  };
  Object.entries(configs).forEach(([type, cfg]) => {
    const c = document.getElementById(cfg.id); if(!c) return;
    c.innerHTML = '';
    cfg.items.forEach(label => {
      const checked = cfg.state[label] || false;
      const d = document.createElement('div');
      d.className = 'check-item' + (checked?' checked':'');
      d.innerHTML = `<span>${checked?'✅':'⬜'}</span><span>${label}</span>`;
      d.onclick = () => {
        cfg.state[label] = !cfg.state[label];
        renderEditRepairItems();
      };
      c.appendChild(d);
    });
  });
}

function renderEditSkItems() {
  if (editSkType === 'car') {
    const c = document.getElementById('edit-sk-car-items'); if(!c) return;
    c.innerHTML = '';
    (S.skItems||DEF_SK).forEach((item) => {
      const cur = editSkCheck[item.label] || '';
      const opts = (item.opts||'良好').split('/');
      const d = document.createElement('div'); d.className = 'sk-item';
      d.innerHTML = `<span class="sk-item-label">${item.label}</span><div class="sk-btns">${opts.map(o=>`<button class="sk-btn${cur===o?' sel':''}" onclick="setEditSkWork('${item.label.replace(/'/g,"\\'")}','${o}')">${o}</button>`).join('')}</div>`;
      c.appendChild(d);
    });
  } else {
    const c = document.getElementById('edit-sk-truck-items'); if(!c) return;
    c.innerHTML = '';
    // 整備KIT/シールKIT/分解無しの特別ボタン
    const kitVal = editSkTruckCheck['__kit__']?.work || '';
    const kitDiv = document.createElement('div');
    kitDiv.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap';
    kitDiv.innerHTML = ['整備KIT','シールKIT','分解無し'].map(o=>`<button class="sk-btn${kitVal===o?' sel':''}" style="padding:8px 16px;font-size:13px" onclick="setEditSkTruckWork('__kit__','${o}')">${o}</button>`).join('');
    c.appendChild(kitDiv);

    (S.skTruckItems||DEF_SK_TRUCK).forEach((item) => {
      if(item.label===' ') return; // 最初の空ラベルはスキップ（上でkit処理済み）
      const cur = editSkTruckCheck[item.label]?.work || '';
      const opts = (item.opts||'交換/不要').split('/');
      const d = document.createElement('div'); d.className = 'sk-item';
      d.innerHTML = `<span class="sk-item-label">${item.label}</span><div class="sk-btns">${opts.map(o=>`<button class="sk-btn${cur===o?' sel':''}" onclick="setEditSkTruckWork('${item.label.replace(/'/g,"\\'")}','${o}')">${o}</button>`).join('')}</div>`;
      c.appendChild(d);
    });
  }
}

function setEditSkWork(label, val) {
  editSkCheck[label] = editSkCheck[label]===val ? '' : val;
  renderEditSkItems();
}

function setEditSkTruckWork(label, val) {
  editSkTruckCheck[label] = editSkTruckCheck[label]?.work===val ? {} : {work:val};
  renderEditSkItems();
}

async function saveEdit() {
  if (!editOrder) return;
  const order = S.orders.find(o => o.id === editOrder.id);
  if (!order) return;

  order.custName  = document.getElementById('edit-custName')?.value.trim() || order.custName;
  order.carName   = document.getElementById('edit-carName')?.value.trim()  || order.carName;
  order.carPlate  = document.getElementById('edit-carPlate')?.value.trim() || order.carPlate;
  order.dateIn    = document.getElementById('edit-dateIn')?.value           || order.dateIn;
  order.dateOut   = document.getElementById('edit-dateOut')?.value          || order.dateOut;
  order.mechName  = document.getElementById('edit-mechName')?.value.trim() || order.mechName;
  order.status    = document.getElementById('edit-status')?.value           || order.status;
  if((order.status==='完了'||order.status==='引渡済') && !order.completedAt) order.completedAt=new Date().toISOString();
  order.remarks   = document.getElementById('edit-remarks')?.value          || '';
  order.plannedStaff = document.getElementById('edit-plannedStaff')?.value.trim() || '';
  order.nyukoMethod  = document.getElementById('edit-nyukoMethod')?.value  || '';
  order.nyukoTime    = document.getElementById('edit-nyukoTime')?.value     || '';
  order.nyukoPlace   = document.getElementById('edit-nyukoPlace')?.value.trim() || '';
  order.partsPending = document.getElementById('edit-partsPending')?.checked || false;
  order.invoiceDone  = document.getElementById('edit-invoiceDone')?.checked  || false;

  if (order.type === 'repair') {
    order.repairType    = editRepairType;
    order.carItems      = Object.entries(editCarCheck).filter(([,v])=>v).map(([k])=>k);
    order.truckItems    = Object.entries(editTruckCheck).filter(([,v])=>v).map(([k])=>k);
    order.airconItems   = Object.entries(editAirconCheck).filter(([,v])=>v).map(([k])=>k);
    order.noticeItems   = Object.entries(editRepairNotice).filter(([,v])=>v).map(([k])=>k);
    order.preventResults= { ...editRepairPrevent };
  }

  if (order.type === 'shakken') {
    order.repairType = editSkType;
    const skResults = {};
    if (editSkType === 'car') {
      Object.entries(editSkCheck).forEach(([k,v]) => { if(v) skResults[k] = v; });
    } else {
      Object.entries(editSkTruckCheck).forEach(([k,v]) => { if(v?.work) skResults[k] = v.work; });
    }
    order.skResults     = skResults;
    order.skTruckNotice  = { ...editSkNotice };
    order.skTruckPrevent = { ...editSkPrevent };
    order.skTruckLights  = { ...editSkLights };
  }

  order.savedAt = new Date().toLocaleString('ja-JP');
  saveState();
  const ok = await sbSaveOrder(order);
  showToast(ok ? '✅ 保存しました' : '⚠️ クラウド同期失敗。自動で再送信します', ok?'success':'error');
  closeEditModal();
  closeShijishoView();
  openShijishoView(order);
}

function closeEditModal() {
  document.getElementById('editModal')?.remove();
  editOrder = null;
  editSkNotice = {};
  editSkPrevent = {};
  editSkLights = {};
}

function openAddPhotoModal(orderId) {
  document.body.insertAdjacentHTML('beforeend',`
  <div style="position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:600;display:flex;align-items:flex-end;justify-content:center" id="addPhotoModal">
    <div style="background:var(--card);border-radius:16px 16px 0 0;padding:20px;width:100%;max-width:640px;max-height:85vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="color:var(--accent);font-size:16px;font-weight:800">📷 写真を追加</div>
        <button onclick="closeAddPhotoModal()" style="background:none;border:none;color:var(--sub);font-size:20px;cursor:pointer">✕</button>
      </div>
      <div id="addPhotoSlots" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px"></div>
      <button class="btn btn-gray" style="width:100%;margin-bottom:10px" onclick="addPhotoSlot('addPhotoSlots','写真')">＋ 写真を選択</button>
      <button class="btn btn-primary" style="width:100%" onclick="saveAddedPhotos('${orderId}')">💾 保存</button>
    </div>
  </div>`);
}

function closeAddPhotoModal() { document.getElementById('addPhotoModal')?.remove(); window._pendingPhotos={}; }

async function saveAddedPhotos(orderId) {
  const pending=window._pendingPhotos||{}; const keys=Object.keys(pending);
  if(!keys.length) { showToast('写真を選択してください','error'); return; }
  const rows = await _buildPhotoRows(orderId, keys.map(k=>({type:pending[k].type||'写真',dataUrl:pending[k].dataUrl})));
  const ok = await sbWrite(DB_TABLES.PHOTOS, 'insert', rows, null);
  if (ok) {
    showToast('写真を保存しました','success');
    window._pendingPhotos={};
    closeAddPhotoModal();
    const order=S.orders.find(o=>o.id===orderId);
    if(order){closeShijishoView();openShijishoView(order);}
  } else {
    showToast('⚠️ 通信失敗。自動で再送信します','error');
    window._pendingPhotos={};
    closeAddPhotoModal();
  }
}

async function toggleInvoiceDoneDetail(id) {
  const order = S.orders.find(o=>o.id===id); if(!order) return;
  const wasNotDone = !(order.invoiceDone||(order.progress||[]).includes('請求書済'));
  order.invoiceDone = !order.invoiceDone;
  // progressからも同期
  if(order.invoiceDone) {
    if(!(order.progress||[]).includes('請求書済')) order.progress=[...(order.progress||[]),'請求書済'];
  } else {
    order.progress=(order.progress||[]).filter(p=>p!=='請求書済');
  }
  saveState(); await sbSaveOrder(order);
  const done=order.invoiceDone||(order.progress||[]).includes('請求書済');
  const btn=document.getElementById(`invoiceBtn_${id}`);
  if(btn){
    btn.style.borderColor=done?'#7e22ce':'#d1d5db';
    btn.style.background=done?'#f3e8ff':'#f8fafc';
    btn.style.color=done?'#7e22ce':'#6b7280';
    btn.textContent=done?'✅ 請求書済':'📄 請求書未済（タップで済にする）';
  }
  // バナーを再描画
  const filterMonth=document.getElementById('filterMonth')?.value||'';
  const all=(S.orders||[]).filter(o=>inMonthOrCarryover(o,filterMonth));
  const uninvoiced=all.filter(o=>!o.invoiceDone&&!(o.progress||[]).includes('請求書済')).length;
  const total=all.length; const doneCount=total-uninvoiced;
  const pct=total?Math.round(doneCount/total*100):0;
  const monthLabel=filterMonth?`${filterMonth.replace('-','年')}月`:'全期間';
  const banner=document.getElementById('invoiceBanner');
  if(banner){
    banner.style.background=uninvoiced>0?'#fff7ed':'#f0fdf4';
    banner.style.borderBottomColor=uninvoiced>0?'#fed7aa':'#bbf7d0';
    banner.innerHTML=uninvoiced>0?`
      <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;color:#92400e;margin-bottom:5px">
        <span>📄 ${monthLabel}の請求書未済 残り${uninvoiced}件</span><span>${doneCount}/${total}件完了 ${pct}%</span>
      </div>
      <div style="background:#fed7aa;border-radius:99px;height:8px;overflow:hidden">
        <div style="background:#f97316;width:${pct}%;height:100%;border-radius:99px"></div>
      </div>`
      :`<div style="font-size:12px;font-weight:700;color:#15803d">✅ ${monthLabel}の請求書はすべて完了しています</div>`;
  }
  showToast(done?'📄 請求書済にしました':'📄 請求書未に戻しました','success');
  loadList();
  if(wasNotDone && done){
    _invoiceSkipped.delete(id);
    closeShijishoView();
    setTimeout(()=>goNextUninvoiced(id),350);
  }
}

// ─── 請求書：後回し（スキップ）────────────────────────────────
// まだ請求書が作れない指示書を一時的に飛ばす。ページを閉じるまで（タブ単位で）覚えておく
const _invoiceSkipped = new Set(JSON.parse(sessionStorage.getItem('wc_invoice_skipped')||'[]'));
function _saveInvoiceSkips(){ sessionStorage.setItem('wc_invoice_skipped', JSON.stringify([..._invoiceSkipped])); }
function _isInvoiced(o){ return o.invoiceDone || (o.progress||[]).includes('請求書済'); }
function _uninvoicedQueue(){
  const filterMonth=document.getElementById('filterMonth')?.value||'';
  const isDni=document.getElementById('filterExtra')?.value==='deliveredNoInvoice';
  return (S.orders||[])
    .filter(o=>isDni ? o.status==='引渡済' : inMonthOrCarryover(o,filterMonth))
    .filter(o=>!_isInvoiced(o))
    .sort((a,b)=>(a.dateIn||a.savedAt||'').localeCompare(b.dateIn||b.savedAt||''));
}
function goNextUninvoiced(currentId){
  const queue=_uninvoicedQueue();
  const next=queue.find(o=>o.id!==currentId && !_invoiceSkipped.has(o.id));
  if(next){
    showToast(`次: ${next.orderNum||next.custName||''}`,'info');
    showDetail(next.id);
    return;
  }
  const skippedLeft=queue.filter(o=>_invoiceSkipped.has(o.id)).length;
  if(skippedLeft){
    if(confirm(`未請求は残り、後回しにした${skippedLeft}件だけです。\nもう一度最初から見ますか？`)){
      resetInvoiceSkips(true);
      const first=_uninvoicedQueue()[0];
      if(first) showDetail(first.id);
    } else {
      showToast(`後回し ${skippedLeft}件が残っています`,'info');
    }
  } else {
    showToast('🎉 未請求の指示書はすべて終わりました','success');
  }
}
function skipInvoice(id){
  _invoiceSkipped.add(id); _saveInvoiceSkips();
  closeShijishoView();
  goNextUninvoiced(id);
}
function resetInvoiceSkips(silent){
  _invoiceSkipped.clear(); _saveInvoiceSkips();
  if(!silent){
    showToast('後回しを解除しました','info');
    const v=document.getElementById('shijishoView');
    if(v && currentOrder){ closeShijishoView(); openShijishoView(currentOrder); }
  }
}

async function toggleInvoiceDoneList(id) {
  const order = S.orders.find(o => o.id === id);
  if (!order) return;
  order.invoiceDone = !order.invoiceDone;
  // 「請求書済」の進捗タグも揃える（片方だけ残ると件数がずれるため）
  order.progress = (order.progress||[]).filter(p=>p!=='請求書済');
  if (order.invoiceDone) order.progress.push('請求書済');
  saveState();
  await sbSaveOrder(order);
  showToast(order.invoiceDone ? '📄 請求書済にしました' : '📄 請求書未に戻しました', 'success');
  loadList();
}

async function toggleRecordDoneList(id) {
  const order = S.orders.find(o => o.id === id);
  if (!order) return;
  order.recordDone = !order.recordDone;
  saveState();
  await sbSaveOrder(order);
  showToast(order.recordDone ? '📋 記録簿済にしました' : '📋 記録簿未に戻しました', 'success');
  loadList();
}

async function toggleBookmark(id) {
  const order = S.orders.find(o => o.id === id);
  if (!order) return;
  order.bookmarked = !order.bookmarked;
  saveState();
  await sbSaveOrder(order);
  showToast(order.bookmarked ? '⭐ ブックマークしました' : 'ブックマークを解除しました', 'success');
  closeShijishoView();
  openShijishoView(order);
  loadList();
}

async function toggleInvoiceDone(id) {
  const order = S.orders.find(o => o.id === id);
  if (!order) return;
  order.invoiceDone = !order.invoiceDone;
  saveState();
  await sbSaveOrder(order);
  showToast(order.invoiceDone ? '📄 請求書作成済みにしました' : '請求書未に戻しました', 'success');
  closeShijishoView();
  openShijishoView(order);
  loadList();
}

async function toggleRecordDone(id) {
  const order = S.orders.find(o => o.id === id);
  if (!order) return;
  order.recordDone = !order.recordDone;
  saveState();
  await sbSaveOrder(order);
  showToast(order.recordDone ? '📋 記録簿作成済みにしました' : '記録簿未に戻しました', 'success');
  closeShijishoView();
  openShijishoView(order);
  loadList();
}

function changeStatus(id,status) {
  const order=S.orders.find(o=>o.id===id); if(!order) return;
  order.status=status;
  if((status==='完了'||status==='引渡済') && !order.completedAt) order.completedAt=new Date().toISOString();
  saveState(); sbSaveOrder(order);
  showToast(`ステータスを「${status}」に変更しました`,'success');
  closeShijishoView(); openShijishoView(order); loadList();
}

function deleteOrder(id) {
  if(!confirm('この指示書を削除しますか？')) return false;
  S.orders=S.orders.filter(o=>o.id!==id); saveState(); sbDeleteOrder(id);
  showToast('削除しました','info');
  return true;
}

// ─── 全画面入力 ───────────────────────────────────────────────
let fsTargetId=null;
function openFs(inputId,label) {
  const el=document.getElementById(inputId); fsTargetId=inputId;
  document.getElementById('fsLabel').textContent=label;
  document.getElementById('fsInput').value=el?el.value:'';
  document.getElementById('fsModal').classList.add('open');
  setTimeout(()=>document.getElementById('fsInput').focus(),100);
}
function openFsTextarea(inputId,label) { openFs(inputId,label); }
function closeFs() {
  const fsVal=document.getElementById('fsInput').value;
  if(fsTargetId){const el=document.getElementById(fsTargetId);if(el){ el.value=fsVal; el.dispatchEvent(new Event('change')); }}
  document.getElementById('fsModal').classList.remove('open'); fsTargetId=null;
}

// ─── オーナー専用パネル（期間指定フィルター付き） ─────────────
async function renderOwnerPanel() {
  if (!currentUser?.is_owner) return;
  const panel = document.getElementById('panel-owner'); if(!panel) return;

  // 既存の日付入力値を保持
  const fromDate = document.getElementById('ownerFromDate')?.value || '';
  const toDate   = document.getElementById('ownerToDate')?.value   || '';

  panel.innerHTML = '<div class="loading"><span class="spinner"></span> 集計中...</div>';

  if (sbReady) { const sbOrders=await sbLoadOrders(true); if(sbOrders!==null) S.orders=sbOrders; }

  const now    = new Date();
  const thisYM = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  // 期間フィルター適用
  let filtered = S.orders;
  if (fromDate) filtered = filtered.filter(o => (o.dateIn||'') >= fromDate);
  if (toDate)   filtered = filtered.filter(o => (o.dateIn||'') <= toDate);

  const monthly      = filtered.filter(o=>(o.dateIn||'').startsWith(thisYM));
  const total        = filtered.length;
  const totalMonth   = monthly.length;
  const statusCounts = {};
  filtered.forEach(o=>{ statusCounts[o.status]=(statusCounts[o.status]||0)+1; });

  // スタッフ別集計
  const staffCounts  = {};
  filtered.forEach(o=>{
    if(o.mechName) staffCounts[o.mechName]=(staffCounts[o.mechName]||0)+1;
    (o.subStaff||[]).forEach(s=>{ staffCounts[s.name]=(staffCounts[s.name]||0)+1; });
  });
  const staffMonthly = {};
  monthly.forEach(o=>{
    if(o.mechName) staffMonthly[o.mechName]=(staffMonthly[o.mechName]||0)+1;
    (o.subStaff||[]).forEach(s=>{ staffMonthly[s.name]=(staffMonthly[s.name]||0)+1; });
  });
  const staffRanking = Object.entries(staffCounts).sort(([,a],[,b])=>b-a);

  // ログイン履歴
  let loginLogs = [];
  if(sb){
    try{
      const{data}=await sb.from(DB_TABLES.LOGS).select('*').order('created_at',{ascending:false}).limit(30);
      loginLogs=data||[];
    }catch(e){}
  }

  const periodLabel = (fromDate || toDate)
    ? `${fromDate||'〜'} 〜 ${toDate||'〜'}`
    : '全期間';

  panel.innerHTML = `
    <div class="card">
      <div class="card-title">👑 オーナー管理画面</div>

      <div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:16px">
        <div style="color:var(--sub);font-size:11px;font-weight:700;margin-bottom:10px">📅 期間指定</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input type="date" id="ownerFromDate" value="${fromDate}"
            style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--text);font-size:13px;flex:1;min-width:130px">
          <span style="color:var(--sub);font-weight:700">〜</span>
          <input type="date" id="ownerToDate" value="${toDate}"
            style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--text);font-size:13px;flex:1;min-width:130px">
        </div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button onclick="renderOwnerPanel()"
            style="flex:1;padding:10px;background:var(--accent);border:none;border-radius:8px;color:#000;font-weight:700;cursor:pointer;font-size:13px">🔍 絞り込む</button>
          <button onclick="clearOwnerFilter()"
            style="padding:10px 16px;background:var(--border);border:none;border-radius:8px;color:var(--text);cursor:pointer;font-size:13px">リセット</button>
        </div>
        ${fromDate||toDate ? `<div style="margin-top:8px;font-size:12px;color:var(--accent);text-align:center">表示中: ${periodLabel}</div>` : ''}
      </div>

      <div class="stats-grid">
        <div class="stat-card"><div class="stat-num">${totalMonth}</div><div class="stat-label">今月の件数</div></div>
        <div class="stat-card"><div class="stat-num">${total}</div><div class="stat-label">${fromDate||toDate?'期間内件数':'累計件数'}</div></div>
        <div class="stat-card"><div class="stat-num">${statusCounts['作業中']||0}</div><div class="stat-label">現在作業中</div></div>
        <div class="stat-card"><div class="stat-num">${statusCounts['入庫中']||0}</div><div class="stat-label">入庫中</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">📊 スタッフ別作業実績${fromDate||toDate?'（期間指定）':'（累計）'}</div>
      <table class="staff-stats-table">
        <thead><tr><th>順位</th><th>スタッフ</th><th>今月</th><th>${fromDate||toDate?'期間内':'累計'}</th></tr></thead>
        <tbody>
          ${staffRanking.map(([name,count],i)=>`
            <tr>
              <td><span class="rank-badge rank-${i+1}">${i+1}</span></td>
              <td style="font-weight:700">${esc(name)}</td>
              <td style="color:var(--accent);font-weight:700">${staffMonthly[name]||0}件</td>
              <td>${count}件</td>
            </tr>`).join('')}
          ${staffRanking.length===0?'<tr><td colspan="4" style="text-align:center;color:var(--sub);padding:20px">データがありません</td></tr>':''}
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="card-title">🔐 ログイン履歴（直近30件）</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${loginLogs.map(log=>`
          <div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px">
            <span style="font-size:18px">${log.action==='login'?'🔓':'🔒'}</span>
            <div style="flex:1">
              <div style="font-size:14px;font-weight:700">${esc(log.staff_name)}</div>
              <div style="font-size:11px;color:var(--sub)">${log.action==='login'?'ログイン':'ログアウト'}</div>
            </div>
            <div style="font-size:11px;color:var(--sub)">${new Date(log.created_at).toLocaleString('ja-JP')}</div>
          </div>`).join('')}
        ${loginLogs.length===0?'<div style="text-align:center;color:var(--sub);padding:20px">履歴がありません</div>':''}
      </div>
    </div>

    <div class="card">
      <div class="card-title">📦 写真の保存先を移す（動作を軽くする）</div>
      <div style="font-size:13px;color:var(--sub);line-height:1.7;margin-bottom:10px">
        以前の写真はデータベースに直接入っているため、指示書を開く時に重くなります。写真専用の保存場所へ移すと軽くなります。
        <br>Wi-Fiにつないで実行してください。途中で止まっても、もう一度押せば続きから進みます。
      </div>
      <div id="photoMigrateStatus" style="font-size:14px;font-weight:700;margin-bottom:10px">確認中...</div>
      <button id="photoMigrateBtn" class="btn btn-primary" style="width:100%" onclick="migrateOldPhotos()">📦 古い写真を移す</button>
    </div>`;
  refreshPhotoMigrateStatus();
}

async function _countOldPhotos() {
  const { count, error } = await sb.from(DB_TABLES.PHOTOS).select('id', { count: 'exact', head: true })
    .is('photo_url', null).neq('photo_b64', '');
  if (error) throw error;
  return count || 0;
}
async function refreshPhotoMigrateStatus() {
  const st = document.getElementById('photoMigrateStatus'); if (!st || !sb) return;
  const btn = document.getElementById('photoMigrateBtn');
  try {
    const n = await _countOldPhotos();
    st.textContent = n ? `移していない写真：${n}枚` : '✅ すべて移し終わっています';
    if (btn) btn.style.display = n ? '' : 'none';
  } catch(e) {
    st.textContent = '⚠️ まだ準備ができていません（Supabase で supabase_setup.sql を実行してください）';
    if (btn) btn.style.display = 'none';
  }
}
let _migrating = false;
async function migrateOldPhotos() {
  if (_migrating || !sb) return;
  if (!confirm('古い写真を写真専用の保存場所へ移します。\n枚数が多いと数分かかります。始めますか？')) return;
  _migrating = true;
  const st = document.getElementById('photoMigrateStatus');
  const btn = document.getElementById('photoMigrateBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 移しています...（画面を閉じないでください）'; }
  let moved = 0, failed = 0;
  try {
    const total = await _countOldPhotos();
    while (true) {
      const { data, error } = await sb.from(DB_TABLES.PHOTOS).select('id,kiroku_id,photo_b64')
        .is('photo_url', null).neq('photo_b64', '').limit(3);
      if (error) throw error;
      const rows = (data||[]).filter(r => (r.photo_b64||'').startsWith('data:'));
      if (!rows.length) break;
      for (const r of rows) {
        const url = await _uploadPhotoToStorage(r.kiroku_id || 'old', r.photo_b64);
        if (!url) { failed++; continue; }
        const { error: e2 } = await sb.from(DB_TABLES.PHOTOS).update({ photo_url: url, photo_b64: '' }).eq('id', r.id);
        if (e2) { failed++; const p = _storagePathFromUrl(url); if (p) await sb.storage.from(PHOTO_BUCKET).remove([p]); continue; }
        moved++;
        if (st) st.textContent = `移しています… ${moved} / ${total}枚`;
      }
      if (failed >= 5) break; // 通信が不安定な時は止める
    }
    showToast(failed ? `⚠️ ${moved}枚移しました（${failed}枚は失敗。もう一度押すと再挑戦します）` : `✅ ${moved}枚の写真を移しました`, failed ? 'error' : 'success', 5000);
  } catch(e) {
    console.log('写真移行エラー:', e);
    showToast(`⚠️ 途中で止まりました（${moved}枚移動済み）。もう一度押すと続きから進みます`, 'error', 5000);
  } finally {
    _migrating = false;
    if (btn) { btn.disabled = false; btn.textContent = '📦 古い写真を移す'; }
    refreshPhotoMigrateStatus();
  }
}

function clearOwnerFilter() {
  const from = document.getElementById('ownerFromDate');
  const to   = document.getElementById('ownerToDate');
  if(from) from.value = '';
  if(to)   to.value   = '';
  renderOwnerPanel();
}

// ─── 初期化 ───────────────────────────────────────────────────
function initApp() {
  document.title = COMPANY.title + '｜' + COMPANY.name;
  const h1=document.querySelector('.header h1'); if(h1) h1.textContent='🔧 '+COMPANY.title;

  loadState();
  updateSyncUI();
  updateNumDisplay();
  renderAllChecklists();
  renderCarRepairItems();
  renderFreezerItems();
  renderInsuranceSelect();

  renderMechSelect('mechSelectRepair');
  renderMechSelect('mechSelectShakken');
  renderMechSelect('mechSelectAccident');

  renderSubStaffArea();
  setupPlateHistory();

  setTimeout(()=>loadMasters(), 500);
  setTimeout(()=>{
    // 一覧パネルが表示されていたら即ロード
    const listPanel = document.getElementById('panel-list');
    if (listPanel && listPanel.classList.contains('active')) {
      loadList();
    }
    // tab-list をアクティブに
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const tl = document.getElementById('tab-list');
    if (tl) tl.classList.add('active');
    loadList();
  }, 600);

  const today=_todayStr();
  ['r-dateIn','sk-dateIn','ac-dateIn'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=today; });
}

// ─── 起動 ─────────────────────────────────────────────────────
initSupabase();
initAuth();
setInterval(()=>{
  // 一覧画面を見ている時だけ、他のスタッフの更新を軽く取り直す（3分に1回、負荷を抑えるため間隔は長め）
  const listPanel=document.getElementById('panel-list');
  if(listPanel && listPanel.classList.contains('active') && sbReady && !document.getElementById('shijishoView')){
    loadList();
  }
}, 180000);
