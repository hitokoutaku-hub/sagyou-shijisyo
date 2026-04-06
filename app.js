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
async function sbSaveOrder(order) {
  if (!sb) return false;
  try {
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
      saved_at: order.savedAt,
    });
    if (error) throw error;
    return true;
  } catch(e) {
    console.log('Supabase保存エラー:', e);
    return false;
  }
}

async function sbLoadOrders() {
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from(DB_TABLES.KIROKU).select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data.map(row => ({
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
      skTruckLights: row.sk_truck_lights || {}, savedAt: row.saved_at,
    }));
  } catch(e) { console.log('Supabase読み込みエラー:', e); return null; }
}

async function sbDeleteOrder(id) {
  if (!sb) return false;
  try {
    const { error } = await sb.from(DB_TABLES.KIROKU).delete().eq('id', id);
    if (error) throw error;
    return true;
  } catch(e) { return false; }
}

// ─── 写真管理 ────────────────────────────────────────────────
let photoCounter = 0;

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
  try {
    await sb.from(DB_TABLES.PHOTOS).insert(
      keys.map(k => ({ kiroku_id: orderId, photo_type: pending[k].type, photo_b64: pending[k].dataUrl, memo: '' }))
    );
  } catch(e) { console.log('写真保存エラー:', e); }
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
  document.getElementById(slotId)?.remove();
  if (sb && photoId) {
    try { await sb.from(DB_TABLES.PHOTOS).delete().eq('id', photoId); } catch(e) {}
  }
}

function selectAllPhotos(val) { document.querySelectorAll('[id^="photo-check-"]').forEach(cb => cb.checked = val); }

function downloadSelectedPhotos() {
  const checked = document.querySelectorAll('[id^="photo-check-"]:checked');
  if (!checked.length) { showToast('写真を選択してください', 'error'); return; }
  checked.forEach((cb, i) => {
    const a = document.createElement('a');
    a.href = cb.dataset.b64; a.download = `${cb.dataset.type||'写真'}_${i+1}.jpg`; a.click();
  });
}

// ─── 自動採番 ────────────────────────────────────────────────
function genOrderNum() {
  const today = new Date();
  const ymd = today.getFullYear().toString()
    + String(today.getMonth()+1).padStart(2,'0')
    + String(today.getDate()).padStart(2,'0');
  S.counter = S.counter || {};
  S.counter[ymd] = (S.counter[ymd] || 0) + 1;
  saveState();
  return ymd + '-' + String(S.counter[ymd]).padStart(3,'0');
}

function peekOrderNum() {
  const today = new Date();
  const ymd = today.getFullYear().toString()
    + String(today.getMonth()+1).padStart(2,'0')
    + String(today.getDate()).padStart(2,'0');
  return ymd + '-' + String((S.counter?.[ymd] || 0) + 1).padStart(3,'0');
}

function resetCounter() {
  if (!confirm('今日の連番をリセットしますか？')) return;
  const today = new Date();
  const ymd = today.getFullYear().toString()
    + String(today.getMonth()+1).padStart(2,'0')
    + String(today.getDate()).padStart(2,'0');
  if (S.counter) S.counter[ymd] = 0;
  saveState();
  updateNumDisplay();
  showToast('連番をリセットしました', 'info');
}

function updateNumDisplay() {
  const n = peekOrderNum();
  ['repairOrderNum','skOrderNum','accOrderNum'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = n;
  });
}

// ─── タブ切り替え ─────────────────────────────────────────────
function switchTab(tab) {
  const tabs = ['repair','shakken','list','accident','settings','owner'];
  document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', tabs[i]===tab));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-'+tab)?.classList.add('active');
  if (tab==='list')     loadList();
  if (tab==='settings') renderSettings();
  if (tab==='repair')   { updateNumDisplay(); renderAllChecklists(); renderSubStaffArea(); }
  if (tab==='shakken')  { updateNumDisplay(); renderSkItems(); }
  if (tab==='accident') { updateNumDisplay(); renderInsuranceSelect(); }
  if (tab==='owner')    renderOwnerPanel();
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
          onclick="selectMech('${containerId}','${s.id}','${s.name.replace(/'/g,"\\'")}')"
          style="${btnStyle(s)}"
        >${s.is_owner ? '👑' : '👤'} ${s.name}</button>`).join('')}
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
    `<span class="sub-staff-tag">👤 ${s.name}<button onclick="removeSubStaff('${s.id}')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px;margin-left:4px">×</button></span>`
  ).join('');
  const staffBtns = allStaff
    .filter(s => !currentSubStaff.find(sub => sub.id === s.id))
    .map(s => `<button class="btn btn-gray btn-sm" onclick="addSubStaff('${s.id}','${s.name.replace(/'/g,"\\'")}')">＋ ${s.name}</button>`)
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

function switchRepairType(type) {
  repairType = type;
  ['car','truck','aircon'].forEach(t => {
    document.getElementById('repair-'+t+'-items').style.display = t===type ? '' : 'none';
    document.getElementById('r-tab-'+t).className = 'btn btn-sm ' + (t===type?'btn-primary':'btn-gray');
  });
  if (type==='car')    renderCarRepairItems();
  if (type==='truck')  renderTruckItems();
  if (type==='aircon') renderAirconItems();
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
    document.getElementById('custNameList').innerHTML = customers.map(c=>`<option value="${c.name}">`).join('');
    document.getElementById('carNameList').innerHTML  = cars.map(c=>`<option value="${c.name}">`).join('');
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
  try {
    const { error } = await sb.from(DB_TABLES.MASTERS).insert(rows);
    if (error) throw error;
    document.getElementById('newCustName').value = '';
    document.getElementById('newCarName').value  = '';
    await loadMasters();
    showToast('登録しました', 'success');
  } catch(e) { showToast('登録失敗: ' + e.message, 'error'); }
}

async function removeMaster(id) {
  if (!sb) return;
  try {
    await sb.from(DB_TABLES.MASTERS).delete().eq('id', id);
    await loadMasters();
    showToast('削除しました', 'info');
  } catch(e) { showToast('削除失敗', 'error'); }
}

// ─── スタッフ管理 ─────────────────────────────────────────────
async function loadStaffForSettings() {
  if (!sb) return;
  try {
    const { data, error } = await sb.from(DB_TABLES.STAFF).select('*').order('is_owner', { ascending: false });
    if (error) throw error;
    const el = document.getElementById('staffList');
    if (el) {
      el.innerHTML = data.length
        ? data.map(s => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:6px">
            <span style="font-size:18px">${s.is_owner?'👑':'👤'}</span>
            <div style="flex:1">
              <div style="font-size:15px;font-weight:700">${s.name}</div>
              <div style="font-size:11px;color:var(--sub)">${s.is_owner?'オーナー':'スタッフ'} · PIN: ${'●'.repeat(s.pin?.length||4)}</div>
            </div>
            ${!s.is_owner ? `<button class="btn btn-danger btn-sm" onclick="removeStaff('${s.id}')">削除</button>` : ''}
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
  try {
    const id = 'staff_' + Date.now();
    const { error } = await sb.from(DB_TABLES.STAFF).insert([{ id, name, pin, is_owner: false }]);
    if (error) throw error;
    document.getElementById('newStaffName').value = '';
    document.getElementById('newStaffPin').value  = '';
    await loadStaffForSettings();
    showToast(`${name} を追加しました`, 'success');
  } catch(e) { showToast('登録失敗: ' + e.message, 'error'); }
}

async function removeStaff(id) {
  if (!confirm('このスタッフを削除しますか？')) return;
  if (!sb) return;
  try {
    await sb.from(DB_TABLES.STAFF).delete().eq('id', id);
    await loadStaffForSettings();
    showToast('削除しました', 'info');
  } catch(e) { showToast('削除失敗', 'error'); }
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
      ${(S.insuranceCompanies||[]).map((name,i)=>`<span class="staff-tag" style="font-size:12px">${name}<button onclick="removeInsurance(${i})">×</button></span>`).join('')}
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

// ─── 保存：一般修理 ───────────────────────────────────────────
async function saveRepair() {
  if (isSaving) return;
  const custName = document.getElementById('r-custName').value.trim();
  const carName  = document.getElementById('r-carName').value.trim();
  if (!custName && !carName) { showToast('顧客名か車名を入力してください', 'error'); return; }

  setSaving('btnSaveRepair', true);
  const preventResults = {};
  DEF_PREVENT_OKNG.forEach(label => { if (S.preventOkNg?.[label]) preventResults[label]=S.preventOkNg[label]; });
  const carItems    = Object.entries(S.carRepairCheckState||{}).filter(([,v])=>v).map(([k])=>k);
  const truckItems  = Object.entries(S.truckCheckState||{}).filter(([,v])=>v).map(([k])=>k);
  const airconItems = Object.entries(S.airconCheckState||{}).filter(([,v])=>v).map(([k])=>k);
  const orderNum    = genOrderNum();
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
    remarks:   document.getElementById('r-remarks').value,
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
      showToast(`⚠️ ローカルに保存しました（クラウド同期失敗）`, 'error', 5000);
    }
    clearRepair();
  } catch(e) {
    showToast('保存に失敗しました: ' + e.message, 'error');
  } finally {
    setSaving('btnSaveRepair', false);
  }
}

function clearRepair() {
  ['r-custName','r-carName','r-carPlate','r-dateIn','r-dateOut','r-remarks','r-nyukoPlace','r-nyukoTime'].forEach(id => {
    const el=document.getElementById(id); if(el) el.value='';
  });
  const nyukoMethod=document.getElementById('r-nyukoMethod'); if(nyukoMethod) nyukoMethod.value='';
  const partsPending=document.getElementById('r-partsPending'); if(partsPending) partsPending.checked=false;
  document.getElementById('r-status').value = '入庫中';
  document.getElementById('r-dateIn').value = new Date().toISOString().split('T')[0];
  S.checkState={notice:{},work:{}}; S.preventOkNg={}; S.carRepairCheckState={}; S.truckCheckState={}; S.airconCheckState={};
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
  setSaving('btnSaveAccident', true);
  const insurance = document.getElementById('ac-insurance').value || document.getElementById('ac-insuranceDirect').value.trim();
  const orderNum  = genOrderNum();
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
    showToast(ok ? `✅ 保存しました（${orderNum}）` : '⚠️ ローカルに保存しました', ok?'success':'error');
    clearAccident();
  } catch(e) { showToast('保存に失敗しました','error'); }
  finally { setSaving('btnSaveAccident', false); }
}

function clearAccident() {
  ['ac-custName','ac-carName','ac-carPlate','ac-dateIn','ac-dateOut','ac-remarks','ac-insuranceDirect'].forEach(id => {
    const el=document.getElementById(id); if(el) el.value='';
  });
  document.getElementById('ac-status').value='入庫中';
  document.getElementById('ac-dateIn').value=new Date().toISOString().split('T')[0];
  document.getElementById('ac-insurance').value='';
  ['ac-preview-repair','ac-preview-receipt'].forEach(id => { const el=document.getElementById(id); if(el) el.innerHTML=''; });
  currentSubStaff=[];
  updateNumDisplay();
}

// ─── 保存：車検 ───────────────────────────────────────────────
async function saveShakken() {
  if (isSaving) return;
  const custName = document.getElementById('sk-custName').value.trim();
  const carName  = document.getElementById('sk-carName').value.trim();
  if (!custName && !carName) { showToast('顧客名か車名を入力してください','error'); return; }
  setSaving('btnSaveShakken', true);
  const skResults = {};
  if (skType==='truck') {
    (S.skTruckItems||DEF_SK_TRUCK).forEach(item => { skResults[item.label]=S.skTruckCheckState?.[item.label]?.work||''; });
  } else {
    (S.skItems||[]).forEach(item => { skResults[item.label]=S.skCheckState[item.label]?.work||''; });
  }
  const orderNum = genOrderNum();
  const order = {
    id: Date.now().toString(), orderNum, type:'shakken', repairType:skType,
    status:   document.getElementById('sk-status').value,
    custName, carName,
    carPlate: document.getElementById('sk-carPlate').value,
    dateIn:   document.getElementById('sk-dateIn').value,
    dateOut:  document.getElementById('sk-dateOut').value,
    mechName: getMechName('mechSelectShakken'), mechId: getMechId('mechSelectShakken'),
    subStaff: [...currentSubStaff],
    remarks:  document.getElementById('sk-remarks').value,
    skResults, savedAt: new Date().toLocaleString('ja-JP'),
  };
  try {
    S.orders.unshift(order); saveState();
    const ok = await sbSaveOrder(order);
    showToast(ok ? `✅ 保存しました（${orderNum}）` : '⚠️ ローカルに保存しました', ok?'success':'error');
    clearShakken();
  } catch(e) { showToast('保存に失敗しました','error'); }
  finally { setSaving('btnSaveShakken', false); }
}

function clearShakken() {
  ['sk-custName','sk-carName','sk-carPlate','sk-dateIn','sk-dateOut','sk-remarks'].forEach(id => {
    const el=document.getElementById(id); if(el) el.value='';
  });
  document.getElementById('sk-dateIn').value=new Date().toISOString().split('T')[0];
  S.skCheckState={}; S.skTruckCheckState={}; S.skTruckNotice={}; S.skTruckPrevent={}; S.skTruckLights={};
  ['sk-preview-receipt','sk-preview-repair'].forEach(id => { const el=document.getElementById(id); if(el) el.innerHTML=''; });
  currentSubStaff=[];
  renderSkItems();
  updateNumDisplay();
}

// ─── 一覧 ────────────────────────────────────────────────────
function updateMonthFilter() {
  const sel=document.getElementById('filterMonth'); if(!sel) return;
  const current=sel.value;
  const months=new Set();
  S.orders.forEach(o => { const d=o.dateIn||''; if(d&&d.length>=7) months.add(d.substring(0,7)); });
  const sorted=Array.from(months).sort().reverse();
  sel.innerHTML='<option value="">全月</option>'+sorted.map(m => {
    const [y,mo]=m.split('-');
    return `<option value="${m}" ${m===current?'selected':''}>${y}年${parseInt(mo)}月</option>`;
  }).join('');
  if(!current&&sorted.length>0) { const today=new Date().toISOString().substring(0,7); if(sorted.includes(today)) sel.value=today; }
}

function clearFilter() {
  document.getElementById('filterStatus').value='';
  document.getElementById('filterKeyword').value='';
  document.getElementById('filterType').value='';
  loadList();
}

async function loadList() {
  const c=document.getElementById('orderList');
  c.innerHTML='<div class="loading"><span class="spinner"></span></div>';
  if (sbReady) { const sbOrders=await sbLoadOrders(); if(sbOrders!==null) S.orders=sbOrders; }
  const filterMonth  =document.getElementById('filterMonth')?.value;
  const filterStatus =document.getElementById('filterStatus')?.value;
  const filterKeyword=document.getElementById('filterKeyword')?.value.trim();
  const filterType   =document.getElementById('filterType')?.value;
  updateMonthFilter();
  let orders=[...S.orders];
  if(filterMonth)   orders=orders.filter(o=>(o.dateIn||o.savedAt||'').startsWith(filterMonth));
  if(filterStatus)  orders=orders.filter(o=>o.status===filterStatus);
  if(filterType)    orders=orders.filter(o=>o.type===filterType);
  if(filterKeyword) orders=orders.filter(o=>
    (o.custName||'').includes(filterKeyword)||(o.carName||'').includes(filterKeyword)||
    (o.carPlate||'').includes(filterKeyword)||(o.orderNum||'').includes(filterKeyword));
  const statusOrder={'作業中':0,'車検中':1,'入庫中':2,'入庫待ち':3,'完了':4,'引渡済':5};
  orders.sort((a,b)=>{
    const aO=statusOrder[a.status]??99;
    const bO=statusOrder[b.status]??99;
    if(aO!==bO)return aO-bO;
    return (b.dateIn||'').localeCompare(a.dateIn||'');
  });
  const el=document.getElementById('listSyncLabel'); if(el) el.textContent=sbReady?'クラウド同期済み':'ローカル保存';
  if(!orders.length) { c.innerHTML='<div class="empty">📋 指示書がありません</div>'; return; }
  c.innerHTML=orders.map(o => {
    const subNames = (o.subStaff||[]).map(s=>s.name).join('・');
    const nyukoInfo = [
      o.nyukoMethod ? o.nyukoMethod : '',
      o.nyukoPlace  ? `📍${o.nyukoPlace}` : '',
      o.nyukoTime   ? `⏰${o.nyukoTime}` : '',
    ].filter(Boolean).join('　');
    const partsBadge = o.partsPending ? `<span style="background:#7a1a1a;color:#ff7070;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700">🔴 部品待ち</span>` : '';
    const allItems=[...(o.carItems||[]),...(o.truckItems||[]),...(o.airconItems||[]),...(o.skResults?Object.keys(o.skResults).filter(k=>o.skResults[k]):[])].slice(0,3);
    const itemsPreview = allItems.length ? `<div class="order-info" style="color:var(--accent);font-size:11px">🔧 ${allItems.join('・')}${(o.carItems||[]).length+(o.truckItems||[]).length+(o.airconItems||[]).length>3?'…':''}</div>` : '';
    return `<div class="order-item" onclick="showDetail('${o.id}')">
      <div class="top">
        <span class="order-num">${o.orderNum||'（番号なし）'}</span>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          ${partsBadge}
          <span class="badge badge-${o.status}">${o.status}</span>
        </div>
      </div>
      <div class="order-info">${o.type==='shakken'?'🔍 ':o.type==='accident'?'🚨 ':''}${o.custName||''}　${o.carName||''}　${o.carPlate?'【'+o.carPlate+'】':''}</div>
      <div class="order-info">入庫: ${o.dateIn||'未設定'}　出庫: ${o.dateOut||'未設定'}　担当: ${o.mechName||'未定'}${subNames?'・'+subNames:''}</div>
      ${nyukoInfo?`<div class="order-info" style="color:#88aaff;font-size:12px">${nyukoInfo}</div>`:''}
      ${itemsPreview}
    </div>`;
  }).join('');
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
    <div style="font-size:17px;font-weight:700;color:var(--text)">${value}</div>
  </div>`;
}
function shijishoSection(title,content) {
  return `<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:12px">
    <div style="color:var(--accent);font-size:13px;font-weight:700;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border)">${title}</div>${content}</div>`;
}
function tagList(items,color) {
  return `<div style="display:flex;flex-wrap:wrap;gap:6px">${items.map(i=>`<span style="background:rgba(240,160,48,0.15);border:1px solid ${color};border-radius:6px;padding:6px 12px;font-size:13px;font-weight:600;color:${color}">${i}</span>`).join('')}</div>`;
}

async function openShijishoView(order) {
  const typeLabel=order.type==='shakken'?'車検指示書':order.type==='accident'?'事故修理指示書':'作業指示書';
  const subNames=(order.subStaff||[]).map(s=>s.name).join('・');
  let sakugyoHtml='';
  if(order.type==='accident') {
    if(order.insurance) sakugyoHtml+=shijishoSection('🏢 保険会社',`<span style="font-size:16px;font-weight:700">${order.insurance}</span>`);
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
  if(order.remarks) sakugyoHtml+=shijishoSection('📝 備考・メモ',`<div style="white-space:pre-wrap;font-size:15px;line-height:1.8;background:var(--bg);padding:12px;border-radius:8px">${order.remarks}</div>`);

  let photoHtml='';
  const photos=await loadPhotosForOrder(order.id);
  if(photos.length) {
    const typeOrder=['作業前','作業中','作業後','納品書','写真'];
    const grouped={}; photos.forEach(p=>{ if(!grouped[p.photo_type]) grouped[p.photo_type]=[]; grouped[p.photo_type].push(p); });
    const allPhotos=[]; typeOrder.forEach(t=>{ if(grouped[t]) grouped[t].forEach(p=>allPhotos.push(p)); });
    Object.keys(grouped).forEach(t=>{ if(!typeOrder.includes(t)) grouped[t].forEach(p=>allPhotos.push(p)); });
    const imgs=allPhotos.map((p,i)=>`
      <div id="photo-slot-view-${i}">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <input type="checkbox" id="photo-check-${i}" data-b64="${p.photo_b64}" data-type="${p.photo_type}" data-id="${p.id||''}" style="width:18px;height:18px;cursor:pointer;accent-color:var(--accent)">
          <span style="color:var(--sub);font-size:11px;font-weight:700">${p.photo_type}</span>
          <button onclick="deletePhoto('${p.id||''}','photo-slot-view-${i}')" style="margin-left:auto;background:var(--danger);border:none;border-radius:6px;color:#fff;font-size:11px;padding:3px 8px;cursor:pointer">🗑️</button>
        </div>
        <img src="${p.photo_b64}" style="width:100%;border-radius:10px;border:2px solid var(--border);cursor:zoom-in" onclick="openPhotoFullscreen('${p.photo_b64}','${p.photo_type}')">
      </div>`).join('');
    photoHtml=shijishoSection('📷 写真',`
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <button class="btn btn-gray btn-sm" onclick="selectAllPhotos(true)">✅ 全選択</button>
        <button class="btn btn-gray btn-sm" onclick="selectAllPhotos(false)">⬜ 全解除</button>
        <button class="btn btn-primary btn-sm" onclick="downloadSelectedPhotos()">📥 ダウンロード</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${imgs}</div>`);
  }

  const alreadyInOrder = order.mechId===currentUser?.id || (order.subStaff||[]).some(s=>s.id===currentUser?.id);
  const joinBtn = !alreadyInOrder ? `
    <button class="btn btn-info btn-sm" onclick="joinAsSubStaff('${order.id}')">🙋 サブ担当として参加</button>` : '';

  document.body.insertAdjacentHTML('beforeend', `
  <div style="position:fixed;inset:0;background:var(--bg);z-index:500;overflow-y:auto" id="shijishoView">
    <div style="position:sticky;top:0;background:var(--card);border-bottom:2px solid var(--accent);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;z-index:10;flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-size:11px;color:var(--sub);font-weight:700">${typeLabel}</div>
        <div style="font-size:20px;font-weight:800;color:var(--accent)">${order.orderNum||'番号なし'}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span class="badge badge-${order.status}" style="font-size:13px;padding:5px 14px">${order.status}</span>
        ${joinBtn}
        <button class="btn btn-ok btn-sm" onclick="openAddPhotoModal('${order.id}')">📷 写真追加</button>
        <button class="btn btn-info btn-sm" onclick="openEditModal('${order.id}')">✏️ 編集</button>
        <button class="btn btn-gray btn-sm" onclick="openManageModal('${order.id}')">⚙️ 管理</button>
        <button class="btn btn-primary btn-sm" style="background:#06c755" onclick="sendLineReport('${order.id}')">💬 LINE</button>
        <button class="btn btn-primary btn-sm" onclick="closeShijishoView()">✕</button>
      </div>
    </div>
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
        <div style="color:var(--accent);font-size:13px;font-weight:700;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border)">📷 写真を追加</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
          ${['作業前','作業中','作業後','納品書'].map(t=>`<button class="btn btn-gray btn-sm" onclick="addPhotoToOrder('${order.id}','shijisho-photos','${t}')">＋ ${t}</button>`).join('')}
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
    Array.from(input.files).forEach(file=>{
      _compressAndRun(file,async compressed=>{
        const div=document.createElement('div'); div.style.cssText='background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px';
        div.innerHTML=`<div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:4px">${type}</div><img src="${compressed}" style="width:100%;border-radius:6px"><div style="color:var(--sub);font-size:10px;margin-top:3px;text-align:center">保存中...</div>`;
        if(container) container.appendChild(div);
        if(sb){try{const{error}=await sb.from(DB_TABLES.PHOTOS).insert([{kiroku_id:orderId,photo_type:type,photo_b64:compressed,memo:''}]);if(!error){const s=div.querySelector('div:last-child');if(s)s.textContent='保存完了';}}catch(e){}}
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
function openPhotoFullscreen(src, type) {
  document.body.insertAdjacentHTML('beforeend', `
  <div id="photoFullscreen" onclick="closePhotoFullscreen()"
    style="position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:zoom-out">
    <div style="color:#fff;font-size:13px;font-weight:700;margin-bottom:12px;opacity:0.8">${type} — タップして閉じる</div>
    <img src="${src}" style="max-width:100%;max-height:90vh;object-fit:contain;border-radius:8px">
  </div>`);
}

function closePhotoFullscreen() {
  document.getElementById('photoFullscreen')?.remove();
}

function openManageModal(id) {
  const order=S.orders.find(o=>o.id===id); if(!order) return;
  document.body.insertAdjacentHTML('beforeend',`
  <div style="position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:600;display:flex;align-items:center;justify-content:center;padding:20px" id="manageModal">
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;width:100%;max-width:400px">
      <div style="color:var(--accent);font-size:16px;font-weight:800;margin-bottom:16px">⚙️ 管理 - ${order.orderNum||''}</div>
      <div style="color:var(--sub);font-size:12px;font-weight:700;margin-bottom:8px">ステータス変更</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
        ${['入庫待ち','入庫中','作業中','完了','引渡済','車検中'].map(s=>`<button class="btn btn-sm${order.status===s?' btn-primary':' btn-gray'}" onclick="changeStatus('${id}','${s}');closeManageModal()">${s}</button>`).join('')}
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-danger btn-sm" style="flex:1" onclick="deleteOrder('${id}');closeManageModal();closeShijishoView();loadList()">🗑️ 削除</button>
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
      <div style="font-size:16px;font-weight:800;color:var(--accent)">✏️ 編集 - ${order.orderNum||''}</div>
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
            <input id="edit-custName" value="${order.custName||''}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">車名</div>
            <input id="edit-carName" value="${order.carName||''}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">ナンバー</div>
            <input id="edit-carPlate" value="${order.carPlate||''}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">出庫予定日</div>
            <input id="edit-dateOut" type="date" value="${order.dateOut||''}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">担当整備士</div>
            <input id="edit-mechName" value="${order.mechName||''}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">ステータス</div>
            <select id="edit-status" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box">
              ${['入庫待ち','入庫中','作業中','完了','引渡済','車検中'].map(s=>`<option value="${s}" ${order.status===s?'selected':''}>${s}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="margin-top:10px">
          <div style="font-size:11px;color:var(--sub);margin-bottom:4px">備考・メモ</div>
          <textarea id="edit-remarks" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box;height:80px">${order.remarks||''}</textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
          <div>
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">入庫手段</div>
            <select id="edit-nyukoMethod" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box">
              <option value="" ${!order.nyukoMethod?'selected':''}>未設定</option>
              <option value="お客入庫" ${order.nyukoMethod==='お客入庫'?'selected':''}>🚗 お客入庫</option>
              <option value="引き取り" ${order.nyukoMethod==='引き取り'?'selected':''}>🔑 引き取り</option>
              <option value="レッカー"  ${order.nyukoMethod==='レッカー'?'selected':''}>🚨 レッカー</option>
            </select>
          </div>
          <div>
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">入庫予定時間</div>
            <input id="edit-nyukoTime" type="time" value="${order.nyukoTime||''}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">引き取り場所</div>
            <input id="edit-nyukoPlace" value="${order.nyukoPlace||''}" placeholder="例：高槻市〇〇町" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box">
          </div>
          <div style="display:flex;align-items:center;gap:10px;padding-top:20px">
            <div style="font-size:13px;font-weight:700;color:#ff7070">🔴 部品待ち</div>
            <input type="checkbox" id="edit-partsPending" ${order.partsPending?'checked':''} style="width:22px;height:22px;cursor:pointer;accent-color:var(--danger)">
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
  order.dateOut   = document.getElementById('edit-dateOut')?.value          || order.dateOut;
  order.mechName  = document.getElementById('edit-mechName')?.value.trim() || order.mechName;
  order.status    = document.getElementById('edit-status')?.value           || order.status;
  order.remarks   = document.getElementById('edit-remarks')?.value          || '';
  order.nyukoMethod  = document.getElementById('edit-nyukoMethod')?.value  || '';
  order.nyukoTime    = document.getElementById('edit-nyukoTime')?.value     || '';
  order.nyukoPlace   = document.getElementById('edit-nyukoPlace')?.value.trim() || '';
  order.partsPending = document.getElementById('edit-partsPending')?.checked || false;

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
  showToast(ok ? '✅ 保存しました' : '⚠️ ローカルに保存しました', ok?'success':'error');
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
  try {
    const{error}=await sb.from(DB_TABLES.PHOTOS).insert(keys.map(k=>({kiroku_id:orderId,photo_type:pending[k].type||'写真',photo_b64:pending[k].dataUrl,memo:''})));
    if(error) throw error;
    showToast('写真を保存しました','success');
    window._pendingPhotos={};
    closeAddPhotoModal();
    const order=S.orders.find(o=>o.id===orderId);
    if(order){closeShijishoView();openShijishoView(order);}
  } catch(e) { showToast('保存失敗: '+e.message,'error'); }
}

function changeStatus(id,status) {
  const order=S.orders.find(o=>o.id===id); if(!order) return;
  order.status=status; saveState(); sbSaveOrder(order);
  showToast(`ステータスを「${status}」に変更しました`,'success');
  closeShijishoView(); openShijishoView(order); loadList();
}

function deleteOrder(id) {
  if(!confirm('この指示書を削除しますか？')) return;
  S.orders=S.orders.filter(o=>o.id!==id); saveState(); sbDeleteOrder(id);
  showToast('削除しました','info');
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
  if(fsTargetId){const el=document.getElementById(fsTargetId);if(el) el.value=fsVal;}
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

  if (sbReady) { const sbOrders=await sbLoadOrders(); if(sbOrders!==null) S.orders=sbOrders; }

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
      const{data}=await sb.from(DB_TABLES.LOGS).select('*').order('logged_at',{ascending:false}).limit(30);
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
              <td style="font-weight:700">${name}</td>
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
              <div style="font-size:14px;font-weight:700">${log.staff_name}</div>
              <div style="font-size:11px;color:var(--sub)">${log.action==='login'?'ログイン':'ログアウト'}</div>
            </div>
            <div style="font-size:11px;color:var(--sub)">${new Date(log.logged_at).toLocaleString('ja-JP')}</div>
          </div>`).join('')}
        ${loginLogs.length===0?'<div style="text-align:center;color:var(--sub);padding:20px">履歴がありません</div>':''}
      </div>
    </div>`;
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
  renderInsuranceSelect();

  renderMechSelect('mechSelectRepair');
  renderMechSelect('mechSelectShakken');
  renderMechSelect('mechSelectAccident');

  renderSubStaffArea();

  setTimeout(()=>loadMasters(), 500);

  const today=new Date().toISOString().split('T')[0];
  ['r-dateIn','sk-dateIn','ac-dateIn'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=today; });
}

// ─── 起動 ─────────────────────────────────────────────────────
initSupabase();
initAuth();
