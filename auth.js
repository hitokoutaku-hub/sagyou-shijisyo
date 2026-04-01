/**
 * ============================================================
 *  auth.js — ログイン・権限管理
 * ============================================================
 *  ・スタッフ一覧をSupabaseから取得してログイン画面に表示
 *  ・PINコード認証
 *  ・ログイン履歴をSupabaseに記録
 *  ・currentUser をグローバルで管理
 * ============================================================
 *
 *  【Supabaseテーブル: sagyou_staff】
 *  id         text primary key
 *  name       text
 *  pin        text
 *  is_owner   boolean default false
 *  created_at timestamp
 *
 *  【初期データ投入SQL】
 *  INSERT INTO sagyou_staff (id, name, pin, is_owner)
 *  VALUES ('staff_owner', 'オーナー', '0000', true);
 *
 *  【Supabaseテーブル: sagyou_logs】
 *  id         uuid default gen_random_uuid()
 *  staff_id   text
 *  staff_name text
 *  action     text  ('login' / 'logout')
 *  logged_at  timestamp default now()
 */

let currentUser = null; // { id, name, is_owner }
let staffList   = [];   // ログイン画面に表示するスタッフ一覧

// ─── ログイン画面初期化 ───────────────────────────────────────
async function initAuth() {
  // セッション復元（ページリロード時）
  const saved = sessionStorage.getItem('wc_current_user');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      onLoginSuccess();
      return;
    } catch(e) { sessionStorage.removeItem('wc_current_user'); }
  }
  await loadStaffForLogin();
  renderLoginScreen();
}

// ─── スタッフ一覧取得 ─────────────────────────────────────────
async function loadStaffForLogin() {
  if (!sb) return;
  try {
    const { data, error } = await sb
      .from(DB_TABLES.STAFF)
      .select('id, name, is_owner')
      .order('is_owner', { ascending: false });
    if (error) throw error;
    staffList = data || [];
  } catch(e) {
    console.log('スタッフ取得エラー:', e);
    staffList = [];
  }
}

// ─── ログイン画面描画 ─────────────────────────────────────────
let selectedStaff = null;
let pinInput      = '';

function renderLoginScreen() {
  const screen = document.getElementById('loginScreen');
  if (!screen) return;

  if (!staffList.length) {
    // スタッフ未登録時（初回セットアップ）
    screen.innerHTML = `
      <div class="login-box">
        <div class="login-logo">🔧</div>
        <div class="login-title">${COMPANY.title}</div>
        <div class="login-sub">${COMPANY.name}</div>
        <div style="background:#2e0d0d;border:1px solid var(--danger);border-radius:10px;padding:16px;color:#ff7070;font-size:13px;text-align:center;line-height:1.8">
          スタッフが登録されていません。<br>
          Supabaseの <strong>sagyou_staff</strong> テーブルに<br>
          オーナーアカウントを追加してください。
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

  // PINドットのスタイル
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

  // Supabaseで認証
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
    // ログイン履歴を記録
    await recordLog('login');
    onLoginSuccess();
  } catch(e) {
    errEl.textContent = '認証エラーが発生しました';
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
      logged_at:  new Date().toISOString(),
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
  // ヘッダーのユーザーバッジを更新
  const badge = document.getElementById('currentUserBadge');
  if (badge) {
    badge.textContent = (currentUser.is_owner ? '👑 ' : '👤 ') + currentUser.name;
    if (currentUser.is_owner) badge.classList.add('owner');
  }
  // オーナー専用タブの表示
  const ownerTab = document.getElementById('ownerTab');
  if (ownerTab && currentUser.is_owner) {
    ownerTab.style.display = 'block';
  }
  // アプリ初期化
  initApp();
}

// ─── ログアウト ───────────────────────────────────────────────
async function logout() {
  if (!confirm('ログアウトしますか？')) return;
  await recordLog('logout');
  currentUser = null;
  sessionStorage.removeItem('wc_current_user');
  selectedStaff = null;
  pinInput = '';
  document.getElementById('app').style.display = 'none';
  document.getElementById('app').classList.remove('is-owner');
  document.getElementById('loginScreen').style.display = 'flex';
  renderLoginScreen();
}
