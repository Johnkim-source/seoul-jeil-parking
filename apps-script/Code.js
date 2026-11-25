/**
 * 서울제일교회 주차관리 — Google Apps Script 백엔드
 *
 * 이 파일은 구글 시트의 [확장 프로그램 → Apps Script] 편집기에 그대로 붙여넣어 사용합니다.
 * (같은 파일을 웹 화면의 '데모 모드'에서도 불러와 동일한 로직으로 동작합니다.)
 *
 * 시트 구성 (setup() 실행 시 자동 생성)
 *   - 차량      : 교인 등록 차량
 *   - 주차신청  : 날짜·예배별 주차 신청 내역
 *   - 주차구역  : 구역 이름과 정원 (시트에서 직접 수정)
 *   - 예배      : 신청 가능한 예배/모임 목록 (시트에서 직접 수정)
 */

var CONFIG = {
  CHURCH_NAME: '서울제일교회',
  TIMEZONE: 'Asia/Seoul',
  // true  : 구역 정원이 남아 있으면 신청 즉시 '승인'
  // false : 신청은 '대기' 상태로 들어오고 관리자가 승인
  AUTO_APPROVE: false,
  // 오늘로부터 며칠 뒤까지 신청을 받을지
  MAX_DAYS_AHEAD: 60,
  // 한 연락처로 등록할 수 있는 최대 차량 수
  MAX_VEHICLES_PER_PHONE: 5
};

var TABLES = {
  vehicles: {
    sheet: '차량',
    columns: [['id', '등록ID'], ['createdAt', '등록일시'], ['name', '이름'], ['phone', '연락처'],
      ['group', '교구/부서'], ['plate', '차량번호'], ['model', '차종'], ['color', '색상'],
      ['memo', '메모'], ['status', '상태'], ['updatedAt', '수정일시']]
  },
  applications: {
    sheet: '주차신청',
    columns: [['id', '신청ID'], ['createdAt', '신청일시'], ['date', '날짜'], ['service', '예배'],
      ['zone', '구역'], ['plate', '차량번호'], ['name', '이름'], ['phone', '연락처'], ['note', '비고'],
      ['status', '상태'], ['adminMemo', '관리자메모'], ['updatedAt', '처리일시']]
  },
  zones: {
    sheet: '주차구역',
    columns: [['name', '구역'], ['capacity', '정원'], ['info', '안내']]
  },
  services: {
    sheet: '예배',
    columns: [['name', '예배명'], ['time', '시간']]
  }
};

// 처음 setup() 할 때 들어가는 예시 값입니다. 시트에서 실제 값으로 바꿔 주세요.
var DEFAULT_DATA = {
  zones: [
    { name: '본관 지하주차장', capacity: '40', info: '본관 정문 진입' },
    { name: '교육관 주차장', capacity: '20', info: '교육관 뒤편' },
    { name: '외부 협력주차장', capacity: '30', info: '도보 약 5분' }
  ],
  services: [
    { name: '주일 1부 예배', time: '07:30' },
    { name: '주일 2부 예배', time: '09:30' },
    { name: '주일 3부 예배', time: '11:30' },
    { name: '주일 오후예배', time: '14:00' },
    { name: '수요예배', time: '19:30' },
    { name: '금요기도회', time: '21:00' }
  ]
};

var STATUS = { WAIT: '대기', OK: '승인', IN: '입차', REJECT: '반려', CANCEL: '취소' };
var APP_STATUSES = [STATUS.WAIT, STATUS.OK, STATUS.IN, STATUS.REJECT, STATUS.CANCEL];
var ACTIVE_STATUSES = [STATUS.WAIT, STATUS.OK, STATUS.IN]; // 정원을 차지하는 상태
var VEHICLE_STATUSES = ['정상', '정지'];

/* =====================================================================
 *  웹 앱 진입점
 * ===================================================================== */

function doGet() {
  return json_({ ok: true, data: { name: CONFIG.CHURCH_NAME + ' 주차관리 API', status: 'running' } });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: '잘못된 요청 형식입니다.' });
  }
  return json_(handle(req));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 모든 요청의 공통 처리 (Apps Script / 데모 모드 공용) */
function handle(req) {
  try {
    req = req || {};
    var action = String(req.action || '');
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) throw userError('알 수 없는 요청입니다.');
    var def = ACTIONS[action];
    if (def.admin) checkAdmin_(req.password);
    var data = req.data || {};
    var result = def.write ? Env.withLock(function () { return def.fn(data); }) : def.fn(data);
    return { ok: true, data: result };
  } catch (err) {
    if (err && err.isUserError) return { ok: false, error: err.message };
    try { console.error(err); } catch (e) { /* ignore */ }
    return { ok: false, error: '처리 중 오류가 발생했습니다: ' + (err && err.message ? err.message : err) };
  }
}

var ACTIONS = {
  // 교인용
  getConfig: { fn: getConfig_ },
  registerVehicle: { fn: registerVehicle_, write: true },
  myVehicles: { fn: myVehicles_ },
  availability: { fn: availability_ },
  apply: { fn: apply_, write: true },
  myApplications: { fn: myApplications_ },
  cancelApplication: { fn: cancelApplication_, write: true },
  // 관리자용 (비밀번호 필요)
  adminLogin: { admin: true, fn: function () { return { ok: true }; } },
  adminApplications: { admin: true, fn: adminApplications_ },
  adminUpdateApplication: { admin: true, fn: adminUpdateApplication_, write: true },
  adminVehicles: { admin: true, fn: adminVehicles_ },
  adminUpdateVehicle: { admin: true, fn: adminUpdateVehicle_, write: true },
  adminDeleteVehicle: { admin: true, fn: adminDeleteVehicle_, write: true },
  adminCheckPlate: { admin: true, fn: adminCheckPlate_ }
};

/* =====================================================================
 *  교인용 기능
 * ===================================================================== */

function getConfig_() {
  return {
    churchName: CONFIG.CHURCH_NAME,
    autoApprove: CONFIG.AUTO_APPROVE,
    maxDaysAhead: CONFIG.MAX_DAYS_AHEAD,
    today: Env.today(),
    zones: zones_(),
    services: services_()
  };
}

function registerVehicle_(d) {
  var phone = phone_(d.phone);
  var plate = plate_(d.plate);
  var info = {
    name: required_(d.name, '이름', 30),
    phone: phone,
    group: text_(d.group, 30),
    model: text_(d.model, 30),
    color: text_(d.color, 20),
    memo: text_(d.memo, 200),
    updatedAt: Env.now()
  };
  var existing = findBy_('vehicles', 'plate', plate);
  if (existing) {
    if (existing.phone !== phone) {
      throw userError('이미 다른 연락처로 등록된 차량번호입니다. 관리자에게 문의해 주세요.');
    }
    Env.db.update('vehicles', existing._row, info);
    return { updated: true, vehicle: publicVehicle_(merge_(existing, info)) };
  }
  var mine = Env.db.all('vehicles').filter(function (v) { return v.phone === phone; });
  if (mine.length >= CONFIG.MAX_VEHICLES_PER_PHONE) {
    throw userError('한 연락처로 최대 ' + CONFIG.MAX_VEHICLES_PER_PHONE + '대까지 등록할 수 있습니다.');
  }
  var vehicle = merge_({ id: newId_('V'), createdAt: Env.now(), plate: plate, status: '정상' }, info);
  Env.db.insert('vehicles', vehicle);
  return { updated: false, vehicle: publicVehicle_(vehicle) };
}

function myVehicles_(d) {
  var phone = phone_(d.phone);
  return Env.db.all('vehicles')
    .filter(function (v) { return v.phone === phone; })
    .map(publicVehicle_);
}

function availability_(d) {
  var date = date_(d.date);
  var service = required_(d.service, '예배');
  return computeAvailability_(Env.db.all('applications'), zones_(), date, service);
}

function apply_(d) {
  var phone = phone_(d.phone);
  var plate = plate_(d.plate);
  var date = date_(d.date);
  var service = required_(d.service, '예배');
  var zoneName = required_(d.zone, '주차 구역');
  var note = text_(d.note, 200);

  var today = Env.today();
  if (date < today) throw userError('지난 날짜는 신청할 수 없습니다.');
  if (date > addDays_(today, CONFIG.MAX_DAYS_AHEAD)) {
    throw userError('오늘부터 ' + CONFIG.MAX_DAYS_AHEAD + '일 이내 날짜만 신청할 수 있습니다.');
  }

  var vehicle = findBy_('vehicles', 'plate', plate);
  if (!vehicle || vehicle.phone !== phone) {
    throw userError('등록되지 않은 차량이거나 연락처가 일치하지 않습니다. 먼저 차량을 등록해 주세요.');
  }
  if (vehicle.status === '정지') throw userError('사용이 중지된 차량입니다. 관리자에게 문의해 주세요.');
  if (!services_().some(function (s) { return s.name === service; })) throw userError('예배를 다시 선택해 주세요.');

  var apps = Env.db.all('applications');
  var duplicated = apps.some(function (a) {
    return a.plate === plate && a.date === date && a.service === service && isActive_(a);
  });
  if (duplicated) throw userError('이미 같은 날짜·예배에 신청된 차량입니다.');

  var zone = computeAvailability_(apps, zones_(), date, service)
    .filter(function (z) { return z.name === zoneName; })[0];
  if (!zone) throw userError('주차 구역을 다시 선택해 주세요.');
  if (zone.remaining <= 0) throw userError('선택하신 구역은 정원이 마감되었습니다. 다른 구역을 선택해 주세요.');

  var application = {
    id: newId_('P'),
    createdAt: Env.now(),
    date: date,
    service: service,
    zone: zoneName,
    plate: plate,
    name: vehicle.name,
    phone: phone,
    note: note,
    status: CONFIG.AUTO_APPROVE ? STATUS.OK : STATUS.WAIT,
    adminMemo: '',
    updatedAt: ''
  };
  Env.db.insert('applications', application);
  return application;
}

function myApplications_(d) {
  var phone = phone_(d.phone);
  return Env.db.all('applications')
    .filter(function (a) { return a.phone === phone; })
    .sort(function (a, b) { return (b.date + b.createdAt).localeCompare(a.date + a.createdAt); })
    .slice(0, 50)
    .map(strip_);
}

function cancelApplication_(d) {
  var phone = phone_(d.phone);
  var app = findBy_('applications', 'id', text_(d.id, 40));
  if (!app || app.phone !== phone) throw userError('신청 내역을 찾을 수 없습니다.');
  if ([STATUS.WAIT, STATUS.OK].indexOf(app.status) < 0) throw userError('취소할 수 없는 상태입니다. (' + app.status + ')');
  if (app.date < Env.today()) throw userError('지난 신청은 취소할 수 없습니다.');
  var patch = { status: STATUS.CANCEL, updatedAt: Env.now() };
  Env.db.update('applications', app._row, patch);
  return strip_(merge_(app, patch));
}

/* =====================================================================
 *  관리자 기능
 * ===================================================================== */

function checkAdmin_(password) {
  var real = Env.adminPassword();
  if (!real) throw userError('관리자 비밀번호가 설정되지 않았습니다. Apps Script에서 setup()을 실행해 주세요.');
  if (!password || String(password) !== String(real)) throw userError('관리자 비밀번호가 올바르지 않습니다.');
}

function adminApplications_(d) {
  var date = d.date ? date_(d.date) : '';
  var service = text_(d.service, 50);
  var status = text_(d.status, 10);
  var all = Env.db.all('applications');
  var zones = zones_();
  var services = services_();
  var serviceOrder = services.map(function (s) { return s.name; });

  var list = all.filter(function (a) {
    return (!date || a.date === date) && (!service || a.service === service) && (!status || a.status === status);
  }).sort(function (a, b) {
    return a.date.localeCompare(b.date) ||
      (serviceOrder.indexOf(a.service) - serviceOrder.indexOf(b.service)) ||
      a.zone.localeCompare(b.zone) ||
      a.createdAt.localeCompare(b.createdAt);
  });

  var summary = [];
  if (date) {
    services.forEach(function (s) {
      if (service && s.name !== service) return;
      summary.push({ service: s.name, time: s.time, zones: computeAvailability_(all, zones, date, s.name) });
    });
  }
  return { applications: list.map(strip_), summary: summary, zones: zones, services: services };
}

function adminUpdateApplication_(d) {
  var app = findBy_('applications', 'id', text_(d.id, 40));
  if (!app) throw userError('신청 내역을 찾을 수 없습니다.');
  var patch = { updatedAt: Env.now() };
  if (d.status != null) {
    if (APP_STATUSES.indexOf(d.status) < 0) throw userError('잘못된 상태 값입니다.');
    patch.status = d.status;
  }
  if (d.zone != null) {
    if (!zones_().some(function (z) { return z.name === d.zone; })) throw userError('존재하지 않는 구역입니다.');
    patch.zone = d.zone;
  }
  if (d.adminMemo != null) patch.adminMemo = text_(d.adminMemo, 200);
  Env.db.update('applications', app._row, patch);
  return strip_(merge_(app, patch));
}

function adminVehicles_(d) {
  var q = String(d.q || '').replace(/[\s-]/g, '');
  return Env.db.all('vehicles')
    .filter(function (v) {
      if (!q) return true;
      return [v.plate, v.name, v.phone, v.group, v.model].some(function (f) {
        return String(f || '').replace(/[\s-]/g, '').indexOf(q) >= 0;
      });
    })
    .sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); })
    .map(strip_);
}

function adminUpdateVehicle_(d) {
  var v = findBy_('vehicles', 'id', text_(d.id, 40));
  if (!v) throw userError('차량을 찾을 수 없습니다.');
  var patch = { updatedAt: Env.now() };
  if (d.status != null) {
    if (VEHICLE_STATUSES.indexOf(d.status) < 0) throw userError('잘못된 상태 값입니다.');
    patch.status = d.status;
  }
  ['name', 'group', 'model', 'color', 'memo'].forEach(function (k) {
    if (d[k] != null) patch[k] = text_(d[k], k === 'memo' ? 200 : 30);
  });
  Env.db.update('vehicles', v._row, patch);
  return strip_(merge_(v, patch));
}

function adminDeleteVehicle_(d) {
  var v = findBy_('vehicles', 'id', text_(d.id, 40));
  if (!v) throw userError('차량을 찾을 수 없습니다.');
  Env.db.remove('vehicles', v._row);
  return { deleted: true };
}

/** 입차 확인: 차량번호 전체 또는 일부(뒤 4자리 등)로 검색 */
function adminCheckPlate_(d) {
  var q = String(d.q || '').replace(/[\s-]/g, '');
  if (q.length < 2) throw userError('차량번호를 2자 이상 입력해 주세요.');
  var date = d.date ? date_(d.date) : Env.today();
  var apps = Env.db.all('applications').filter(function (a) { return a.date === date; });
  return Env.db.all('vehicles')
    .filter(function (v) { return v.plate.indexOf(q) >= 0; })
    .map(function (v) {
      return {
        vehicle: strip_(v),
        applications: apps.filter(function (a) { return a.plate === v.plate; }).map(strip_)
      };
    });
}

/* =====================================================================
 *  공통 유틸
 * ===================================================================== */

function userError(message) {
  var e = new Error(message);
  e.isUserError = true;
  return e;
}

function text_(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max || 100);
}

function required_(v, label, max) {
  var s = text_(v, max);
  if (!s) throw userError(label + '을(를) 입력해 주세요.');
  return s;
}

function phone_(v) {
  var s = String(v || '').replace(/\D/g, '');
  if (!/^0\d{8,10}$/.test(s)) throw userError('연락처를 정확히 입력해 주세요. (예: 010-1234-5678)');
  return s;
}

function plate_(v) {
  var s = String(v || '').replace(/[\s-]/g, '');
  if (!/^([가-힣]{2})?\d{2,3}[가-힣]\d{4}$/.test(s)) {
    throw userError('차량번호 형식이 올바르지 않습니다. (예: 12가3456, 123가4567)');
  }
  return s;
}

function date_(v) {
  var s = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw userError('날짜를 선택해 주세요.');
  return s;
}

function addDays_(dateStr, n) {
  var d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function newId_(prefix) {
  return prefix + Env.now().replace(/\D/g, '').slice(2, 8) + '-' +
    Math.random().toString(36).slice(2, 6).toUpperCase();
}

function merge_(a, b) {
  var o = {};
  Object.keys(a).forEach(function (k) { o[k] = a[k]; });
  Object.keys(b).forEach(function (k) { o[k] = b[k]; });
  return o;
}

function strip_(o) {
  var c = merge_(o, {});
  delete c._row;
  return c;
}

function publicVehicle_(v) {
  return { id: v.id, name: v.name, group: v.group, plate: v.plate, model: v.model, color: v.color, status: v.status };
}

function isActive_(a) {
  return ACTIVE_STATUSES.indexOf(a.status) >= 0;
}

function findBy_(table, key, value) {
  return Env.db.all(table).filter(function (r) { return r[key] === value; })[0] || null;
}

function zones_() {
  return Env.db.all('zones').map(function (z) {
    return { name: z.name, capacity: parseInt(z.capacity, 10) || 0, info: z.info || '' };
  });
}

function services_() {
  return Env.db.all('services').map(function (s) { return { name: s.name, time: s.time || '' }; });
}

function computeAvailability_(apps, zones, date, service) {
  return zones.map(function (z) {
    var list = apps.filter(function (a) {
      return a.date === date && a.service === service && a.zone === z.name && isActive_(a);
    });
    var pending = list.filter(function (a) { return a.status === STATUS.WAIT; }).length;
    return {
      name: z.name,
      capacity: z.capacity,
      info: z.info,
      approved: list.length - pending,
      pending: pending,
      used: list.length,
      remaining: Math.max(0, z.capacity - list.length)
    };
  });
}

/* =====================================================================
 *  구글 시트 저장소 (Apps Script 전용)
 * ===================================================================== */

var SheetDb = {
  sheet_: function (table) {
    var name = TABLES[table].sheet;
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    if (!sh) throw new Error('"' + name + '" 시트가 없습니다. Apps Script에서 setup()을 먼저 실행해 주세요.');
    return sh;
  },
  all: function (table) {
    var sh = this.sheet_(table);
    var cols = TABLES[table].columns;
    var last = sh.getLastRow();
    if (last < 2) return [];
    var values = sh.getRange(2, 1, last - 1, cols.length).getDisplayValues();
    var rows = [];
    values.forEach(function (r, i) {
      if (String(r[0]).trim() === '') return; // 빈 줄 무시
      var o = { _row: i + 2 };
      cols.forEach(function (c, j) { o[c[0]] = String(r[j]).trim(); });
      rows.push(o);
    });
    return rows;
  },
  insert: function (table, obj) {
    var sh = this.sheet_(table);
    var cols = TABLES[table].columns;
    var row = sh.getLastRow() + 1;
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
    var values = cols.map(function (c) { return safeCell_(obj[c[0]]); });
    sh.getRange(row, 1, 1, cols.length).setNumberFormat('@').setValues([values]);
  },
  update: function (table, row, patch) {
    var sh = this.sheet_(table);
    var cols = TABLES[table].columns;
    cols.forEach(function (c, j) {
      if (Object.prototype.hasOwnProperty.call(patch, c[0])) {
        sh.getRange(row, j + 1).setNumberFormat('@').setValue(safeCell_(patch[c[0]]));
      }
    });
  },
  remove: function (table, row) {
    this.sheet_(table).deleteRow(row);
  }
};

/** 수식으로 해석되지 않도록 문자열로 저장 */
function safeCell_(v) {
  var s = v == null ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/** 실행 환경 (데모 모드에서는 웹 화면이 이 객체를 브라우저용으로 교체합니다) */
var Env = {
  db: SheetDb,
  now: function () { return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'); },
  today: function () { return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd'); },
  adminPassword: function () { return PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD'); },
  withLock: function (fn) {
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try { return fn(); } finally { lock.releaseLock(); }
  }
};

/* =====================================================================
 *  초기 설정 (Apps Script 편집기에서 한 번 실행)
 * ===================================================================== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('주차관리')
    .addItem('초기 설정 (시트 만들기)', 'setup')
    .addToUi();
}

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(CONFIG.TIMEZONE);
  Object.keys(TABLES).forEach(function (t) {
    var def = TABLES[t];
    var sh = ss.getSheetByName(def.sheet) || ss.insertSheet(def.sheet);
    var headers = def.columns.map(function (c) { return c[1]; });
    sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e8eef8');
    sh.setFrozenRows(1);
    if (sh.getLastRow() < 2 && DEFAULT_DATA[t]) {
      DEFAULT_DATA[t].forEach(function (r) { SheetDb.insert(t, r); });
    }
  });

  // 비어 있는 기본 시트(시트1 / Sheet1) 정리
  ['시트1', 'Sheet1'].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });

  var props = PropertiesService.getScriptProperties();
  var msg;
  if (!props.getProperty('ADMIN_PASSWORD')) {
    var pw = Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6);
    props.setProperty('ADMIN_PASSWORD', pw);
    msg = '설정 완료!\n초기 관리자 비밀번호: ' + pw +
      '\n\n(Apps Script → 프로젝트 설정 → 스크립트 속성의 ADMIN_PASSWORD 에서 변경할 수 있습니다)';
  } else {
    msg = '설정 완료! (관리자 비밀번호는 기존 값을 유지합니다)';
  }
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* 편집기에서 실행한 경우 로그로 확인 */ }
}
