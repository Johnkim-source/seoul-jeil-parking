/* 관리자 화면 */
var PW_KEY = 'sjc-parking:admin';
var password = '';
var ZONES = [];
var TODAY = '';
var loaded = {};

document.addEventListener('DOMContentLoaded', init);

function adminCall(action, data) {
  return API.call(action, data, password).catch(function (e) {
    if (/비밀번호/.test(e.message)) logout();
    throw e;
  });
}

async function init() {
  if (API.DEMO) $('#demo-banner').hidden = false;
  initTabs(function (name) {
    if (!loaded[name]) { loaded[name] = true; if (name === 'vehicles') loadVehicles(null); }
  });
  $('#login-form').addEventListener('submit', login);
  $('#logout').addEventListener('click', function (e) { e.preventDefault(); logout(); });
  $('#apps-filter').addEventListener('submit', function (e) { e.preventDefault(); loadApps(e.submitter); });
  $('#gate-form').addEventListener('submit', function (e) { e.preventDefault(); checkPlate(e.submitter); });
  $('#veh-form').addEventListener('submit', function (e) { e.preventDefault(); loadVehicles(e.submitter); });
  $('#approve-all').addEventListener('click', approveAll);

  try {
    var cfg = await API.call('getConfig');
    TODAY = cfg.today;
    ZONES = cfg.zones;
    $('#church-name').textContent = cfg.churchName;
    $('#f-service').innerHTML = '<option value="">전체</option>' + cfg.services.map(function (s) {
      return '<option value="' + esc(s.name) + '">' + esc(s.name) + '</option>';
    }).join('');
    $('#f-date').value = upcomingSunday(TODAY);
    $('#gate-date').value = TODAY;
  } catch (e) {
    toast(e.message, 'error');
  }

  try { password = sessionStorage.getItem(PW_KEY) || ''; } catch (e) { password = ''; }
  if (password) enter();
}

async function login(e) {
  e.preventDefault();
  var pw = $('#password').value;
  await withBusy(e.submitter, async function () {
    await API.call('adminLogin', {}, pw);
    password = pw;
    try { sessionStorage.setItem(PW_KEY, pw); } catch (err) { /* ignore */ }
    enter();
  });
}

function enter() {
  $('#login-form').hidden = true;
  $('#admin-app').hidden = false;
  $('#logout').hidden = false;
  loaded = { apps: true };
  showTab('apps');
  loadApps(null);
}

function logout() {
  password = '';
  try { sessionStorage.removeItem(PW_KEY); } catch (e) { /* ignore */ }
  $('#login-form').hidden = false;
  $('#admin-app').hidden = true;
  $('#logout').hidden = true;
  $('#password').value = '';
}

/* ---------- 신청 관리 ---------- */

var currentApps = [];

async function loadApps(btn) {
  await withBusy(btn, async function () {
    var res = await adminCall('adminApplications', {
      date: $('#f-date').value, service: $('#f-service').value, status: $('#f-status').value
    });
    ZONES = res.zones;
    currentApps = res.applications;
    renderSummary(res.summary);
    renderApps();
  });
}

var takenBy = {}; // takenBy[예배][자리번호] = 신청ID

function renderSummary(summary) {
  var box = $('#apps-summary');
  takenBy = {};
  summary.forEach(function (s) {
    var m = takenBy[s.service] = {};
    s.zones.forEach(function (z) { z.spots.forEach(function (p) { if (p.id) m[p.no] = p.id; }); });
  });
  // 예배가 하나면 항상 배치도를 보여주고, 여러 개면 신청이 있는 예배만 표시
  var shown = summary.length === 1 ? summary : summary.filter(function (s) {
    return s.zones.some(function (z) { return z.used > 0; });
  });
  if (!shown.length) { box.innerHTML = ''; return; }
  box.innerHTML = shown.map(function (s) {
    var total = 0, used = 0;
    s.zones.forEach(function (z) { total += z.capacity; used += z.used; });
    return '<div class="svc"><div class="svc-title">' + esc(s.service) + (s.time ? ' · ' + esc(s.time) : '') +
      ' — 주차 배치도 <span class="hint">(사용 ' + used + ' / ' + total + '대)</span></div>' +
      s.zones.map(function (z) {
        return '<div class="lot"><div class="lot-name">' + esc(z.name) + ' <span class="hint">' + z.used + '/' + z.capacity + '</span></div>' +
          '<div class="spots">' + z.spots.map(function (p) {
            var cls = !p.id ? 'free' : (p.status === '대기' ? 'wait' : (p.status === '입차' ? 'in' : 'ok'));
            return '<div class="spot ' + cls + '" title="' + esc(p.id ? p.plate + ' ' + p.name + ' (' + p.status + ')' : '빈 자리') + '">' +
              '<b>' + p.no + '</b><small>' + esc(p.id ? p.plate.slice(-4) : '빈자리') + '</small></div>';
          }).join('') + '</div></div>';
      }).join('') +
      '<div class="legend"><span class="spot ok"></span>승인 <span class="spot wait"></span>대기 <span class="spot in"></span>입차 <span class="spot free"></span>빈자리</div>' +
      '</div>';
  }).join('');
}

function spotOptions(a) {
  var taken = takenBy[a.service] || {};
  var html = a.spot ? '' : '<option value="">자리 미배정</option>';
  ZONES.forEach(function (z) {
    html += '<optgroup label="' + esc(z.name) + '">';
    for (var n = z.start; n <= z.end; n++) {
      var other = taken[n] && taken[n] !== a.id;
      html += '<option value="' + n + '"' + (String(n) === String(a.spot) ? ' selected' : '') + (other ? ' disabled' : '') + '>' +
        n + '번 · ' + esc(z.name) + (other ? ' (사용중)' : '') + '</option>';
    }
    html += '</optgroup>';
  });
  return html;
}

function renderApps() {
  var list = currentApps;
  var waiting = list.filter(function (a) { return a.status === '대기'; }).length;
  $('#apps-count').textContent = '총 ' + list.length + '건' + (waiting ? ' (대기 ' + waiting + '건)' : '');
  $('#approve-all').hidden = !waiting;
  var box = $('#apps-list');
  if (!list.length) { box.innerHTML = '<div class="empty">신청 내역이 없습니다.</div>'; return; }
  box.innerHTML = list.map(function (a) {
    var actions = [];
    if (a.status !== '승인') actions.push('<button class="btn sm ok" data-act="승인">승인</button>');
    if (a.status === '승인' || a.status === '대기') actions.push('<button class="btn sm in" data-act="입차">입차</button>');
    if (a.status !== '반려') actions.push('<button class="btn sm no" data-act="반려">반려</button>');
    return '<div class="item" data-id="' + esc(a.id) + '">' +
      '<div class="head">' + (a.spot ? '<span class="spot-no">' + esc(a.spot) + '</span>' : '') +
      '<span class="plate">' + esc(a.plate) + '</span><b class="grow">' + esc(a.name) + '</b>' + badge(a.status) + '</div>' +
      '<div class="meta">' + esc(fmtDate(a.date)) + ' · <b>' + esc(a.service) + '</b> · ' + esc(a.zone) +
      ' · <a href="tel:' + esc(a.phone) + '">' + esc(fmtPhone(a.phone)) + '</a></div>' +
      (a.note ? '<div class="memo">요청: ' + esc(a.note) + '</div>' : '') +
      '<div class="row" style="margin-top:10px">' +
      '<select data-spot>' + spotOptions(a) + '</select>' +
      '<input data-memo placeholder="관리자 안내 (교인에게 표시)" value="' + esc(a.adminMemo) + '">' +
      '</div>' +
      '<div class="actions">' + actions.join('') + '<button class="btn sm line" data-act="save">자리·안내 저장</button></div>' +
      '</div>';
  }).join('');

  $$('.item', box).forEach(function (item) {
    $$('[data-act]', item).forEach(function (b) {
      b.onclick = function () {
        var patch = { id: item.dataset.id, spot: $('[data-spot]', item).value, adminMemo: $('[data-memo]', item).value };
        if (b.dataset.act !== 'save') patch.status = b.dataset.act;
        withBusy(b, async function () {
          var updated = await adminCall('adminUpdateApplication', patch);
          currentApps = currentApps.map(function (a) { return a.id === updated.id ? updated : a; });
          toast('저장되었습니다.', 'success');
          loadApps(null);
        });
      };
    });
  });
}

async function approveAll(e) {
  var waiting = currentApps.filter(function (a) { return a.status === '대기'; });
  if (!waiting.length || !confirm('대기 중인 ' + waiting.length + '건을 모두 승인하시겠습니까?')) return;
  await withBusy(e.target, async function () {
    for (var i = 0; i < waiting.length; i++) {
      await adminCall('adminUpdateApplication', { id: waiting[i].id, status: '승인' });
    }
    toast(waiting.length + '건 승인되었습니다.', 'success');
  });
  loadApps(null);
}

/* ---------- 입차 확인 ---------- */

async function checkPlate(btn) {
  await withBusy(btn, async function () {
    var date = $('#gate-date').value || TODAY;
    var res = await adminCall('adminCheckPlate', { q: $('#gate-q').value, date: date });
    var box = $('#gate-result');
    if (!res.length) {
      box.innerHTML = '<div class="notice" style="background:var(--no-bg);color:var(--no)"><b>미등록 차량</b><br>등록된 차량 중 일치하는 번호가 없습니다.</div>';
      return;
    }
    box.innerHTML = '<div class="list">' + res.map(function (r) {
      var v = r.vehicle;
      var apps = r.applications.filter(function (a) { return a.status !== '취소'; });
      return '<div class="item">' +
        '<div class="head"><span class="plate" style="font-size:18px">' + esc(v.plate) + '</span><b class="grow">' + esc(v.name) + '</b>' + badge(v.status) + '</div>' +
        '<div class="meta">' + esc([v.group, v.model, v.color].filter(Boolean).join(' · ')) +
        ' · <a href="tel:' + esc(v.phone) + '">' + esc(fmtPhone(v.phone)) + '</a></div>' +
        (v.memo ? '<div class="memo">' + esc(v.memo) + '</div>' : '') +
        (apps.length ? apps.map(function (a) {
          return '<div class="memo" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
            '<span style="flex:1">' + esc(fmtDate(a.date)) + ' ' + esc(a.service) + ' · <b>' + esc(a.zone) + spotLabel(a) + '</b></span>' + badge(a.status) +
            ((a.status === '승인' || a.status === '대기') ? '<button class="btn sm in" data-in="' + esc(a.id) + '">입차 처리</button>' : '') + '</div>';
        }).join('') : '<div class="memo">' + esc(fmtDate(date)) + ' 주차 신청 없음</div>') +
        '</div>';
    }).join('') + '</div>';
    $$('[data-in]', box).forEach(function (b) {
      b.onclick = function () {
        withBusy(b, async function () {
          await adminCall('adminUpdateApplication', { id: b.dataset.in, status: '입차' });
          toast('입차 처리되었습니다.', 'success');
          checkPlate(null);
        });
      };
    });
  });
}

/* ---------- 등록 차량 ---------- */

async function loadVehicles(btn) {
  await withBusy(btn, async function () {
    var list = await adminCall('adminVehicles', { q: $('#veh-q').value });
    $('#veh-count').textContent = '총 ' + list.length + '대';
    var box = $('#veh-list');
    if (!list.length) { box.innerHTML = '<div class="empty">등록된 차량이 없습니다.</div>'; return; }
    box.innerHTML = list.map(function (v) {
      return '<div class="item" data-id="' + esc(v.id) + '">' +
        '<div class="head"><span class="plate">' + esc(v.plate) + '</span><b class="grow">' + esc(v.name) + '</b>' + badge(v.status) + '</div>' +
        '<div class="meta">' + esc([v.group, v.model, v.color].filter(Boolean).join(' · ')) +
        ' · <a href="tel:' + esc(v.phone) + '">' + esc(fmtPhone(v.phone)) + '</a> · 등록 ' + esc(v.createdAt.slice(0, 10)) + '</div>' +
        (v.memo ? '<div class="memo">' + esc(v.memo) + '</div>' : '') +
        '<div class="actions">' +
        (v.status === '정지'
          ? '<button class="btn sm ok" data-status="정상">사용 재개</button>'
          : '<button class="btn sm line" data-status="정지">사용 정지</button>') +
        '<button class="btn sm no" data-del>삭제</button></div></div>';
    }).join('');
    $$('.item', box).forEach(function (item) {
      var id = item.dataset.id;
      var s = $('[data-status]', item);
      s.onclick = function () {
        withBusy(s, async function () {
          await adminCall('adminUpdateVehicle', { id: id, status: s.dataset.status });
          toast('변경되었습니다.', 'success');
          loadVehicles(null);
        });
      };
      var d = $('[data-del]', item);
      d.onclick = function () {
        if (!confirm('이 차량을 삭제하시겠습니까? (신청 내역은 남습니다)')) return;
        withBusy(d, async function () {
          await adminCall('adminDeleteVehicle', { id: id });
          toast('삭제되었습니다.', 'success');
          loadVehicles(null);
        });
      };
    });
  });
}
