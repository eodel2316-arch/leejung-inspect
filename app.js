// 이정그룹 매장 점검 앱 (무드·육부)
(function () {
  const CFG = window.APP_CONFIG;
  const CL = window.CHECKLISTS;
  const $app = document.getElementById('app');
  const STORES = CFG.STORES;
  const storeName = id => (STORES.find(s => s.id === id) || {}).name || id;

  // ---------- 작은 도우미 ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${Number(m)}월 ${Number(d)}일`; };
  const fmtDateY = iso => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${y}년 ${Number(m)}월 ${Number(d)}일`; };
  const fmtTime = iso => { if (!iso) return ''; const d = new Date(iso); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const num = n => (Math.round(n * 10) / 10).toString();
  const byName = by => by === 'hq' ? '본사 점검' : '매장 자체 점검';
  const ICON = {
    camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.6-2h6.8L17 8h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="13.2" r="3.4" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  function toast(msg) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.className = 'show';
    clearTimeout(t._h); t._h = setTimeout(() => { t.className = ''; }, 2800);
  }
  function go(h) { if (location.hash === h) route(); else location.hash = h; }
  let routeSeq = 0; // 화면을 옮기면 늦게 온 응답으로 다시 그리지 않음

  // ---------- 점수 ----------
  function itemScore(cl, it, st) {
    if (!st || !st.done) return null;
    if (cl.scoring === 'deduct') return Math.max(0, it.max - (st.light || 0) - 3 * (st.big || 0));
    return { full: it.max, half: it.max / 2, zero: 0 }[st.level] ?? null;
  }
  function grade(total) {
    for (const [min, g, label] of CL.grades) if (total >= min) return { g, label };
    return { g: 'D', label: '개선 필요' };
  }
  function sections(cl) {
    const out = [];
    for (const it of cl.items) {
      let s = out.find(x => x.name === it.section);
      if (!s) { s = { name: it.section, items: [], max: 0 }; out.push(s); }
      s.items.push(it); s.max += it.max;
    }
    return out;
  }
  function summarize(cl, items) {
    let total = 0, done = 0; const subs = {};
    for (const sec of sections(cl)) {
      let sub = 0;
      for (const it of sec.items) { const sc = itemScore(cl, it, items[it.no]); if (sc != null) { sub += sc; done++; } }
      subs[sec.name] = sub; total += sub;
    }
    const critical = cl.scoring === 'level' ? cl.items.filter(it => it.level === '상' && itemScore(cl, it, items[it.no]) === 0).map(it => it.no) : [];
    return { total, done, count: cl.items.length, subs, critical, grade: grade(total) };
  }
  const deducted = (cl, x) => cl.items.filter(it => { const v = x.items[it.no]; return v && v.score != null && v.score < it.max; });
  const openFixes = x => deducted(CL[x.type], x).filter(it => !x.items[it.no].fix).length;

  // ---------- 사진 ----------
  async function compress(file) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    const M = 1280; let w = img.naturalWidth, h = img.naturalHeight;
    if (Math.max(w, h) > M) { const k = M / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(img.src);
    return new Promise(res => c.toBlob(res, 'image/jpeg', 0.72));
  }
  function pickPhotos() {
    return new Promise(res => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
      inp.onchange = async () => {
        const ids = [];
        for (const f of inp.files) ids.push(await API.putLocalPhoto(await compress(f)));
        res(ids);
      };
      inp.click();
    });
  }
  async function fillPhotos(root) {
    for (const el of (root || document).querySelectorAll('img[data-ref]')) {
      if (el.getAttribute('src')) continue;
      el.src = await API.photoUrl(el.dataset.ref);
    }
  }
  function photoStrip(refs, removable) {
    if (!refs || !refs.length) return '';
    return '<div class="photos">' + refs.map(r =>
      `<span class="ph"><img data-ref="${esc(r)}" alt="점검 사진" data-act="zoom" loading="lazy">${removable ? `<button class="ph-x" data-act="delphoto" data-ref="${esc(r)}" aria-label="사진 빼기">×</button>` : ''}</span>`).join('') + '</div>';
  }
  function zoom(src) {
    const z = document.createElement('div'); z.className = 'zoom'; z.innerHTML = `<img src="${src}" alt="">`;
    z.onclick = () => z.remove(); document.body.appendChild(z);
  }
  // 한 번에 n개씩 동시에
  async function inParallel(list, n, fn) {
    const out = new Array(list.length); let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); } }));
    return out;
  }

  // ---------- 공통 틀 ----------
  function bar(title, back) {
    const s = API.session();
    const who = s ? (s.role === 'hq' ? CFG.HQ_NAME : storeName(s.storeId)) : '';
    return `<header class="bar">
      ${back ? `<button class="bar-back" data-go="${esc(back)}" aria-label="뒤로">${ICON.back}</button>` : '<img class="bar-mark" src="icons/mark-l.png" alt="">'}
      <div class="bar-t"><b>${esc(title)}</b>${who ? `<small>${esc(who)}</small>` : ''}</div>
      ${s ? '<button class="bar-out" data-act="logout">로그아웃</button>' : ''}
    </header>${API.DEMO ? '<p class="demo">시험 모드입니다. 기록이 이 휴대폰에만 저장됩니다.</p>' : ''}`;
  }

  // ---------- 로그인 ----------
  function viewLogin() {
    $app.innerHTML = `<main class="login">
        <img class="logo-h" src="icons/logo-h.png" alt="LEEJUNG GROUP · HANWOO DINING & SUPPLY">
        <h1>매장 점검</h1>
        <p class="lead">무드 점검과 육부 점검을 휴대폰으로 기록합니다.</p>
        <label class="fld"><span>매장</span>
          <select id="lgStore">
            <option value="">매장을 고르세요</option>
            ${STORES.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
            <option value="HQ">${esc(CFG.HQ_NAME)}</option>
          </select></label>
        <label class="fld"><span>비밀번호</span>
          <input id="lgPw" type="password" inputmode="numeric" autocomplete="current-password"></label>
        <button class="btn btn-main" id="lgBtn">들어가기</button>
        ${API.DEMO ? `<p class="hint">시험 모드 비밀번호는 매장 ${esc(CFG.DEMO_STORE_PW)}, 본사 ${esc(CFG.DEMO_HQ_PW)}입니다.</p>` : ''}
      </main>`;
    const last = localStorage.getItem('inspect.lastStore'); if (last) document.getElementById('lgStore').value = last;
    const doLogin = async () => {
      const st = document.getElementById('lgStore').value, pw = document.getElementById('lgPw').value;
      if (!st) return toast('매장을 골라 주세요.');
      const btn = document.getElementById('lgBtn'); btn.disabled = true; btn.textContent = '확인하는 중';
      try { await API.login(st, pw); localStorage.setItem('inspect.lastStore', st); go('#/'); }
      catch (e) { toast(e.message); btn.disabled = false; btn.textContent = '들어가기'; }
    };
    document.getElementById('lgBtn').onclick = doLogin;
    document.getElementById('lgPw').onkeydown = e => { if (e.key === 'Enter') doLogin(); };
  }

  // ---------- 첫 화면 ----------
  async function viewHome() {
    const seq = routeSeq; const s = API.session(); const hq = s.role === 'hq';
    const d = new Date();
    const curStore = () => hq ? (document.getElementById('hmStore') || {}).value : s.storeId;
    $app.innerHTML = bar(CFG.APP_NAME) + `<main class="page">
      <section class="hello">
        ${hq ? `<label class="fld fld-store"><span>점검할 매장</span>
          <select id="hmStore">${STORES.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>`
          : `<h1>${esc(storeName(s.storeId))}</h1>`}
        <p class="today">${d.getMonth() + 1}월 ${d.getDate()}일 ${DOW[d.getDay()]}요일</p>
      </section>
      <div class="starts" id="starts"></div>
      ${hq ? '<button class="btn btn-line" data-go="#/hq">전 매장 취합 보기</button>' : ''}
      <h2 class="h2">지난 점검</h2>
      <div id="recent" class="sheet rows"></div>
    </main>`;
    const sel = document.getElementById('hmStore');
    const drawStarts = async () => {
      const sid = curStore(); const box = document.getElementById('starts'); if (!box) return;
      const parts = [];
      for (const t of ['mood', 'meat']) {
        const dr = await API.loadDraft(sid + ':' + t);
        const sm = dr ? summarize(CL[t], dr.items) : null;
        parts.push(`<button class="start start-${t}" data-start="${t}">
          <span class="start-t">${esc(CL[t].name)}</span>
          <span class="start-s">${sm && sm.done ? `이어서 하기 <b>${sm.done}/${sm.count}</b>` : `${CL[t].items.length}개 항목`}</span>
        </button>`);
      }
      box.innerHTML = parts.join('');
      box.querySelectorAll('[data-start]').forEach(b => b.onclick = () => go('#/check/' + b.dataset.start + '/' + curStore()));
    };
    if (sel) { const l = localStorage.getItem('inspect.hqStore'); if (l) sel.value = l; sel.onchange = () => { localStorage.setItem('inspect.hqStore', sel.value); drawStarts(); }; }
    drawStarts();
    const draw = list => {
      const box = document.getElementById('recent'); if (!box || seq !== routeSeq) return;
      box.innerHTML = list && list.length ? list.slice(0, hq ? 40 : 20).map(rowCard).join('') : '<p class="empty">아직 제출한 점검이 없습니다. 위에서 점검을 시작하세요.</p>';
    };
    const cached = API.cachedList();
    if (cached) draw(cached); else document.getElementById('recent').innerHTML = '<p class="empty">불러오는 중</p>';
    try { draw(await API.list()); } catch (e) { if (!cached) { const box = document.getElementById('recent'); if (box) box.innerHTML = `<p class="err">${esc(e.message)}</p>`; } }
  }
  function gradeTile(total, cls) { const g = grade(total).g; return `<span class="gt g${g} ${cls || ''}">${g}</span>`; }
  function rowCard(x) {
    const open = openFixes(x);
    const flags = [!x.confirmedAt ? '<em class="flag flag-wait">점장 확인 전</em>' : '', open ? `<em class="flag flag-red">조치 ${open}건 남음</em>` : ''].join('');
    return `<a class="row" href="#/r/${encodeURIComponent(x.id)}">
      ${gradeTile(x.total)}
      <span class="row-m"><b>${esc(storeName(x.storeId))} ${esc(CL[x.type].name)}</b>
        <small><span>${fmtDate(x.date)}</span><span>${byName(x.by)}</span><span>${esc(x.inspector)}</span></small>
        ${flags ? `<span class="flags">${flags}</span>` : ''}</span>
      <span class="row-s">${num(x.total)}<small>점</small></span>
    </a>`;
  }

  // ---------- 점검 화면 ----------
  let D = null, saveTimer = null;
  function saveSoon() { clearTimeout(saveTimer); const d = D; saveTimer = setTimeout(() => { if (d && d === D) API.saveDraft(d.key, d); }, 300); }
  const newId = (type, storeId) => type + '-' + today().replace(/-/g, '') + '-' + storeId + '-' + API.uid().slice(-4);
  // 사진은 찍자마자 뒤에서 올려 둔다(제출할 때 기다리지 않게)
  function uploadBg(ref, no) {
    const d = D;
    API.uploadPhoto(ref, { inspectionId: d.id, storeId: d.storeId, no, kind: 'before' })
      .then(g => { d.up = d.up || {}; d.up[ref] = g; if (d === D) saveSoon(); else API.saveDraft(d.key, d); })
      .catch(() => { /* 제출할 때 다시 올림 */ });
  }

  async function viewCheck(type, storeId) {
    const s = API.session();
    if (s.role === 'store' && storeId !== s.storeId) return go('#/');
    const cl = CL[type]; const key = storeId + ':' + type;
    D = await API.loadDraft(key);
    if (!D) D = { key, type, storeId, by: s.role === 'hq' ? 'hq' : 'store', date: today(), items: {}, inspector: localStorage.getItem('inspect.inspector') || '', notes: '', dueDate: '', startedAt: new Date().toISOString() };
    if (!D.id) D.id = newId(type, storeId);
    D.up = D.up || {};
    // 예전에 올리다 만 사진 다시 올리기
    for (const [no, st] of Object.entries(D.items)) for (const p of (st.photos || [])) if (!D.up[p]) uploadBg(p, Number(no));
    const secs = sections(cl);
    $app.innerHTML = bar(cl.name, '#/') + `
      <div class="progress" id="prog"></div>
      <main class="page check">
        <p class="who-store">${esc(storeName(storeId))}</p>
        <details class="rules"><summary>채점 방법</summary><ul>${cl.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul></details>
        ${secs.map((sec, i) => `<section class="sec">
          <header class="sec-h"><h3>${esc(sec.name)}</h3><span id="sub${i}"></span></header>
          <div class="sheet">${sec.items.map(it => `<div class="it" id="it${it.no}"></div>`).join('')}</div>
        </section>`).join('')}
        <button class="btn btn-main" id="toFinish">마무리하기</button>
        <button class="btn btn-quiet" id="discard">이 점검 지우고 처음부터</button>
      </main>`;
    for (const it of cl.items) renderItem(cl, it);
    renderProgress(cl);
    document.getElementById('toFinish').onclick = async () => {
      clearTimeout(saveTimer); await API.saveDraft(D.key, D);
      const sm = summarize(cl, D.items);
      if (sm.done < sm.count) {
        const first = cl.items.find(it => itemScore(cl, it, D.items[it.no]) == null);
        toast(`아직 ${sm.count - sm.done}개 항목이 남았습니다.`);
        document.getElementById('it' + first.no).scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      go('#/finish/' + type + '/' + storeId);
    };
    document.getElementById('discard').onclick = async () => {
      if (!confirm('쓰던 점검을 지울까요? 되돌릴 수 없습니다.')) return;
      for (const st of Object.values(D.items)) for (const p of (st.photos || [])) await API.deleteLocalPhoto(p);
      clearTimeout(saveTimer); await API.deleteDraft(key); D = null; go('#/');
    };
    const main = $app.querySelector('main');
    main.addEventListener('click', e => onItemClick(e, cl));
    main.addEventListener('input', e => { const no = e.target.dataset.note; if (!no) return; st(no).note = e.target.value; saveSoon(); });
  }
  function st(no) { return D.items[no] || (D.items[no] = { done: false, light: 0, big: 0, level: null, note: '', photos: [] }); }

  function renderProgress(cl) {
    const sm = summarize(cl, D.items);
    const pct = Math.round(sm.done / sm.count * 100);
    document.getElementById('prog').innerHTML = `
      <span class="pg-n"><b>${sm.done}</b>/${sm.count}</span>
      <span class="pg-line"><i style="width:${pct}%"></i></span>
      <span class="pg-s"><b>${num(sm.total)}</b>점${sm.done === sm.count ? gradeTile(sm.total, 'gt-sm') : ''}</span>`;
    sections(cl).forEach((sec, i) => {
      const done = sec.items.filter(it => itemScore(cl, it, D.items[it.no]) != null).length;
      document.getElementById('sub' + i).textContent = done ? `${num(sm.subs[sec.name])}/${sec.max}점` : `${sec.max}점`;
    });
  }

  function renderItem(cl, it) {
    const s = D.items[it.no] || {};
    const sc = itemScore(cl, it, s);
    const el = document.getElementById('it' + it.no);
    el.className = 'it' + (sc == null ? '' : sc === it.max ? ' is-ok' : sc === 0 ? ' is-bad' : ' is-part');
    let ctrl;
    if (cl.scoring === 'deduct') {
      ctrl = `<div class="seg3" role="group" aria-label="${esc(it.title)} 채점">
          <button class="${s.done && !s.light && !s.big ? 'on-ok' : ''}" data-act="good" data-no="${it.no}">문제 없음</button>
          <button class="num ${s.light ? 'on-part' : ''}" data-act="light" data-no="${it.no}" aria-label="가벼운 문제 1점 빼기">−1${s.light ? `<small>${s.light}번</small>` : ''}</button>
          <button class="num ${s.big ? 'on-bad' : ''}" data-act="big" data-no="${it.no}" aria-label="큰 문제 3점 빼기">−3${s.big ? `<small>${s.big}번</small>` : ''}</button>
        </div>
        ${(s.light || s.big) ? `<button class="undo" data-act="undo" data-no="${it.no}">감점 하나 취소</button>` : ''}
        <dl class="ex"><dt>가벼운 문제</dt><dd>${esc(it.light)}</dd><dt>큰 문제</dt><dd>${esc(it.big)}</dd></dl>`;
    } else {
      ctrl = `<div class="seg3" role="group" aria-label="${esc(it.title)} 채점">
          <button class="${s.level === 'full' ? 'on-ok' : ''}" data-act="lv" data-lv="full" data-no="${it.no}">잘 지켜짐<small>${it.max}점</small></button>
          <button class="${s.level === 'half' ? 'on-part' : ''}" data-act="lv" data-lv="half" data-no="${it.no}">일부만<small>${num(it.max / 2)}점</small></button>
          <button class="${s.level === 'zero' ? 'on-bad' : ''}" data-act="lv" data-lv="zero" data-no="${it.no}">안 지켜짐<small>0점</small></button>
        </div>
        ${it.level === '상' && s.level === 'zero' ? '<p class="alert">중요도 상 항목이 0점입니다. 오늘 바로 고치고 재교육하세요.</p>' : ''}`;
    }
    const lv = it.level ? `<em class="lv lv-${it.level === '상' ? 'h' : it.level === '중' ? 'm' : 'l'}">중요도 ${esc(it.level)}</em>` : '';
    const n = (s.photos || []).length;
    el.innerHTML = `
      <div class="it-h"><span class="no">${it.no}</span><h4>${esc(it.title)}</h4><span class="pts">${sc == null ? '' : `<b>${num(sc)}</b>/`}${it.max}점</span></div>
      ${lv}<p class="q">${esc(it.question)}</p>
      ${ctrl}
      ${photoStrip(s.photos, true)}
      <div class="tools">
        <button class="cam" data-act="photo" data-no="${it.no}" aria-label="사진 찍기">${ICON.camera}${n ? `<span>${n}</span>` : ''}</button>
        <input class="note" data-note="${it.no}" placeholder="비고" value="${esc(s.note || '')}">
      </div>`;
    fillPhotos(el);
  }

  async function onItemClick(e, cl) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'zoom') return zoom(b.src);
    const no = b.dataset.no || (b.closest('.it') && b.closest('.it').id.slice(2));
    if (!no) return;
    const it = cl.items.find(x => String(x.no) === String(no)); const s = st(no);
    if (act === 'good') { s.done = true; s.light = 0; s.big = 0; }
    else if (act === 'light') { s.done = true; s.light = (s.light || 0) + 1; }
    else if (act === 'big') { s.done = true; s.big = (s.big || 0) + 1; }
    else if (act === 'undo') { if (s.big) s.big--; else if (s.light) s.light--; }
    else if (act === 'lv') { s.done = true; s.level = b.dataset.lv; }
    else if (act === 'photo') { const ids = await pickPhotos(); s.photos = (s.photos || []).concat(ids); ids.forEach(r => uploadBg(r, Number(no))); }
    else if (act === 'delphoto') { if (!confirm('이 사진을 뺄까요?')) return; s.photos = s.photos.filter(p => p !== b.dataset.ref); await API.deleteLocalPhoto(b.dataset.ref); }
    if (cl.scoring === 'deduct' && (act === 'light' || act === 'big') && it.max - (s.light || 0) - 3 * (s.big || 0) < 0) toast('이미 0점입니다. 0점 아래로는 내려가지 않습니다.');
    renderItem(cl, it); renderProgress(cl); saveSoon();
  }

  // ---------- 마무리·제출 ----------
  async function viewFinish(type, storeId) {
    const cl = CL[type]; const key = storeId + ':' + type;
    D = await API.loadDraft(key); if (!D) return go('#/');
    const sm = summarize(cl, D.items);
    const ded = cl.items.filter(it => { const sc = itemScore(cl, it, D.items[it.no]); return sc != null && sc < it.max; });
    $app.innerHTML = bar('마무리', '#/check/' + type + '/' + storeId) + `<main class="page">
      ${seal(sm.total, `${esc(storeName(storeId))} ${esc(cl.name)}`, ded.length ? `감점 항목 ${ded.length}개` : '감점 없음')}
      ${sm.critical.length ? `<p class="alert">중요도 상 항목 ${sm.critical.length}개가 0점입니다. 오늘 바로 조치가 필요합니다.</p>` : ''}
      <div class="form">
        <label class="fld"><span>점검일</span><input id="fDate" type="date" value="${esc(D.date)}"></label>
        <label class="fld"><span>점검자 이름</span><input id="fName" value="${esc(D.inspector)}" autocomplete="name"></label>
        <div class="fld"><span>점검 구분</span><div class="seg2">
          <button class="${D.by === 'hq' ? 'on' : ''}" data-by="hq">본사 점검</button>
          <button class="${D.by === 'store' ? 'on' : ''}" data-by="store">매장 자체 점검</button></div></div>
        <label class="fld"><span>특이사항</span><textarea id="fNotes" rows="4">${esc(D.notes)}</textarea></label>
        <label class="fld"><span>조치 기한${ded.length ? '' : ' (감점이 없으면 비워도 됩니다)'}</span><input id="fDue" type="date" value="${esc(D.dueDate)}"></label>
      </div>
      <button class="btn btn-main" id="fSubmit">제출하기</button>
      <p class="hint">제출하면 점장님이 확인 버튼을 누르고, 감점 항목마다 조치 후 사진을 올립니다.</p>
    </main>`;
    const sync = () => {
      D.date = document.getElementById('fDate').value; D.inspector = document.getElementById('fName').value.trim();
      D.notes = document.getElementById('fNotes').value; D.dueDate = document.getElementById('fDue').value; saveSoon();
    };
    $app.querySelectorAll('input,textarea').forEach(x => x.oninput = sync);
    $app.querySelectorAll('[data-by]').forEach(b => b.onclick = () => {
      D.by = b.dataset.by; $app.querySelectorAll('[data-by]').forEach(x => x.classList.toggle('on', x === b)); saveSoon();
    });
    document.getElementById('fSubmit').onclick = async () => {
      sync();
      if (!D.inspector) return toast('점검자 이름을 적어 주세요.');
      if (!D.date) return toast('점검일을 골라 주세요.');
      if (ded.length && !D.dueDate) return toast('감점 항목이 있어 조치 기한이 필요합니다.');
      localStorage.setItem('inspect.inspector', D.inspector);
      const btn = document.getElementById('fSubmit'); btn.disabled = true;
      try { const id = await submitDraft(cl, sm, btn); toast('제출했습니다.'); go('#/r/' + encodeURIComponent(id)); }
      catch (e) { toast(e.message); btn.disabled = false; btn.textContent = '제출하기'; }
    };
  }

  async function submitDraft(cl, sm, btn) {
    const d = D; const id = d.id;
    const refs = []; for (const it of cl.items) for (const p of (d.items[it.no].photos || [])) refs.push([p, it.no]);
    let n = 0; const left = refs.filter(([p]) => !(d.up || {})[p]).length;
    btn.textContent = left ? `사진 올리는 중 0/${left}` : '저장하는 중';
    const insp = {
      id, type: d.type, storeId: d.storeId, storeName: storeName(d.storeId), by: d.by, date: d.date,
      inspector: d.inspector, notes: d.notes, dueDate: d.dueDate, items: {},
      total: sm.total, grade: sm.grade.g, subs: sm.subs, critical: sm.critical,
      max: Object.fromEntries(cl.items.map(it => [it.no, it.max])),
      titles: Object.fromEntries(cl.items.map(it => [it.no, it.title])),
      startedAt: d.startedAt, submittedAt: new Date().toISOString(), confirmedAt: null, confirmedBy: null
    };
    for (const it of cl.items) {
      const s = d.items[it.no];
      insp.items[it.no] = { score: itemScore(cl, it, s), light: s.light || 0, big: s.big || 0, level: s.level || null, note: s.note || '', photos: [] };
    }
    // 사진(아직 안 올라간 것만)과 카톡용 결과 그림을 동시에 올림
    const summaryJob = (async () => {
      try { const ref = await API.putLocalPhoto(await summaryImage(insp)); return await API.uploadPhoto(ref, { inspectionId: id, storeId: d.storeId, no: 0, kind: 'summary' }); }
      catch (e) { return null; }
    })();
    const ups = await inParallel(refs, 3, async ([p, no]) => {
      if (d.up && d.up[p]) return d.up[p];
      const g = await API.uploadPhoto(p, { inspectionId: id, storeId: d.storeId, no, kind: 'before' });
      n++; btn.textContent = `사진 올리는 중 ${n}/${left}`;
      return g;
    });
    refs.forEach(([p, no], i) => insp.items[no].photos.push(ups[i]));
    insp.summaryImage = await summaryJob;
    btn.textContent = '저장하는 중';
    await API.submit(insp);
    clearTimeout(saveTimer);
    for (const [p] of refs) await API.deleteLocalPhoto(p);
    await API.deleteDraft(d.key); D = null;
    return id;
  }

  // 점수 도장: 큰 점수 + 금색 줄 + 등급 (로고의 금색 줄을 따옴)
  function seal(total, title, sub) {
    const g = grade(total);
    return `<section class="seal">
      <p class="seal-t">${title}</p>
      <div class="seal-row"><span class="seal-n">${num(total)}<small>점</small></span>${gradeTile(total, 'gt-lg')}</div>
      <hr class="seal-rule">
      <p class="seal-s">${esc(g.label)}<span>${sub}</span></p>
    </section>`;
  }

  // ---------- 결과 화면 ----------
  async function viewResult(id) {
    const seq = routeSeq;
    let x = API.cachedGet(id);
    if (x) renderResult(x);
    else $app.innerHTML = bar('점검 결과', '#/') + '<main class="page"><p class="empty">불러오는 중</p></main>';
    if (API.DEMO && x) return;
    try {
      const fresh = await API.get(id);
      if (seq !== routeSeq) return;
      if (!fresh) { $app.querySelector('main').innerHTML = '<p class="err">기록을 찾을 수 없습니다. 지워졌을 수 있습니다.</p>'; return; }
      if (!x || JSON.stringify(fresh) !== JSON.stringify(x)) renderResult(fresh);
    } catch (e) { if (!x && seq === routeSeq) $app.querySelector('main').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }
  function renderResult(x) {
    const cl = CL[x.type]; const secs = sections(cl); const ded = deducted(cl, x); const s = API.session();
    const prev = (API.cachedList() || []).filter(y => y.storeId === x.storeId && y.type === x.type && y.id !== x.id && (y.submittedAt || '') < (x.submittedAt || ''))[0];
    const diff = prev ? x.total - prev.total : null;
    const fixedN = ded.filter(it => x.items[it.no].fix).length;
    $app.innerHTML = bar(cl.name + ' 결과', '#/') + `<main class="page">
      ${seal(x.total, `${esc(storeName(x.storeId))} ${esc(cl.name)}`, diff == null ? '첫 점검' : `지난번보다 ${diff >= 0 ? '+' : ''}${num(diff)}점`)}
      ${x.critical && x.critical.length ? `<p class="alert">중요도 상 0점: ${x.critical.map(n => esc(cl.items.find(i => i.no === n).title)).join(', ')}. 오늘 바로 고치고 재교육하세요.</p>` : ''}
      <dl class="facts">
        <dt>점검일</dt><dd>${fmtDateY(x.date)}</dd>
        <dt>구분</dt><dd>${byName(x.by)}</dd>
        <dt>점검자</dt><dd>${esc(x.inspector)}</dd>
        <dt>점장 확인</dt><dd>${x.confirmedAt ? `<span class="ok">${ICON.check}${esc(x.confirmedBy)}</span> <small>${fmtTime(x.confirmedAt)}</small>` : '<button class="btn-sm" data-act="confirm">확인하기</button>'}</dd>
        ${ded.length ? `<dt>조치 기한</dt><dd>${fmtDateY(x.dueDate) || '없음'}</dd>` : ''}
      </dl>
      <h2 class="h2">구분별 점수</h2>
      <div class="sheet bars">${secs.map(sec => { const v = (x.subs || {})[sec.name] || 0; return `
        <div class="bar-r"><span>${esc(sec.name)}</span><span class="bar-l"><i class="${v === sec.max ? 'full' : ''}" style="width:${v / sec.max * 100}%"></i></span><b>${num(v)}<small>/${sec.max}</small></b></div>`; }).join('')}</div>
      <h2 class="h2">감점 항목 <small>${ded.length ? `조치 ${fixedN}/${ded.length}` : ''}</small></h2>
      ${ded.length ? `<div class="sheet">${ded.map(it => dedCard(cl, x, it)).join('')}</div>` : '<p class="empty">감점 항목이 없습니다.</p>'}
      ${x.notes ? `<h2 class="h2">특이사항</h2><p class="sheet notes">${esc(x.notes)}</p>` : ''}
      <details class="allitems"><summary>전체 ${cl.items.length}개 항목 보기</summary>
        <div class="sheet">${cl.items.map(it => { const v = x.items[it.no]; return `<div class="mini"><span class="no">${it.no}</span><span class="mini-t">${esc(it.title)}${v.note ? `<small>${esc(v.note)}</small>` : ''}</span><b>${num(v.score)}/${it.max}</b></div>`; }).join('')}</div>
      </details>
      <div class="actions">
        <button class="btn btn-line" data-act="excel">엑셀로 받기</button>
        ${x.summaryImage ? '<button class="btn btn-line" data-act="img">결과 그림 저장</button>' : ''}
      </div>
      ${s.role === 'hq' ? '<button class="btn btn-quiet" data-act="remove">이 점검 지우기</button>' : ''}
    </main>`;
    fillPhotos($app);
    $app.querySelector('main').onclick = async e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act;
      if (act === 'zoom') return zoom(b.src);
      if (act === 'confirm') {
        const name = prompt('점장님 이름을 적어 주세요.', localStorage.getItem('inspect.manager') || '');
        if (!name) return; localStorage.setItem('inspect.manager', name.trim());
        b.disabled = true; b.textContent = '저장하는 중';
        try { renderResult(await API.confirm(x.id, name.trim())); toast('점장 확인을 남겼습니다.'); } catch (er) { toast(er.message); b.disabled = false; b.textContent = '확인하기'; }
      }
      if (act === 'fix') return fixDialog(x, Number(b.dataset.no));
      if (act === 'excel') { b.disabled = true; b.textContent = '엑셀 만드는 중'; try { await window.XLS.inspection(x); } catch (er) { toast('엑셀을 만들지 못했습니다. ' + er.message); } b.disabled = false; b.textContent = '엑셀로 받기'; }
      if (act === 'img') { b.disabled = true; const bl = await API.photoBlob(x.summaryImage); downloadBlob(bl, `${storeName(x.storeId)}_${cl.name}_${x.date}.png`); b.disabled = false; }
      if (act === 'remove') {
        if (!confirm('이 점검 기록을 지울까요? 시트에서 빠지고 사진은 드라이브 휴지통으로 갑니다.')) return;
        b.disabled = true;
        try { await API.remove(x.id); toast('점검 기록을 지웠습니다.'); go('#/'); } catch (er) { toast(er.message); b.disabled = false; }
      }
    };
  }
  function dedCard(cl, x, it) {
    const v = x.items[it.no]; const f = v.fix;
    const why = cl.scoring === 'deduct' ? [v.light ? `가벼운 문제 ${v.light}건` : '', v.big ? `큰 문제 ${v.big}건` : ''].filter(Boolean).join(', ') : (v.level === 'half' ? '일부만 지켜짐' : '안 지켜짐');
    return `<div class="ded ${f ? 'is-fixed' : ''}">
      <div class="it-h"><span class="no">${it.no}</span><h4>${esc(it.title)}</h4><span class="pts"><b>${num(v.score)}</b>/${it.max}점</span></div>
      <p class="why">${esc(why)}${v.note ? `. ${esc(v.note)}` : ''}</p>
      <div class="ba">
        <div><p class="ba-h">조치 전</p>${photoStrip(v.photos) || '<p class="none">사진 없음</p>'}</div>
        <div><p class="ba-h">조치 후</p>${f ? photoStrip(f.photos) + `<p class="fix-n">${esc(f.note || '')}</p><p class="none">${esc(f.by || '')}, ${fmtTime(f.at)}</p>` : `<button class="btn-sm" data-act="fix" data-no="${it.no}">조치 완료 올리기</button>`}</div>
      </div></div>`;
  }
  async function fixDialog(x, no) {
    const cl = CL[x.type]; const it = cl.items.find(i => i.no === no);
    const dlg = document.createElement('div'); dlg.className = 'sheet-pop';
    let photos = [];
    dlg.innerHTML = `<div class="pop" role="dialog" aria-label="조치 완료 올리기"><h3>${esc(it.title)}</h3><p class="pop-s">조치한 뒤 모습을 찍어 올려 주세요.</p>
      <div id="fxPh"></div>
      <button class="btn btn-line" id="fxAdd">${ICON.camera} 조치 후 사진 넣기</button>
      <label class="fld"><span>조치 내용</span><textarea id="fxNote" rows="3"></textarea></label>
      <label class="fld"><span>조치한 사람</span><input id="fxBy" value="${esc(localStorage.getItem('inspect.manager') || '')}"></label>
      <div class="actions"><button class="btn btn-line" id="fxCancel">취소</button><button class="btn btn-main" id="fxSave">올리기</button></div></div>`;
    document.body.appendChild(dlg);
    const draw = () => { dlg.querySelector('#fxPh').innerHTML = photoStrip(photos); fillPhotos(dlg); };
    dlg.querySelector('#fxAdd').onclick = async () => {
      const ids = await pickPhotos(); photos = photos.concat(ids); draw();
      ids.forEach(r => API.uploadPhoto(r, { inspectionId: x.id, storeId: x.storeId, no, kind: 'after' }).catch(() => {})); // 미리 올림
    };
    dlg.querySelector('#fxCancel').onclick = async () => { for (const p of photos) await API.deleteLocalPhoto(p); dlg.remove(); };
    dlg.querySelector('#fxSave').onclick = async e => {
      const by = dlg.querySelector('#fxBy').value.trim(); const note = dlg.querySelector('#fxNote').value.trim();
      if (!photos.length) return toast('조치 후 사진을 넣어 주세요.');
      if (!by) return toast('조치한 사람 이름을 적어 주세요.');
      e.target.disabled = true; e.target.textContent = '올리는 중';
      try {
        const up = await inParallel(photos, 3, p => API.uploadPhoto(p, { inspectionId: x.id, storeId: x.storeId, no, kind: 'after' }));
        for (const p of photos) await API.deleteLocalPhoto(p);
        localStorage.setItem('inspect.manager', by);
        const nx = await API.fix(x.id, no, { photos: up, note, by, at: new Date().toISOString() });
        dlg.remove(); toast('조치 완료를 올렸습니다.'); renderResult(nx);
      } catch (er) { toast(er.message); e.target.disabled = false; e.target.textContent = '올리기'; }
    };
  }
  function downloadBlob(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------- 결과 그림(카톡용) ----------
  async function summaryImage(x) {
    const cl = CL[x.type]; const g = grade(x.total); const secs = sections(cl); const ded = deducted(cl, x);
    const W = 900, rowH = 46; const H = 360 + secs.length * rowH + 70 + Math.min(ded.length, 10) * 40 + 70;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const t = c.getContext('2d');
    const F = '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif';
    const GC = { A: '#2D6A4F', B: '#2F5E86', C: '#B6731A', D: '#9E3324' };
    t.fillStyle = '#FFFFFF'; t.fillRect(0, 0, W, H);
    t.fillStyle = '#08261C'; t.fillRect(0, 0, W, 132);
    t.fillStyle = '#C9A24A'; t.font = `600 24px ${F}`; t.fillText('LEEJUNG GROUP  ' + cl.name, 48, 54);
    t.fillStyle = '#FFFFFF'; t.font = `bold 40px ${F}`; t.fillText(storeName(x.storeId), 48, 104);
    t.fillStyle = '#1B1F1D'; t.font = `bold 96px ${F}`; t.fillText(num(x.total), 48, 262);
    const nw = t.measureText(num(x.total)).width;
    t.font = `bold 34px ${F}`; t.fillText('점', 56 + nw, 262);
    t.fillStyle = GC[g.g]; t.fillRect(W - 48 - 96, 178, 96, 96);
    t.fillStyle = '#FFFFFF'; t.font = `bold 58px ${F}`; t.textAlign = 'center'; t.fillText(g.g, W - 48 - 48, 247); t.textAlign = 'left';
    t.fillStyle = '#C9A24A'; t.fillRect(48, 292, W - 96, 3);
    t.fillStyle = '#6E6A63'; t.font = `24px ${F}`;
    t.fillText(`${g.label}   ${fmtDateY(x.date)}   ${byName(x.by)}   점검자 ${x.inspector}`, 48, 334);
    let y = 372;
    for (const sec of secs) {
      const v = (x.subs || {})[sec.name] || 0;
      t.fillStyle = '#1B1F1D'; t.font = `22px ${F}`; t.fillText(sec.name, 48, y + 22);
      t.fillStyle = '#E4E8E4'; t.fillRect(270, y + 9, 460, 14);
      t.fillStyle = v === sec.max ? '#2D6A4F' : '#08261C'; t.fillRect(270, y + 9, 460 * v / sec.max, 14);
      t.fillStyle = '#1B1F1D'; t.font = `bold 22px ${F}`; t.textAlign = 'right'; t.fillText(`${num(v)} / ${sec.max}`, W - 48, y + 24); t.textAlign = 'left';
      y += rowH;
    }
    y += 34; t.fillStyle = '#08261C'; t.font = `bold 24px ${F}`; t.fillText(ded.length ? `감점 항목 ${ded.length}개` : '감점 항목 없음', 48, y); y += 10;
    for (const it of ded.slice(0, 10)) {
      const v = x.items[it.no]; y += 40;
      const crit = x.critical && x.critical.includes(it.no);
      t.fillStyle = crit ? '#9E3324' : '#1B1F1D'; t.font = `22px ${F}`;
      let label = `${it.no}. ${it.title}`; if (label.length > 26) label = label.slice(0, 25) + '…';
      t.fillText(label + (crit ? '  (중요도 상 0점)' : ''), 48, y);
      t.fillStyle = '#1B1F1D'; t.font = `bold 22px ${F}`; t.textAlign = 'right'; t.fillText(`${num(v.score)} / ${it.max}`, W - 48, y); t.textAlign = 'left';
    }
    if (ded.length > 10) { y += 40; t.fillStyle = '#6E6A63'; t.font = `20px ${F}`; t.fillText(`외 ${ded.length - 10}개`, 48, y); }
    if (x.dueDate) { t.fillStyle = '#6E6A63'; t.font = `22px ${F}`; t.fillText(`조치 기한 ${fmtDateY(x.dueDate)}`, 48, H - 34); }
    return new Promise(res => c.toBlob(res, 'image/png'));
  }

  // ---------- 본사 취합 ----------
  async function viewHq() {
    const seq = routeSeq; const s = API.session(); if (s.role !== 'hq') return go('#/');
    const cached = API.cachedList();
    if (cached) renderHq(cached); else $app.innerHTML = bar('전 매장 취합', '#/') + '<main class="page"><p class="empty">불러오는 중</p></main>';
    try { const fresh = await API.list(); if (seq === routeSeq && (!cached || JSON.stringify(fresh) !== JSON.stringify(cached))) renderHq(fresh); }
    catch (e) { if (!cached && seq === routeSeq) $app.querySelector('main').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }
  function renderHq(list) {
    const months = [...new Set(list.map(x => x.date.slice(0, 7)))].sort().reverse();
    const cur = today().slice(0, 7); if (!months.includes(cur)) months.unshift(cur);
    const m = sessionStorage.getItem('inspect.hqMonth') || months[0];
    const inMonth = list.filter(x => x.date.slice(0, 7) === m);
    const latest = (sid, type) => inMonth.filter(x => x.storeId === sid && x.type === type).sort((a, b) => b.date.localeCompare(a.date) || (b.submittedAt || '').localeCompare(a.submittedAt || ''))[0];
    const cell = x => x ? `<a href="#/r/${encodeURIComponent(x.id)}" class="cellx">${gradeTile(x.total, 'gt-sm')}<b>${num(x.total)}</b><small>${fmtDate(x.date)} ${x.by === 'hq' ? '본사' : '매장'}</small></a>` : '<span class="dash">없음</span>';
    const freq = {};
    for (const x of inMonth) for (const it of deducted(CL[x.type], x)) { const k = x.type + ':' + it.no; freq[k] = (freq[k] || 0) + 1; }
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => { const [t, no] = k.split(':'); return { t, it: CL[t].items.find(i => String(i.no) === no), n }; });
    const todo = [];
    for (const x of list) { const o = openFixes(x); if (o) todo.push({ x, o, late: !!(x.dueDate && x.dueDate < today()) }); }
    todo.sort((a, b) => (b.late - a.late) || (a.x.dueDate || '').localeCompare(b.x.dueDate || ''));
    const avg = t => { const v = STORES.map(st => latest(st.id, t)).filter(Boolean); return v.length ? num(v.reduce((a, b) => a + b.total, 0) / v.length) : '없음'; };
    const [yy, mm] = m.split('-');
    $app.innerHTML = bar('전 매장 취합', '#/') + `<main class="page">
      <label class="fld"><span>월</span><select id="hqM">${months.map(x => { const [a, b] = x.split('-'); return `<option value="${x}" ${x === m ? 'selected' : ''}>${a}년 ${Number(b)}월</option>`; }).join('')}</select></label>
      <div class="sheet kpis">
        <div><small>무드 평균</small><b>${avg('mood')}</b></div><div><small>육부 평균</small><b>${avg('meat')}</b></div>
        <div><small>이달 점검</small><b>${inMonth.length}건</b></div><div><small>남은 조치</small><b>${todo.reduce((a, b) => a + b.o, 0)}건</b></div>
      </div>
      <h2 class="h2">매장별 <small>그달 마지막 점검</small></h2>
      <div class="sheet"><table class="grid"><thead><tr><th>매장</th><th>무드</th><th>육부</th></tr></thead><tbody>
        ${STORES.map(st => `<tr><th scope="row">${esc(st.name)}</th><td>${cell(latest(st.id, 'mood'))}</td><td>${cell(latest(st.id, 'meat'))}</td></tr>`).join('')}
      </tbody></table></div>
      <h2 class="h2">자주 감점된 항목</h2>
      ${top.length ? `<div class="sheet">${top.map(r => `<div class="mini"><span class="mini-t">${esc(r.it.title)}<small>${esc(CL[r.t].name)}</small></span><b>${r.n}곳</b></div>`).join('')}</div>` : '<p class="empty">이달 감점 기록이 없습니다.</p>'}
      <h2 class="h2">조치가 남은 점검</h2>
      ${todo.length ? `<div class="sheet rows">${todo.map(r => `<a class="row" href="#/r/${encodeURIComponent(r.x.id)}">${gradeTile(r.x.total)}
        <span class="row-m"><b>${esc(storeName(r.x.storeId))} ${esc(CL[r.x.type].name)}</b><small><span>${fmtDate(r.x.date)} 점검</span><span>기한 ${fmtDate(r.x.dueDate) || '없음'}</span></small></span>
        <span class="flags"><em class="flag ${r.late ? 'flag-red' : 'flag-wait'}">${r.late ? '기한 지남' : '조치'} ${r.o}건</em></span></a>`).join('')}</div>` : '<p class="empty">남은 조치가 없습니다.</p>'}
      <button class="btn btn-main" id="hqX">${yy}년 ${Number(mm)}월 취합 엑셀 받기</button>
    </main>`;
    document.getElementById('hqM').onchange = e => { sessionStorage.setItem('inspect.hqMonth', e.target.value); renderHq(list); };
    document.getElementById('hqX').onclick = async e => {
      const b = e.target; b.disabled = true; const t = b.textContent; b.textContent = '엑셀 만드는 중';
      try { await window.XLS.monthly(m, inMonth, list); } catch (er) { toast('엑셀을 만들지 못했습니다. ' + er.message); }
      b.disabled = false; b.textContent = t;
    };
  }

  // ---------- 길 찾기 ----------
  async function route() {
    routeSeq++;
    window.scrollTo(0, 0);
    const s = API.session();
    const h = location.hash.replace(/^#\/?/, '').split('/');
    if (!s) return viewLogin();
    if (h[0] === 'check') return viewCheck(h[1], h[2]);
    if (h[0] === 'finish') return viewFinish(h[1], h[2]);
    if (h[0] === 'r') return viewResult(decodeURIComponent(h[1]));
    if (h[0] === 'hq') return viewHq();
    return viewHome();
  }
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); go(g.dataset.go); return; }
    if (e.target.closest('[data-act="logout"]') && confirm('로그아웃할까요? 쓰던 점검은 이 휴대폰에 남아 있습니다.')) { API.logout(); go('#/'); }
  });
  window.addEventListener('hashchange', route);
  window.APP = { CL, itemScore, grade, sections, deducted, storeName, num, downloadBlob, fmtDate };
  route();

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
})();
