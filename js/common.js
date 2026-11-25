/* 공통 도우미 */
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function fmtPhone(p) {
  p = String(p || '').replace(/\D/g, '');
  if (p.startsWith('02')) {
    if (p.length > 9) return p.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, '$1-$2-$3');
    if (p.length > 5) return p.replace(/^(\d{2})(\d{3})(\d{0,4}).*/, '$1-$2-$3');
    return p;
  }
  if (p.length > 10) return p.replace(/^(\d{3})(\d{4})(\d{0,4}).*/, '$1-$2-$3');
  if (p.length > 6) return p.replace(/^(\d{3})(\d{3})(\d{0,4}).*/, '$1-$2-$3');
  if (p.length > 3) return p.replace(/^(\d{3})(\d+)/, '$1-$2');
  return p;
}

function bindPhoneInputs() {
  $$('input[data-phone]').forEach(function (el) {
    el.addEventListener('input', function () { el.value = fmtPhone(el.value); });
  });
}

var WEEK = '일월화수목금토';
function fmtDate(s) {
  if (!s) return '';
  var d = new Date(s + 'T00:00:00Z');
  return (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일 (' + WEEK[d.getUTCDay()] + ')';
}

function addDays(s, n) {
  var d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 오늘이 주일이면 오늘, 아니면 다가오는 주일 */
function upcomingSunday(today) {
  var d = new Date(today + 'T00:00:00Z');
  return addDays(today, (7 - d.getUTCDay()) % 7);
}

function badge(status) {
  var cls = { '대기': 'wait', '승인': 'ok', '입차': 'in', '반려': 'no', '취소': 'off', '정상': 'ok', '정지': 'no' }[status] || 'off';
  return '<span class="badge badge-' + cls + '">' + esc(status) + '</span>';
}

var toastTimer;
function toast(msg, type) {
  var el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + (type || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.className = 'toast'; }, 3200);
}

async function withBusy(btn, fn) {
  if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = '처리 중…'; }
  try { return await fn(); }
  catch (e) { toast(e.message, 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; } }
}

function initTabs(onChange) {
  $$('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.dataset.tab); });
  });
  window.showTab = function (name) {
    $$('.tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    $$('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== name; });
    if (onChange) onChange(name);
    window.scrollTo(0, 0);
  };
}

var store = {
  get: function (k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
  set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
};
