/**
 * ============================================================
 *  auth.js — ログイン・権限管理（オフライン対応版）
 * ============================================================
 */

let currentUser = null;
let staffList   = [];

// ─── ログイン画面初期化 ───────────────────────────────────────
async function initAuth() {
  // セッション復元（ページリロード時）→ Supabase不要でそのまま入れる
  const saved = sessionStorage.getItem('wc_current_user');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      onLoginSuccess();
      return;
    } catch(e) { sessionStorage.removeItem('wc_current_user'); }
  }

  // ローカルキャッシュからスタッフ一覧を復元
  const cachedStaff = localStorage.getItem('wc_staff_cache');
  if (cachedStaff) {
    try { staffList = JSON.parse(cachedStaff); } catch(e) { staffList = []; }
  }

  // Supabaseからスタッフ一覧取得（失敗してもキャッシュで続行）
  await loadStaffForLogin();
  renderLoginScreen();
}

// ─── スタッフ一覧取得 ─────────────────────────────────────────
async function loadStaffForLogin() {
  if (!sb) return;
  try {
    const { data, error } = await sb
      .from(DB_TABLES.STAFF)
      .select('id, name, is_owner, pin')
      .order('is_owner', { ascending: false });
    if (error) throw error;
    staffList = data || [];
    // ローカルにキャッシュ保存（PIN含む）
    localStorage.setItem('wc_staff_cache', JSON.stringify(staffList));
  } catch(e) {
    console.log('スタッフ取得エラー（オフラインモード）:', e);
    // キャッシュがあればそのまま使う（staffListは既にセット済み）
  }
}

// ─── ログイン画面描画 ─────────────────────────────────────────
let selectedStaff = null;
let pinInput      = '';

function renderLoginScreen() {
  const screen = document.getElementById('loginScreen');
  if (!screen) return;

  const isOffline = !sbReady;

  if (!staffList.length) {
    screen.innerHTML = `
      <div class="login-box">
        <div class="login-logo">🔧</div>
        <div class="login-title">${COMPANY.title}</div>
        <div class="login-sub">${COMPANY.name}</div>
        <div style="background:#2e0d0d;border:1px solid var(--danger);border-radius:10px;padding:16px;color:#ff7070;font-size:13px;text-align:center;line-height:1.8">
          ${isOffline ? 'サーバーに接続できません。<br>ネットワークを確認して再読み込みしてください。' : 'スタッフが登録されていません。<br>Supabaseの <strong>sagyou_staff</strong> テーブルに<br>オーナーアカウントを追加してください。'}
        </div>
        <button class="login-btn" style="margin-top:16px" onclick="location.reload()">🔄 再読み込み</button>
      </div>`;
    return;
  }

  const userBtns = staffList.map(s => `
    <button class="login-user-btn ${s.is_owner ? 'owner-btn' : ''}" onclick="selectStaff('${s.id}','${s.name.replace(/'/g,"\\'")}',${s.is_owner})">
      <div class="login-user-avatar ${s.is_owner ? 'owner' : ''}">${s.is_owner ? '👑' : '👤'}</div>
      <span>${s.name}</span>
      ${s.is_owner ? '<span style="margin-left:auto;font-size:10px;color:var(--owner);font-weight:700">オーナー</span>' : ''}
    </button>`).join('');

  screen.innerHTML = `
    <div class="login-box">
      <div class="login-logo">🔧</div>
      <div class="login-title">${COMPANY.title}</div>
      <div class="login-sub">${COMPANY.name}</div>
      ${isOffline ? `<div style="background:#2a2200;border:1px solid #a08030;border-radius:8px;padding:8px 12px;color:#d0b040;font-size:12px;text-align:center;margin-bottom:12px">⚠️ オフラインモード（キャッシュでログイン）</div>` : ''}
      <div id="loginStep1">
        <div style="color:var(--sub);font-size:12px;font-weight:700;margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">ユーザーを選択</div>
        <div class="login-user-list">${userBtns}</div>
      </div>
      <div id="loginStep2" style="display:none">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
          <button onclick="backToUserSelect()" style="background:none;border:none;color:var(--sub);font-size:20px;cursor:pointer;padding:0">←</button>
          <div>
            <div style="font-size:16px;font-weight:700" id="selectedUserName"></div>
            <div style="font-size:11px;color:var(--sub)">PINコードを入力</div>
          </div>
        </div>
        <div id="pinDisplay" style="display:flex;justify-content:center;gap:12px;margin-bottom:24px">
          <div class="pin-dot"></div><div class="pin-dot"></div>
          <div class="pin-dot"></div><div class="pin-dot"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          ${[1,2,3,4,5,6,7,8,9,'','0','⌫'].map(n => `
            <button class="pin-btn" onclick="pinPress('${n}')"
              style="padding:18px;background:var(--bg);border:1.5px solid var(--border);border-radius:12px;color:var(--text);font-size:22px;font-weight:700;cursor:pointer;font-family:inherit;transition:.12s;${n===''?'visibility:hidden':''}"
            >${n}</button>`).join('')}
        </div>
        <div class="login-error" id="loginError"></div>
      </div>
    </div>`;

  const style = document.createElement('style');
  style.textContent = `
    .pin-dot { width:14px;height:14px;border-radius:50%;background:var(--border);transition:.15s; }
    .pin-dot.filled { background:var(--accent); }
    .pin-btn:active { background:var(--accentL)!important;border-color:var(--accent)!important; }
  `;
  document.head.appendChild(style);
}

function selectStaff(id, name, isOwner) {
  selectedStaff = { id, name, is_owner: isOwner };
  pinInput = '';
  document.getElementById('loginStep1').style.display = 'none';
  document.getElementById('loginStep2').style.display = 'block';
  document.getElementById('selectedUserName').textContent = name;
  document.getElementById('loginError').textContent = '';
  updatePinDisplay();
}

function backToUserSelect() {
  selectedStaff = null;
  pinInput = '';
  document.getElementById('loginStep1').style.display = 'block';
  document.getElementById('loginStep2').style.display = 'none';
}

function updatePinDisplay() {
  const dots = document.querySelectorAll('.pin-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('filled', i < pinInput.length);
  });
}

async function pinPress(val) {
  if (val === '') return;
  if (val === '⌫') {
    pinInput = pinInput.slice(0, -1);
    updatePinDisplay();
    return;
  }
  if (pinInput.length >= 4) return;
  pinInput += val;
  updatePinDisplay();
  if (pinInput.length === 4) {
    await attemptLogin();
  }
}

async function attemptLogin() {
  if (!selectedStaff) return;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';

  // まずキャッシュからPIN照合（オフライン対応）
  const cached = staffList.find(s => s.id === selectedStaff.id);
  if (cached && cached.pin) {
    if (cached.pin !== pinInput) {
      errEl.textContent = 'PINコードが違います';
      pinInput = '';
      updatePinDisplay();
      return;
    }
    // PINが一致 → ログイン成功
    currentUser = { id: cached.id, name: cached.name, is_owner: cached.is_owner };
    sessionStorage.setItem('wc_current_user', JSON.stringify(currentUser));
    // オンラインならログ記録（失敗しても続行）
    if (sbReady) {
      try { await recordLog('login'); } catch(e) {}
    }
    onLoginSuccess();
    return;
  }

  // キャッシュにPINがない場合はSupabaseで照合
  try {
    const { data, error } = await sb
      .from(DB_TABLES.STAFF)
      .select('id, name, is_owner, pin')
      .eq('id', selectedStaff.id)
      .single();
    if (error) throw error;
    if (data.pin !== pinInput) {
      errEl.textContent = 'PINコードが違います';
      pinInput = '';
      updatePinDisplay();
      return;
    }
    currentUser = { id: data.id, name: data.name, is_owner: data.is_owner };
    sessionStorage.setItem('wc_current_user', JSON.stringify(currentUser));
    // キャッシュ更新
    const idx = staffList.findIndex(s => s.id === data.id);
    if (idx >= 0) staffList[idx] = data;
    localStorage.setItem('wc_staff_cache', JSON.stringify(staffList));
    await recordLog('login');
    onLoginSuccess();
  } catch(e) {
    errEl.textContent = 'サーバーに接続できません。再試行してください。';
    pinInput = '';
    updatePinDisplay();
  }
}

async function recordLog(action) {
  if (!sb || !currentUser) return;
  try {
    await sb.from(DB_TABLES.LOGS).insert([{
      staff_id:   currentUser.id,
      staff_name: currentUser.name,
      action,
    }]);
  } catch(e) { console.log('ログ記録エラー:', e); }
}

// ─── ログイン成功後の処理 ─────────────────────────────────────
function onLoginSuccess() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  if (currentUser.is_owner) {
    document.getElementById('app').classList.add('is-owner');
  }
  const badge = document.getElementById('currentUserBadge');
  if (badge) {
    badge.textContent = (currentUser.is_owner ? '👑 ' : '👤 ') + currentUser.name;
    if (currentUser.is_owner) badge.classList.add('owner');
  }
  const ownerTab = document.getElementById('ownerTab');
  if (ownerTab && currentUser.is_owner) {
    ownerTab.style.display = 'block';
  }
  initApp();
}

// ─── ログアウト ───────────────────────────────────────────────
async function logout() {
  if (!confirm('ログアウトしますか？')) return;
  if (sbReady) {
    try { await recordLog('logout'); } catch(e) {}
  }
  currentUser = null;
  sessionStorage.removeItem('wc_current_user');
  selectedStaff = null;
  pinInput = '';
  document.getElementById('app').style.display = 'none';
  document.getElementById('app').classList.remove('is-owner');
  document.getElementById('loginScreen').style.display = 'flex';
  renderLoginScreen();
}
