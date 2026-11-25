/* 교인용 화면 */
var CFG = null;
var PHONE_KEY = 'sjc-parking:phone';

document.addEventListener('DOMContentLoaded', init);

async function init() {
  if (API.DEMO) $('#demo-banner').hidden = false;
  initTabs();
  bindPhoneInputs();

  var saved = store.get(PHONE_KEY);
  if (saved) {
    $('#apply-phone').value = fmtPhone(saved);
    $('#mine-phone').value = fmtPhone(saved);
    $('#register-form').phone.value = fmtPhone(saved);
  }

  try {
    CFG = await API.call('getConfig');
  } catch (e) {
    $('#zone-list').innerHTML = '<div class="empty">설정을 불러오지 못했습니다: ' + esc(e.message) + '</div>';
    return;
  }

  $('#church-name').textContent = CFG.churchName;
  $('#apply-service').innerHTML = CFG.services.map(function (s) {
    return '<option value="' + esc(s.name) + '">' + esc(s.name) + (s.time ? ' (' + esc(s.time) + ')' : '') + '</option>';
  }).join('');
  var dateEl = $('#apply-date');
  dateEl.min = CFG.today;
  dateEl.max = addDays(CFG.today, CFG.maxDaysAhead);
  dateEl.value = upcomingSunday(CFG.today);

  dateEl.addEventListener('change', loadZones);
  $('#apply-service').addEventListener('change', loadZones);
  $('#load-vehicles').addEventListener('click', function (e) { loadVehicles(e.target); });
  $('#apply-phone').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); loadVehicles($('#load-vehicles')); }
  });
  $('#apply-form').addEventListener('submit', submitApply);
  $('#register-form').addEventListener('submit', submitRegister);
  $('#mine-form').addEventListener('submit', function (e) { e.preventDefault(); loadMine(e.submitter); });

  loadZones();
  if (saved) loadVehicles(null);
}

/* ---------- 주차 신청 ---------- */

async function loadVehicles(btn) {
  var phone = $('#apply-phone').value;
  if (!phone) { toast('연락처를 입력해 주세요.', 'error'); return; }
  await withBusy(btn, async function () {
    var list = await API.call('myVehicles', { phone: phone });
    store.set(PHONE_KEY, phone.replace(/\D/g, ''));
    var box = $('#vehicle-list');
    if (!list.length) {
      box.innerHTML = '<div class="notice info">이 연락처로 등록된 차량이 없습니다. ' +
        '<button type="button" class="btn sm" id="go-register">차량 등록하기</button></div>';
      $('#go-register').onclick = function () {
        $('#register-form').phone.value = phone;
        showTab('register');
      };
      return;
    }
    box.innerHTML = list.map(function (v, i) {
      var stopped = v.status === '정지';
      return '<label class="choice' + (stopped ? ' full' : '') + '">' +
        '<input type="radio" name="vehicle" value="' + esc(v.plate) + '"' + (i === 0 && !stopped ? ' checked' : '') + (stopped ? ' disabled' : '') + '>' +
        '<div class="main"><div class="title"><span class="plate">' + esc(v.plate) + '</span></div>' +
        '<div class="sub">' + esc([v.name, v.model, v.color, v.group].filter(Boolean).join(' · ')) + '</div></div>' +
        (stopped ? badge('정지') : '') + '</label>';
    }).join('');
  });
}

async function loadZones() {
  var box = $('#zone-list');
  var date = $('#apply-date').value;
  var service = $('#apply-service').value;
  if (!date || !service) { box.innerHTML = '<div class="empty">날짜와 예배를 선택해 주세요.</div>'; return; }
  var prev = (document.querySelector('input[name=zone]:checked') || {}).value;
  try {
    var zones = await API.call('availability', { date: date, service: service });
    if (!zones.length) { box.innerHTML = '<div class="empty">등록된 주차 구역이 없습니다.</div>'; return; }
    var firstOpen = zones.filter(function (z) { return z.remaining > 0; })[0];
    var pick = zones.some(function (z) { return z.name === prev && z.remaining > 0; }) ? prev : (firstOpen && firstOpen.name);
    box.innerHTML = zones.map(function (z) {
      var full = z.remaining <= 0;
      var cls = full ? 'zero' : (z.remaining <= Math.max(3, z.capacity * 0.1) ? 'low' : '');
      return '<label class="choice' + (full ? ' full' : '') + '">' +
        '<input type="radio" name="zone" value="' + esc(z.name) + '"' + (z.name === pick ? ' checked' : '') + (full ? ' disabled' : '') + '>' +
        '<div class="main"><div class="title">' + esc(z.name) + '</div>' +
        '<div class="sub">' + esc(spotRange(z) + (z.info && z.name.indexOf(z.info) < 0 ? ' · ' + z.info : '')) + '</div></div>' +
        '<span class="remain ' + cls + '">' + (full ? '마감' : '잔여 ' + z.remaining + ' / ' + z.capacity) + '</span></label>';
    }).join('');
  } catch (e) {
    box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
  }
}

async function submitApply(e) {
  e.preventDefault();
  var vehicle = document.querySelector('input[name=vehicle]:checked');
  var zone = document.querySelector('input[name=zone]:checked');
  if (!vehicle) { toast('먼저 연락처로 차량을 불러와 선택해 주세요.', 'error'); return; }
  if (!zone) { toast('주차 구역을 선택해 주세요.', 'error'); return; }
  var btn = $('#apply-submit');
  await withBusy(btn, async function () {
    var a = await API.call('apply', {
      phone: $('#apply-phone').value,
      plate: vehicle.value,
      date: $('#apply-date').value,
      service: $('#apply-service').value,
      zone: zone.value,
      note: $('#apply-note').value
    });
    $('#apply-note').value = '';
    $('#apply-result').innerHTML = '<div class="notice success"><b>신청이 접수되었습니다.</b><br>' +
      esc(fmtDate(a.date)) + ' · ' + esc(a.service) + '<br>' + esc(a.zone) + spotLabel(a) + ' · <span class="plate">' + esc(a.plate) + '</span> ' + badge(a.status) +
      (a.status === '대기' ? '<br><small>관리자 승인 후 확정됩니다. [내 신청 조회]에서 상태를 확인하세요.</small>' : '') + '</div>';
    toast('주차 신청이 완료되었습니다.', 'success');
    loadZones();
  });
}

/* ---------- 차량 등록 ---------- */

async function submitRegister(e) {
  e.preventDefault();
  var f = e.target;
  var data = {};
  ['name', 'phone', 'plate', 'group', 'model', 'color', 'memo'].forEach(function (k) { data[k] = f[k].value; });
  await withBusy(e.submitter, async function () {
    var res = await API.call('registerVehicle', data);
    store.set(PHONE_KEY, data.phone.replace(/\D/g, ''));
    $('#apply-phone').value = fmtPhone(data.phone);
    $('#mine-phone').value = fmtPhone(data.phone);
    $('#register-result').innerHTML = '<div class="notice success"><b>' + (res.updated ? '차량 정보가 수정되었습니다.' : '차량이 등록되었습니다.') + '</b><br>' +
      '<span class="plate">' + esc(res.vehicle.plate) + '</span> ' + esc(res.vehicle.name) +
      '<div style="margin-top:10px"><button type="button" class="btn sm" id="go-apply">주차 신청하러 가기</button></div></div>';
    $('#go-apply').onclick = function () { showTab('apply'); loadVehicles(null); };
    ['plate', 'model', 'color', 'memo'].forEach(function (k) { f[k].value = ''; });
    toast('등록되었습니다.', 'success');
  });
}

/* ---------- 내 신청 조회 ---------- */

async function loadMine(btn) {
  var phone = $('#mine-phone').value;
  await withBusy(btn, async function () {
    var results = await Promise.all([
      API.call('myVehicles', { phone: phone }),
      API.call('myApplications', { phone: phone })
    ]);
    store.set(PHONE_KEY, phone.replace(/\D/g, ''));
    renderMine(results[0], results[1], phone);
  });
}

function renderMine(vehicles, apps, phone) {
  var today = CFG ? CFG.today : '';
  var html = '<h3>등록 차량 (' + vehicles.length + ')</h3>';
  html += vehicles.length ? '<div class="list">' + vehicles.map(function (v) {
    return '<div class="item"><div class="head"><span class="plate">' + esc(v.plate) + '</span>' +
      '<span class="grow">' + esc([v.name, v.model, v.color].filter(Boolean).join(' · ')) + '</span>' + badge(v.status) + '</div></div>';
  }).join('') + '</div>' : '<div class="empty">등록된 차량이 없습니다.</div>';

  html += '<h3>주차 신청 내역 (' + apps.length + ')</h3>';
  html += apps.length ? '<div class="list">' + apps.map(function (a) {
    var canCancel = (a.status === '대기' || a.status === '승인') && a.date >= today;
    return '<div class="item"><div class="head"><b class="grow">' + esc(fmtDate(a.date)) + ' · ' + esc(a.service) + '</b>' + badge(a.status) + '</div>' +
      '<div class="meta"><span class="plate">' + esc(a.plate) + '</span> &nbsp;<b>' + esc(a.zone) + spotLabel(a) + '</b></div>' +
      (a.note ? '<div class="meta">요청: ' + esc(a.note) + '</div>' : '') +
      (a.adminMemo ? '<div class="memo">관리자 안내: ' + esc(a.adminMemo) + '</div>' : '') +
      (canCancel ? '<div class="actions"><button class="btn sm line" data-cancel="' + esc(a.id) + '">신청 취소</button></div>' : '') +
      '</div>';
  }).join('') + '</div>' : '<div class="empty">신청 내역이 없습니다.</div>';

  var box = $('#mine-result');
  box.innerHTML = html;
  $$('[data-cancel]', box).forEach(function (b) {
    b.onclick = function () {
      if (!confirm('이 주차 신청을 취소하시겠습니까?')) return;
      withBusy(b, async function () {
        await API.call('cancelApplication', { id: b.dataset.cancel, phone: phone });
        toast('신청이 취소되었습니다.', 'success');
        await loadMine(null);
        loadZones();
      });
    };
  });
}
