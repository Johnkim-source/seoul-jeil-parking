/* 서버(Apps Script) 호출. API_URL이 비어 있으면 같은 로직을 브라우저에서 실행하는 데모 모드 */
(function () {
  var cfg = window.APP_CONFIG || {};
  var DEMO = !cfg.API_URL;

  if (DEMO) installDemoEnv();

  async function call(action, data, password) {
    var req = { action: action, data: data || {}, password: password };
    var res;
    if (DEMO) {
      await new Promise(function (r) { setTimeout(r, 120); });
      res = window.handle(JSON.parse(JSON.stringify(req)));
    } else {
      var http;
      try {
        // text/plain 으로 보내야 CORS 사전요청 없이 Apps Script로 전달됩니다.
        http = await fetch(cfg.API_URL, { method: 'POST', body: JSON.stringify(req) });
      } catch (e) {
        throw new Error('서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.');
      }
      if (!http.ok) throw new Error('서버 오류 (' + http.status + ')');
      res = await http.json();
    }
    if (!res || !res.ok) throw new Error((res && res.error) || '알 수 없는 오류');
    return res.data;
  }

  function installDemoEnv() {
    var PREFIX = 'sjc-parking-demo:';
    var mem = {};
    var fmt = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    function nowStr() { return fmt.format(new Date()).replace('T', ' '); }
    function seed(t) {
      if (t === 'vehicles') {
        return [{ id: 'V-DEMO1', createdAt: nowStr(), name: '홍길동', phone: '01012345678', group: '1교구',
          plate: '12가3456', model: '쏘나타', color: '흰색', memo: '', status: '정상', updatedAt: '' }];
      }
      return window.DEFAULT_DATA[t] ? JSON.parse(JSON.stringify(window.DEFAULT_DATA[t])) : [];
    }
    function get(t) {
      if (!mem[t]) {
        var v = null;
        try { v = JSON.parse(localStorage.getItem(PREFIX + t)); } catch (e) { /* ignore */ }
        mem[t] = Array.isArray(v) ? v : seed(t);
      }
      return mem[t];
    }
    function save(t) {
      try { localStorage.setItem(PREFIX + t, JSON.stringify(mem[t])); } catch (e) { /* ignore */ }
    }
    window.Env = {
      db: {
        all: function (t) { return get(t).map(function (o, i) { return Object.assign({}, o, { _row: i }); }); },
        insert: function (t, o) {
          var row = {};
          window.TABLES[t].columns.forEach(function (c) { row[c[0]] = o[c[0]] == null ? '' : String(o[c[0]]); });
          get(t).push(row); save(t);
        },
        update: function (t, i, patch) {
          var o = get(t)[i];
          Object.keys(patch).forEach(function (k) { o[k] = String(patch[k]); });
          save(t);
        },
        remove: function (t, i) { get(t).splice(i, 1); save(t); }
      },
      now: nowStr,
      today: function () { return nowStr().slice(0, 10); },
      adminPassword: function () { return 'admin'; },
      withLock: function (fn) { return fn(); }
    };
  }

  window.API = { call: call, DEMO: DEMO };
})();
