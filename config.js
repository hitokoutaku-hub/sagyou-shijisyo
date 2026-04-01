/**
 * ============================================================
 *  config.js — 作業指示書管理システム v2 設定ファイル
 * ============================================================
 *  ★ 他社向けカスタマイズはこのファイルだけ触れば OK ★
 * ============================================================
 */

// ─── 1. 会社情報 ─────────────────────────────────────────────
const COMPANY = {
  name:  '吉村',
  title: '作業指示書管理システム',
};

// ─── 2. Supabase 接続情報 ────────────────────────────────────
const SUPABASE = {
  URL:      'https://kidxeqjovvakcqalblre.supabase.co',
  ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpZHhlcWpvdnZha2NxYWxibHJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MjcxMjYsImV4cCI6MjA4OTQwMzEyNn0.YHz0cVTpwQi1zBAZyZuFImDJv2gKQo9HUyC8w86tgsI',
};

// ─── 3. テーブル名 ───────────────────────────────────────────
const DB_TABLES = {
  KIROKU:  'sagyou_kiroku',
  PHOTOS:  'sagyou_photos',
  MASTERS: 'sagyou_masters',
  STAFF:   'sagyou_staff',     // スタッフ・IDログイン管理
  LOGS:    'sagyou_logs',      // ログイン履歴
};

// ─── 4. デフォルトチェック項目 ───────────────────────────────

const DEF_CAR_REPAIR = [
  'エンジンオイル','エンジンオイルエレメント','エアコン修理',
  'タイヤローテーション','ワイパーゴム','エアコンフィルター',
];

const DEF_TRUCK_REPAIR = [
  'クラッチオーバーホール','クラッチブースター','クラッチマスター','クラッチチェンジ付近修理',
  'エンジンリアシール','エンジンフロントシール','ウォーターポンプ','エンジンオイル漏れ',
  'ヒーターコア','ベルト交換','インジェクター','インジェクター洗浄',
  'サプライポンプ','コモンレール','ラジエター交換','マフラー洗浄',
  '排気管インジェクター洗浄','排気管インジェクター交換','エンジン載せ替え','エンジンオーバーホール',
  'ミッション載せ替え','ミッションオーバーホール','バッテリー',
  'EGRバルブ','インテークスロットル','エアサスベローズ','スタビライザーブッシュ','サーモスタット交換',
];

const DEF_AIRCON_REPAIR = [
  'エアコンリフレッシュ','コンプレッサー交換','エアコンホース交換',
  'ブロアモーター交換','コンデンサーモーター交換','エアコンガス補充',
  'レシーバー交換','コンデンサー交換','マグネットクラッチ調整',
  'マグネットクラッチ交換','コンデンサー洗浄','ガス漏れ点検',
  'エバポレータ交換','エキパン交換','エアコン内部洗浄（機械にて）',
];

const DEF_NOTICE = [
  'オイル漏れ','冷却水漏れ','ブレーキフルード漏れ','パワステフルード漏れ',
  '燃料漏れ','ブレーキ鳴き','エンジン異音','足回り異音',
  'ミッション異音','エアコン異音','バッテリー弱','ワイパー劣化',
  '灯火類不良','ブレーキパッド残少','ウォッシャー液切れ','冷却水少','エンジンオイル少',
];

const DEF_PREVENT_OKNG = [
  'ミッションチェンジ周辺','クラッチ残量','ディスクパット残量',
  'バッテリー','ベルト亀裂','クラッチ調整','坂道発進調整',
];

const DEF_WORK = [
  '点検整備完了','試運転OK','部品発注済','部品待ち','納車準備OK',
];

const DEF_SK = [
  {label:'エンジンオイル',              req:false, opts:'交換/補充/良好'},
  {label:'オイルフィルター',            req:false, opts:'交換/良好'},
  {label:'冷却水(LLC)',                req:false, opts:'交換/補充/良好'},
  {label:'ブレーキフルード',            req:false, opts:'交換/補充/良好'},
  {label:'パワステフルード',            req:false, opts:'交換/補充/良好'},
  {label:'ATFオイル',                  req:false, opts:'交換/良好'},
  {label:'ウォッシャー液',              req:false, opts:'補充/良好'},
  {label:'ブレーキパッド前',            req:false, opts:'交換/要観察/良好'},
  {label:'ブレーキパッド後',            req:false, opts:'交換/要観察/良好'},
  {label:'ブレーキライニング',          req:false, opts:'交換/要観察/良好'},
  {label:'ブレーキホース',              req:false, opts:'交換/要観察/良好'},
  {label:'タイヤ前（残溝）',            req:false, opts:'交換/要観察/良好'},
  {label:'タイヤ後（残溝）',            req:false, opts:'交換/要観察/良好'},
  {label:'バッテリー',                  req:false, opts:'交換/要観察/良好'},
  {label:'エアフィルター',              req:false, opts:'交換/良好'},
  {label:'エアコンフィルター',          req:false, opts:'交換/良好'},
  {label:'エアコンガス点検',            req:false, opts:'補充/良好'},
  {label:'スパークプラグ',              req:false, opts:'交換/良好'},
  {label:'タイミングベルト',            req:false, opts:'交換/良好'},
  {label:'ファンベルト',                req:false, opts:'交換/要観察/良好'},
  {label:'パワステベルト',              req:false, opts:'交換/要観察/良好'},
  {label:'エアコンベルト',              req:false, opts:'交換/要観察/良好'},
  {label:'ワイパーゴム前',              req:false, opts:'交換/良好'},
  {label:'ワイパーゴム後',              req:false, opts:'交換/良好'},
  {label:'タイロッドエンドブーツ',      req:false, opts:'交換/要観察/良好'},
  {label:'ロアーアームジョイントブーツ',req:false, opts:'交換/要観察/良好'},
  {label:'ショックアブソーバーブッシュ',req:false, opts:'交換/要観察/良好'},
  {label:'スタビリンクロッド',          req:false, opts:'交換/要観察/良好'},
  {label:'下回り洗浄',                  req:false, opts:'実施/不要'},
];

const DEF_SK_TRUCK = [
  {label:' ',                          req:false, opts:'整備KIT/シールKIT/分解無し'},
  {label:'ECUシステム診断',            req:false, opts:'有/無し'},
  {label:'スチーム洗車',               req:false, opts:'有/無し'},
  {label:'シャシーブラック',           req:false, opts:'有/無し'},
  {label:'ホイール塗装',               req:false, opts:'有/無し'},
  {label:'DPFマフラー洗浄',           req:false, opts:'有/無し'},
  {label:'エンジンオイル',             req:false, opts:'交換/支給/不要'},
  {label:'エンジンオイルエレメント',   req:false, opts:'交換/支給/不要'},
  {label:'燃料メインフィルター',       req:false, opts:'交換/支給/不要'},
  {label:'燃料サブフィルター',         req:false, opts:'交換/支給/不要'},
  {label:'PCVエレメント',              req:false, opts:'交換/支給/不要'},
  {label:'尿素水フィルター',           req:false, opts:'交換/支給/不要'},
  {label:'ミッションオイル',           req:false, opts:'交換/不要'},
  {label:'デフオイル',                 req:false, opts:'交換/支給/不要'},
  {label:'エアードライヤー',           req:false, opts:'交換/支給/不要'},
  {label:'ワイパーゴム',               req:false, opts:'交換/支給/不要'},
  {label:'ブレーキフルード',           req:false, opts:'交換/支給/不要'},
  {label:'タイヤローテーション',       req:false, opts:'交換/不要'},
  {label:'バッテリー',                 req:false, opts:'交換/支給/不要'},
  {label:'ファンベルト',               req:false, opts:'交換/支給/不要'},
  {label:'クラッチブーツ',             req:false, opts:'交換/要観察/良好'},
  {label:'タイロッドエンドブーツ',     req:false, opts:'交換/要観察/良好'},
  {label:'ドラックリンクブーツ',       req:false, opts:'交換/要観察/良好'},
  {label:'クラッチブースターピストン', req:false, opts:'交換/要観察/良好'},
  {label:'クラッチブースター',         req:false, opts:'交換/要観察/良好'},
  {label:'スタビライザーブッシュ',     req:false, opts:'交換/要観察/良好'},
  {label:'エアサスベローズ',           req:false, opts:'交換/要観察/良好'},
  {label:'ディスクパット（フロント）', req:false, opts:'交換/要観察/良好'},
  {label:'ディスクパット（リア）',     req:false, opts:'交換/要観察/良好'},
  {label:'ライニング（フロント）',     req:false, opts:'交換/要観察/良好'},
  {label:'ライニング（リア）',         req:false, opts:'交換/要観察/良好'},
  {label:'ペダルパット',               req:false, opts:'点検/交換'},
  {label:'発煙筒',                     req:false, opts:'点検/交換'},
  {label:'バッテリー点灯・充電',       req:false, opts:'点検/交換'},
];

const DEF_SK_TRUCK_NOTICE = [
  'オイル漏れ','冷却水漏れ','パワステフルード漏れ',
  '燃料漏れ','ブレーキ鳴き','エンジン異音','足回り異音',
  'ミッション異音','エアコン異音','灯火類不良',
];

const DEF_SK_TRUCK_PREVENT = [
  'ミッションチェンジ周辺','クラッチ残量','クラッチ調整','坂道発進調整',
];
