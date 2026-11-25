// 이정그룹 매장 점검 앱 (무드·육부)
(function () {
  const CFG = window.APP_CONFIG;
  const CL = window.CHECKLISTS;
  const $app = document.getElementById('app');
  const STORES = CFG.STORES;
  const storeName = id => (STORES.find(s => s.id === id) || {}).name || id;

  // ---------- 작은 도우미 ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const fmtDate = iso => iso ? iso.slice(0, 10).replace(/-/g, '.') : '';
  const fmtTime = iso => { if (!iso) return ''; const d = new Date(iso); return fmtDate(d.toISOString().slice(0, 10)) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const num = n => (Math.round(n * 10) / 10).toString();
  function toast(msg) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'show';
    clearTimeout(t._h); t._h = setTimeout(() => { t.className = ''; }, 2600);
  }
  function go(h) { if (location.hash === h) route(); else location.hash = h; }

  // ---------- 점수 계산 ----------
  function itemScore(cl, it, st) {
    if (!st || !st.done) return null;
    if (cl.scoring === 'deduct') return Math.max(0, it.max - (st.light || 0) - 3 * (st.big || 0));
    if (st.level === 'full') return it.max;
    if (st.level === 'half') return it.max / 2;
    if (st.level === 'zero') return 0;
    return null;
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
      for (const it of sec.items) {
        const sc = itemScore(cl, it, items[it.no]);
        if (sc != null) { sub += sc; done++; }
      }
      subs[sec.name] = sub; total += sub;
    }
    const critical = cl.scoring === 'level'
      ? cl.items.filter(it => it.level === '상' && itemScore(cl, it, items[it.no]) === 0).map(it => it.no) : [];
    return { total, done, count: cl.items.length, subs, critical, grade: grade(total) };
  }
  function deducted(cl, insp) {
    // 제출된 기록은 항목마다 score 가 저장돼 있다
    return cl.items.filter(it => { const v = insp.items[it.no]; return v && v.score != null && v.score < it.max; });
  }
  function openFixes(insp) {
    const cl = CL[insp.type];
    return deducted(cl, insp).filter(it => !(insp.items[it.no].fix)).length;
  }

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
        for (const f of inp.files) { const b = await compress(f); ids.push(await API.putLocalPhoto(b)); }
        res(ids);
      };
      inp.click();
    });
  }
  async function fillPhotos(root) {
    for (const el of (root || document).querySelectorAll('img[data-ref]')) {
      if (el.src) continue;
      el.src = await API.photoUrl(el.dataset.ref);
    }
  }
  function photoStrip(refs, removable) {
    if (!refs || !refs.length) return '';
    return '<div class="photos">' + refs.map(r =>
      `<div class="ph"><img data-ref="${esc(r)}" alt="사진" data-act="zoom">${removable ? `<button class="phx" data-act="delphoto" data-ref="${esc(r)}" aria-label="사진 지우기">×</button>` : ''}</div>`).join('') + '</div>';
  }

  // ---------- 공통 틀 ----------
  function header(title, back) {
    const s = API.session();
    const who = s ? (s.role === 'hq' ? CFG.HQ_NAME : storeName(s.storeId)) : '';
    return `<header class="top">
      ${back ? `<button class="back" data-go="${esc(back)}" aria-label="뒤로">‹</button>` : '<span class="logo">LJ</span>'}
      <div class="ttl"><b>${esc(title)}</b>${who ? `<small>${esc(who)}</small>` : ''}</div>
      ${s ? '<button class="ghost sm" data-act="logout">나가기</button>' : ''}
    </header>${API.DEMO ? '<div class="demo">시험 모드 · 기록이 이 휴대폰에만 저장됩니다</div>' : ''}`;
  }

  // ---------- 로그인 ----------
  function viewLogin() {
    $app.innerHTML = header(CFG.APP_NAME) + `
      <main class="pad">
        <div class="hero"><div class="mark">LJ</div><h1>매장 점검</h1><p>무드 점검 · 육부 점검</p></div>
        <label class="fld">매장
          <select id="lgStore">
            <option value="">매장을 고르세요</option>
            ${STORES.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
            <option value="HQ">${esc(CFG.HQ_NAME)} (본사)</option>
          </select></label>
        <label class="fld">비밀번호
          <input id="lgPw" type="password" inputmode="numeric" autocomplete="current-password" placeholder="비밀번호"></label>
        <button class="primary block" id="lgBtn">들어가기</button>
        ${API.DEMO ? `<p class="hint">시험 모드 비밀번호: 매장 ${esc(CFG.DEMO_STORE_PW)} · 본사 ${esc(CFG.DEMO_HQ_PW)}</p>` : ''}
      </main>`;
    const last = localStorage.getItem('inspect.lastStore'); if (last) document.getElementById('lgStore').value = last;
    const doLogin = async () => {
      const st = document.getElementById('lgStore').value, pw = document.getElementById('lgPw').value;
      if (!st) return toast('매장을 골라 주세요.');
      const btn = document.getElementById('lgBtn'); btn.disabled = true;
      try { await API.login(st, pw); localStorage.setItem('inspect.lastStore', st); go('#/'); }
      catch (e) { toast(e.message); } finally { btn.disabled = false; }
    };
    document.getElementById('lgBtn').onclick = doLogin;
    document.getElementById('lgPw').onkeydown = e => { if (e.key === 'Enter') doLogin(); };
  }

  // ---------- 첫 화면 ----------
  async function viewHome() {
    const s = API.session(); const hq = s.role === 'hq';
    $app.innerHTML = header(CFG.APP_NAME) + `<main class="pad">
      ${hq ? `<label class="fld">점검할 매장
        <select id="hmStore">${STORES.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>` : ''}
      <div class="starts">
        <button class="start mood" data-start="mood"><span>무드 점검</span><small>24개 항목 · 100점</small></button>
        <button class="start meat" data-start="meat"><span>육부 점검</span><small>22개 항목 · 100점</small></button>
      </div>
      ${hq ? '<button class="secondary block" data-go="#/hq">전 매장 취합 보기</button>' : ''}
      <h2>최근 점검</h2><div id="recent" class="list"><p class="muted">불러오는 중…</p></div>
    </main>`;
    const sel = document.getElementById('hmStore');
    if (sel) { const l = localStorage.getItem('inspect.hqStore'); if (l) sel.value = l; sel.onchange = () => localStorage.setItem('inspect.hqStore', sel.value); }
    $app.querySelectorAll('[data-start]').forEach(b => b.onclick = () => {
      const storeId = hq ? sel.value : s.storeId;
      go('#/check/' + b.dataset.start + '/' + storeId);
    });
    try {
      const list = await API.list();
      const box = document.getElementById('recent'); if (!box) return; // 그사이 다른 화면으로 옮김
      box.innerHTML = list.length ? list.slice(0, hq ? 30 : 20).map(rowCard).join('') : '<p class="muted">아직 점검 기록이 없습니다.</p>';
    } catch (e) { const box = document.getElementById('recent'); if (box) box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }
  function rowCard(x) {
    const g = grade(x.total).g; const open = openFixes(x);
    return `<a class="row" href="#/r/${esc(x.id)}">
      <span class="gr g${g}">${g}</span>
      <span class="rmain"><b>${esc(CL[x.type].name)} · ${esc(storeName(x.storeId))}</b>
        <small>${fmtDate(x.date)} · ${x.by === 'hq' ? '본사 점검' : '매장 점검'} · ${esc(x.inspector)}</small></span>
      <span class="rside"><b>${num(x.total)}점</b>
        <small>${x.confirmedAt ? '' : '<em class="tag warn">확인 대기</em>'}${open ? `<em class="tag red">조치 ${open}</em>` : ''}</small></span>
    </a>`;
  }

  // ---------- 점검 화면 ----------
  let D = null; // 지금 쓰는 초안
  let saveTimer = null;
  function saveSoon() { clearTimeout(saveTimer); const d = D; saveTimer = setTimeout(() => { if (d && d === D) API.saveDraft(d.key, d); }, 300); }

  async function viewCheck(type, storeId) {
    const s = API.session();
    if (s.role === 'store' && storeId !== s.storeId) return go('#/');
    const cl = CL[type]; const key = storeId + ':' + type;
    D = await API.loadDraft(key);
    if (!D) D = { key, type, storeId, by: s.role === 'hq' ? 'hq' : 'store', date: today(), items: {}, inspector: localStorage.getItem('inspect.inspector') || '', notes: '', dueDate: '', startedAt: new Date().toISOString() };
    const secs = sections(cl);
    $app.innerHTML = header(cl.name + ' · ' + storeName(storeId), '#/') + `
      <div class="scorebar" id="sbar"></div>
      <main class="pad check">
        <details class="rules"><summary>채점 방법</summary><ul>${cl.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul></details>
        ${secs.map((sec, i) => `<section class="sec" id="sec${i}">
          <h3 class="sech"><span>${esc(sec.name)}</span><small id="sub${i}"></small></h3>
          ${sec.items.map(it => `<div class="item" id="it${it.no}"></div>`).join('')}
        </section>`).join('')}
        <button class="primary block" id="toFinish">다 했어요 · 마무리</button>
        <button class="ghost block danger" id="discard">이 점검 지우고 처음부터</button>
      </main>`;
    for (const it of cl.items) renderItem(cl, it);
    renderBar(cl);
    document.getElementById('toFinish').onclick = async () => {
      clearTimeout(saveTimer); await API.saveDraft(D.key, D); // 저장 대기 중인 것 먼저 저장
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
      await API.deleteDraft(key); D = null; go('#/');
    };
    $app.querySelector('main').addEventListener('click', e => onItemClick(e, cl));
    $app.querySelector('main').addEventListener('input', e => {
      const no = e.target.dataset.note; if (!no) return;
      st(no).note = e.target.value; saveSoon();
    });
  }
  function st(no) { return D.items[no] || (D.items[no] = { done: false, light: 0, big: 0, level: null, note: '', photos: [] }); }

  function renderBar(cl) {
    const sm = summarize(cl, D.items);
    const pct = Math.round(sm.done / sm.count * 100);
    document.getElementById('sbar').innerHTML = `
      <div class="sb-l"><b>${sm.done}</b> / ${sm.count} 항목</div>
      <div class="sb-m"><div class="prog"><i style="width:${pct}%"></i></div></div>
      <div class="sb-r"><b>${num(sm.total)}</b>점 ${sm.done === sm.count ? `<span class="gr sm g${sm.grade.g}">${sm.grade.g}</span>` : ''}</div>`;
    sections(cl).forEach((sec, i) => {
      const done = sec.items.filter(it => itemScore(cl, it, D.items[it.no]) != null).length;
      document.getElementById('sub' + i).textContent = `${num(sm.subs[sec.name])} / ${sec.max}점 · ${done}/${sec.items.length}`;
    });
  }

  function renderItem(cl, it) {
    const s = D.items[it.no] || {};
    const sc = itemScore(cl, it, s);
    const el = document.getElementById('it' + it.no);
    el.className = 'item' + (sc == null ? '' : sc === it.max ? ' ok' : sc === 0 ? ' bad' : ' part');
    let ctrl = '';
    if (cl.scoring === 'deduct') {
      ctrl = `<div class="btns three">
          <button class="opt ${s.done && !s.light && !s.big ? 'on ok' : ''}" data-act="good" data-no="${it.no}">문제 없음</button>
          <button class="opt ${s.light ? 'on part' : ''}" data-act="light" data-no="${it.no}">가벼운 문제 −1${s.light ? ` <b>×${s.light}</b>` : ''}</button>
          <button class="opt ${s.big ? 'on bad' : ''}" data-act="big" data-no="${it.no}">큰 문제 −3${s.big ? ` <b>×${s.big}</b>` : ''}</button>
        </div>
        ${(s.light || s.big) ? `<button class="link" data-act="undo" data-no="${it.no}">감점 하나 취소</button>` : ''}
        <div class="ex"><span><i class="dot part"></i>${esc(it.light)}</span><span><i class="dot bad"></i>${esc(it.big)}</span></div>`;
    } else {
      ctrl = `<div class="btns three">
          <button class="opt ${s.level === 'full' ? 'on ok' : ''}" data-act="lv" data-lv="full" data-no="${it.no}">잘 지켜짐<small>${it.max}점</small></button>
          <button class="opt ${s.level === 'half' ? 'on part' : ''}" data-act="lv" data-lv="half" data-no="${it.no}">일부만<small>${num(it.max / 2)}점</small></button>
          <button class="opt ${s.level === 'zero' ? 'on bad' : ''}" data-act="lv" data-lv="zero" data-no="${it.no}">안 지켜짐<small>0점</small></button>
        </div>
        ${it.level === '상' && s.level === 'zero' ? '<p class="alert">중요도 상 항목 0점 · 오늘 바로 고치고 재교육</p>' : ''}`;
    }
    const lvTag = it.level ? `<em class="lv lv${it.level === '상' ? 'h' : it.level === '중' ? 'm' : 'l'}">${esc(it.level)}</em>` : '';
    el.innerHTML = `
      <div class="ih"><span class="no">${it.no}</span><b>${esc(it.title)}</b>${lvTag}<span class="pts">${sc == null ? '' : num(sc) + ' / '}${it.max}점</span></div>
      <p class="q">${esc(it.question)}</p>
      ${ctrl}
      ${photoStrip(s.photos, true)}
      <div class="tools">
        <button class="ghost sm" data-act="photo" data-no="${it.no}">📷 사진${s.photos && s.photos.length ? ' ' + s.photos.length : ''}</button>
        <input class="note" data-note="${it.no}" placeholder="비고" value="${esc(s.note || '')}">
      </div>`;
    fillPhotos(el);
  }

  async function onItemClick(e, cl) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'zoom') return zoom(b.src);
    const no = b.dataset.no || (b.closest('.item') && b.closest('.item').id.slice(2));
    if (!no) return;
    const it = cl.items.find(x => String(x.no) === String(no)); const s = st(no);
    if (act === 'good') { s.done = true; s.light = 0; s.big = 0; }
    else if (act === 'light') { s.done = true; s.light = (s.light || 0) + 1; }
    else if (act === 'big') { s.done = true; s.big = (s.big || 0) + 1; }
    else if (act === 'undo') { if (s.big) s.big--; else if (s.light) s.light--; }
    else if (act === 'lv') { s.done = true; s.level = b.dataset.lv; }
    else if (act === 'photo') { const ids = await pickPhotos(); s.photos = (s.photos || []).concat(ids); }
    else if (act === 'delphoto') { if (!confirm('이 사진을 뺄까요?')) return; s.photos = s.photos.filter(p => p !== b.dataset.ref); await API.deleteLocalPhoto(b.dataset.ref); }
    if (cl.scoring === 'deduct' && it.max - (s.light || 0) - 3 * (s.big || 0) < 0 && (act === 'light' || act === 'big')) toast('이미 0점입니다(0점 아래로는 안 내려가요).');
    renderItem(cl, it); renderBar(cl); saveSoon();
  }

  function zoom(src) {
    const z = document.createElement('div'); z.className = 'zoom'; z.innerHTML = `<img src="${src}" alt="">`;
    z.onclick = () => z.remove(); document.body.appendChild(z);
  }

  // ---------- 마무리·제출 ----------
  async function viewFinish(type, storeId) {
    const cl = CL[type]; const key = storeId + ':' + type;
    D = await API.loadDraft(key); if (!D) return go('#/');
    const sm = summarize(cl, D.items);
    const ded = cl.items.filter(it => { const sc = itemScore(cl, it, D.items[it.no]); return sc != null && sc < it.max; });
    $app.innerHTML = header('마무리 · ' + storeName(storeId), '#/check/' + type + '/' + storeId) + `<main class="pad">
      <div class="bigscore"><span class="gr xl g${sm.grade.g}">${sm.grade.g}</span><div><b>${num(sm.total)}점</b><small>${esc(sm.grade.label)} · 감점 항목 ${ded.length}개</small></div></div>
      ${sm.critical.length ? `<p class="alert">중요도 '상' 0점 항목 ${sm.critical.length}개 — 오늘 바로 조치가 필요합니다.</p>` : ''}
      <label class="fld">점검일<input id="fDate" type="date" value="${esc(D.date)}"></label>
      <label class="fld">점검자 이름<input id="fName" value="${esc(D.inspector)}" placeholder="예: 홍길동"></label>
      <div class="fld">점검 구분<div class="seg">
        <button class="${D.by === 'hq' ? 'on' : ''}" data-by="hq">본사 점검</button>
        <button class="${D.by === 'store' ? 'on' : ''}" data-by="store">매장 자체 점검</button></div></div>
      <label class="fld">특이사항<textarea id="fNotes" rows="4" placeholder="특이사항, 조치할 내용">${esc(D.notes)}</textarea></label>
      <label class="fld">조치 기한<input id="fDue" type="date" value="${esc(D.dueDate)}"></label>
      <button class="primary block" id="fSubmit">제출하기</button>
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
      try { const id = await submitDraft(cl, sm, btn); toast('제출했습니다.'); go('#/r/' + id); }
      catch (e) { toast(e.message); btn.disabled = false; btn.textContent = '제출하기'; }
    };
  }

  async function submitDraft(cl, sm, btn) {
    const id = D.type + '-' + D.date.replace(/-/g, '') + '-' + D.storeId + '-' + API.uid().slice(-4);
    const items = {};
    let n = 0; const all = Object.values(D.items).reduce((a, s) => a + (s.photos || []).length, 0);
    for (const it of cl.items) {
      const s = D.items[it.no];
      const photos = [];
      for (const p of (s.photos || [])) {
        n++; btn.textContent = `사진 올리는 중 ${n}/${all}`;
        photos.push(await API.uploadPhoto(p, { inspectionId: id, storeId: D.storeId, no: it.no, kind: 'before' }));
      }
      items[it.no] = { score: itemScore(cl, it, s), light: s.light || 0, big: s.big || 0, level: s.level || null, note: s.note || '', photos };
    }
    btn.textContent = '저장하는 중…';
    const insp = {
      id, type: D.type, storeId: D.storeId, storeName: storeName(D.storeId), by: D.by, date: D.date,
      inspector: D.inspector, notes: D.notes, dueDate: D.dueDate, items,
      total: sm.total, grade: sm.grade.g, subs: sm.subs, critical: sm.critical,
      max: Object.fromEntries(cl.items.map(it => [it.no, it.max])),
      titles: Object.fromEntries(cl.items.map(it => [it.no, it.title])),
      startedAt: D.startedAt, submittedAt: new Date().toISOString(), confirmedAt: null, confirmedBy: null
    };
    // 카톡 자동 업로드용 결과 그림
    try {
      const png = await summaryImage(insp);
      const ref = await API.putLocalPhoto(png);
      insp.summaryImage = await API.uploadPhoto(ref, { inspectionId: id, storeId: D.storeId, no: 0, kind: 'summary' });
    } catch (e) { console.warn('결과 그림 실패', e); }
    await API.submit(insp);
    clearTimeout(saveTimer);
    for (const s of Object.values(D.items)) for (const p of (s.photos || [])) await API.deleteLocalPhoto(p);
    await API.deleteDraft(D.key); D = null;
    return id;
  }

  // ---------- 결과 화면 ----------
  async function viewResult(id) {
    $app.innerHTML = header('점검 결과', '#/') + '<main class="pad"><p class="muted">불러오는 중…</p></main>';
    let x; try { x = await API.get(id); } catch (e) { $app.querySelector('main').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    if (!x) { $app.querySelector('main').innerHTML = '<p class="err">기록을 찾을 수 없습니다.</p>'; return; }
    const cl = CL[x.type]; const g = grade(x.total); const secs = sections(cl);
    const ded = deducted(cl, x); const s = API.session();
    const prev = (await API.list().catch(() => [])).filter(y => y.storeId === x.storeId && y.type === x.type && y.id !== x.id && (y.submittedAt || '') < (x.submittedAt || ''))[0];
    const diff = prev ? x.total - prev.total : null;
    $app.innerHTML = header(cl.name + ' 결과', '#/') + `<main class="pad">
      <div class="bigscore"><span class="gr xl g${g.g}">${g.g}</span><div><b>${num(x.total)}점</b>
        <small>${esc(g.label)}${diff != null ? ` · 지난번보다 <em class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '+' : ''}${num(diff)}점</em>` : ''}</small></div></div>
      <div class="meta">${esc(storeName(x.storeId))} · ${fmtDate(x.date)} · ${x.by === 'hq' ? '본사 점검' : '매장 자체 점검'} · 점검자 ${esc(x.inspector)}</div>
      ${x.critical && x.critical.length ? `<p class="alert">중요도 '상' 0점: ${x.critical.map(n => esc(cl.items.find(i => i.no === n).title)).join(', ')} — 오늘 바로 고치고 재교육</p>` : ''}
      <div class="confirm">${x.confirmedAt
        ? `<span class="okmark">✓</span> 점장 확인 ${esc(x.confirmedBy)} · ${fmtTime(x.confirmedAt)}`
        : `<span>점장 확인 전</span><button class="primary sm" data-act="confirm">점장 확인</button>`}</div>
      <h2>구분별 점수</h2>
      <div class="bars">${secs.map(sec => { const v = (x.subs || {})[sec.name] || 0; return `
        <div class="bar"><span>${esc(sec.name)}</span><div class="prog"><i style="width:${v / sec.max * 100}%"></i></div><b>${num(v)}/${sec.max}</b></div>`; }).join('')}</div>
      <h2>감점 항목 ${ded.length}개 ${ded.length ? `<small>조치 ${ded.filter(it => x.items[it.no].fix).length}/${ded.length} · 기한 ${fmtDate(x.dueDate) || '-'}</small>` : ''}</h2>
      <div class="list">${ded.length ? ded.map(it => dedCard(cl, x, it)).join('') : '<p class="muted">감점 항목이 없습니다.</p>'}</div>
      ${x.notes ? `<h2>특이사항</h2><p class="notes">${esc(x.notes)}</p>` : ''}
      <h2>전체 항목</h2>
      <details class="allitems"><summary>${cl.items.length}개 항목 펼쳐 보기</summary>
        ${cl.items.map(it => { const v = x.items[it.no]; return `<div class="mini"><span class="no">${it.no}</span>${esc(it.title)}<b>${num(v.score)}/${it.max}</b>${v.note ? `<small>${esc(v.note)}</small>` : ''}</div>`; }).join('')}
      </details>
      <div class="actions">
        <button class="secondary" data-act="excel">엑셀로 받기</button>
        ${x.summaryImage ? '<button class="secondary" data-act="img">결과 그림 저장</button>' : ''}
      </div>
      ${s.role === 'hq' ? '<button class="ghost block danger" data-act="remove">이 점검 지우기(잘못 제출했을 때)</button>' : ''}
    </main>`;
    fillPhotos($app);
    $app.querySelector('main').onclick = async e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act;
      if (act === 'zoom') return zoom(b.src);
      if (act === 'confirm') {
        const name = prompt('점장님 이름을 적어 주세요.', localStorage.getItem('inspect.manager') || '');
        if (!name) return; localStorage.setItem('inspect.manager', name.trim());
        b.disabled = true;
        try { await API.confirm(x.id, name.trim()); toast('확인했습니다.'); viewResult(x.id); } catch (er) { toast(er.message); b.disabled = false; }
      }
      if (act === 'fix') return fixDialog(x, Number(b.dataset.no));
      if (act === 'remove') {
        if (!confirm('이 점검 기록을 지울까요? 시트에서 빠지고 사진은 드라이브 휴지통으로 갑니다.')) return;
        b.disabled = true;
        try { await API.remove(x.id); toast('지웠습니다.'); go('#/'); } catch (er) { toast(er.message); b.disabled = false; }
      }
      if (act === 'excel') { b.disabled = true; try { await window.XLS.inspection(x); } catch (er) { toast('엑셀 만들기 실패: ' + er.message); } b.disabled = false; }
      if (act === 'img') { const bl = await API.photoBlob(x.summaryImage); downloadBlob(bl, `${storeName(x.storeId)}_${cl.name}_${x.date}.png`); }
    };
  }
  function dedCard(cl, x, it) {
    const v = x.items[it.no]; const f = v.fix;
    const why = cl.scoring === 'deduct' ? [v.light ? `가벼운 문제 ${v.light}` : '', v.big ? `큰 문제 ${v.big}` : ''].filter(Boolean).join(' · ') : (v.level === 'half' ? '일부만 지켜짐' : '안 지켜짐');
    return `<div class="ded ${f ? 'fixed' : ''}">
      <div class="ih"><span class="no">${it.no}</span><b>${esc(it.title)}</b><span class="pts">${num(v.score)} / ${it.max}점</span></div>
      <small class="why">${esc(why)}${v.note ? ' · ' + esc(v.note) : ''}</small>
      <div class="ba">
        <div><small>조치 전</small>${photoStrip(v.photos) || '<p class="muted sm">사진 없음</p>'}</div>
        <div><small>조치 후</small>${f ? photoStrip(f.photos) + `<p class="sm">${esc(f.note || '')}<br><span class="muted">${esc(f.by || '')} · ${fmtTime(f.at)}</span></p>` : `<button class="primary sm" data-act="fix" data-no="${it.no}">조치 완료 올리기</button>`}</div>
      </div></div>`;
  }
  async function fixDialog(x, no) {
    const cl = CL[x.type]; const it = cl.items.find(i => i.no === no);
    const dlg = document.createElement('div'); dlg.className = 'sheet';
    let photos = [];
    dlg.innerHTML = `<div class="sheet-in"><h3>조치 완료 · ${esc(it.title)}</h3>
      <div id="fxPh"></div>
      <button class="secondary block" id="fxAdd">📷 조치 후 사진 넣기</button>
      <label class="fld">조치 내용<textarea id="fxNote" rows="3" placeholder="무엇을 고쳤는지"></textarea></label>
      <label class="fld">조치한 사람<input id="fxBy" value="${esc(localStorage.getItem('inspect.manager') || '')}"></label>
      <div class="actions"><button class="ghost" id="fxCancel">취소</button><button class="primary" id="fxSave">올리기</button></div></div>`;
    document.body.appendChild(dlg);
    const draw = () => { dlg.querySelector('#fxPh').innerHTML = photoStrip(photos); fillPhotos(dlg); };
    dlg.querySelector('#fxAdd').onclick = async () => { photos = photos.concat(await pickPhotos()); draw(); };
    dlg.querySelector('#fxCancel').onclick = async () => { for (const p of photos) await API.deleteLocalPhoto(p); dlg.remove(); };
    dlg.querySelector('#fxSave').onclick = async (e) => {
      const by = dlg.querySelector('#fxBy').value.trim(); const note = dlg.querySelector('#fxNote').value.trim();
      if (!photos.length) return toast('조치 후 사진을 넣어 주세요.');
      if (!by) return toast('조치한 사람 이름을 적어 주세요.');
      e.target.disabled = true; e.target.textContent = '올리는 중…';
      try {
        const up = [];
        for (const p of photos) up.push(await API.uploadPhoto(p, { inspectionId: x.id, storeId: x.storeId, no, kind: 'after' }));
        for (const p of photos) await API.deleteLocalPhoto(p);
        localStorage.setItem('inspect.manager', by);
        await API.fix(x.id, no, { photos: up, note, by, at: new Date().toISOString() });
        dlg.remove(); toast('조치 완료를 올렸습니다.'); viewResult(x.id);
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
    const W = 900, rowH = 46; const H = 330 + secs.length * rowH + 60 + Math.min(ded.length, 10) * 40 + 70;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const t = c.getContext('2d');
    const F = '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif';
    const GC = { A: '#2e7d4f', B: '#2f6db3', C: '#d98a1c', D: '#c8372d' };
    t.fillStyle = '#f6f3ec'; t.fillRect(0, 0, W, H);
    t.fillStyle = '#1f4d3a'; t.fillRect(0, 0, W, 120);
    t.fillStyle = '#d9b968'; t.font = `bold 26px ${F}`; t.fillText('이정그룹 · ' + cl.name, 40, 52);
    t.fillStyle = '#fff'; t.font = `bold 38px ${F}`; t.fillText(storeName(x.storeId), 40, 100);
    t.fillStyle = '#333'; t.font = `24px ${F}`;
    t.fillText(`${fmtDate(x.date)} · ${x.by === 'hq' ? '본사 점검' : '매장 자체 점검'} · 점검자 ${x.inspector}`, 40, 165);
    t.fillStyle = GC[g.g]; t.beginPath(); t.arc(110, 245, 58, 0, Math.PI * 2); t.fill();
    t.fillStyle = '#fff'; t.font = `bold 64px ${F}`; t.textAlign = 'center'; t.fillText(g.g, 110, 268); t.textAlign = 'left';
    t.fillStyle = '#111'; t.font = `bold 60px ${F}`; t.fillText(num(x.total) + '점', 200, 260);
    t.fillStyle = '#555'; t.font = `24px ${F}`; t.fillText(`${g.label} · 감점 항목 ${ded.length}개`, 200, 295);
    let y = 340;
    for (const sec of secs) {
      const v = (x.subs || {})[sec.name] || 0;
      t.fillStyle = '#333'; t.font = `22px ${F}`; t.fillText(sec.name, 40, y + 22);
      t.fillStyle = '#e3ded2'; t.fillRect(260, y + 6, 470, 20);
      t.fillStyle = v === sec.max ? '#2e7d4f' : '#1f4d3a'; t.fillRect(260, y + 6, 470 * v / sec.max, 20);
      t.fillStyle = '#111'; t.font = `bold 22px ${F}`; t.fillText(`${num(v)} / ${sec.max}`, 750, y + 24);
      y += rowH;
    }
    y += 20; t.fillStyle = '#1f4d3a'; t.font = `bold 24px ${F}`; t.fillText(ded.length ? '감점 항목' : '감점 항목 없음', 40, y); y += 14;
    for (const it of ded.slice(0, 10)) {
      const v = x.items[it.no]; y += 40;
      const crit = x.critical && x.critical.includes(it.no);
      t.fillStyle = crit ? '#c8372d' : '#333'; t.font = `22px ${F}`;
      let label = `${it.no}. ${it.title}`; if (label.length > 26) label = label.slice(0, 25) + '…';
      t.fillText(label + (crit ? '  (상·0점)' : ''), 40, y);
      t.fillStyle = '#111'; t.font = `bold 22px ${F}`; t.fillText(`${num(v.score)} / ${it.max}`, 750, y);
    }
    if (ded.length > 10) { y += 40; t.fillStyle = '#777'; t.font = `20px ${F}`; t.fillText(`외 ${ded.length - 10}개`, 40, y); }
    t.fillStyle = '#777'; t.font = `20px ${F}`; t.fillText(x.dueDate ? `조치 기한 ${fmtDate(x.dueDate)}` : '', 40, H - 30);
    return new Promise(res => c.toBlob(res, 'image/png'));
  }

  // ---------- 본사 취합 ----------
  async function viewHq() {
    const s = API.session(); if (s.role !== 'hq') return go('#/');
    $app.innerHTML = header('전 매장 취합', '#/') + '<main class="pad"><p class="muted">불러오는 중…</p></main>';
    let list; try { list = await API.list(); } catch (e) { $app.querySelector('main').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    const months = [...new Set(list.map(x => x.date.slice(0, 7)))].sort().reverse();
    const cur = today().slice(0, 7); if (!months.includes(cur)) months.unshift(cur);
    const m = sessionStorage.getItem('inspect.hqMonth') || months[0];
    const inMonth = list.filter(x => x.date.slice(0, 7) === m);
    const latest = (sid, type) => inMonth.filter(x => x.storeId === sid && x.type === type).sort((a, b) => b.date.localeCompare(a.date) || (b.submittedAt || '').localeCompare(a.submittedAt || ''))[0];
    const cell = x => x ? `<a href="#/r/${esc(x.id)}" class="cellx"><span class="gr sm g${grade(x.total).g}">${grade(x.total).g}</span>${num(x.total)}<small>${fmtDate(x.date).slice(5)} ${x.by === 'hq' ? '본사' : '매장'}</small></a>` : '<span class="muted">-</span>';
    // 자주 감점된 항목
    const freq = {};
    for (const x of inMonth) for (const it of deducted(CL[x.type], x)) { const k = x.type + ':' + it.no; freq[k] = (freq[k] || 0) + 1; }
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => { const [t, no] = k.split(':'); const it = CL[t].items.find(i => String(i.no) === no); return { t, it, n }; });
    // 조치 남은 것
    const todo = [];
    for (const x of list) { const o = openFixes(x); if (o) todo.push({ x, o, late: x.dueDate && x.dueDate < today() }); }
    todo.sort((a, b) => (b.late - a.late) || (a.x.dueDate || '').localeCompare(b.x.dueDate || ''));
    const avg = (t) => { const v = STORES.map(st => latest(st.id, t)).filter(Boolean); return v.length ? num(v.reduce((a, b) => a + b.total, 0) / v.length) : '-'; };
    $app.innerHTML = header('전 매장 취합', '#/') + `<main class="pad">
      <label class="fld">월<select id="hqM">${months.map(x => `<option ${x === m ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <div class="kpis"><div><small>무드 평균</small><b>${avg('mood')}</b></div><div><small>육부 평균</small><b>${avg('meat')}</b></div><div><small>이달 점검</small><b>${inMonth.length}건</b></div><div><small>조치 남음</small><b>${todo.reduce((a, b) => a + b.o, 0)}</b></div></div>
      <h2>매장별 (그달 마지막 점검)</h2>
      <table class="grid"><thead><tr><th>매장</th><th>무드</th><th>육부</th></tr></thead><tbody>
        ${STORES.map(st => `<tr><td>${esc(st.name)}</td><td>${cell(latest(st.id, 'mood'))}</td><td>${cell(latest(st.id, 'meat'))}</td></tr>`).join('')}
      </tbody></table>
      <h2>자주 감점된 항목</h2>
      <div class="list">${top.length ? top.map(r => `<div class="mini"><em class="tag">${esc(CL[r.t].name)}</em>${esc(r.it.title)}<b>${r.n}곳</b></div>`).join('') : '<p class="muted">이달 감점 기록이 없습니다.</p>'}</div>
      <h2>조치 남은 점검</h2>
      <div class="list">${todo.length ? todo.map(r => `<a class="row" href="#/r/${esc(r.x.id)}"><span class="gr g${grade(r.x.total).g}">${grade(r.x.total).g}</span>
        <span class="rmain"><b>${esc(storeName(r.x.storeId))} · ${esc(CL[r.x.type].name)}</b><small>${fmtDate(r.x.date)} · 기한 ${fmtDate(r.x.dueDate) || '-'}</small></span>
        <span class="rside"><em class="tag ${r.late ? 'red' : 'warn'}">${r.late ? '기한 지남' : '조치'} ${r.o}</em></span></a>`).join('') : '<p class="muted">남은 조치가 없습니다.</p>'}</div>
      <div class="actions"><button class="primary" id="hqX">${m} 취합 엑셀 받기</button></div>
    </main>`;
    document.getElementById('hqM').onchange = e => { sessionStorage.setItem('inspect.hqMonth', e.target.value); viewHq(); };
    document.getElementById('hqX').onclick = async e => {
      e.target.disabled = true;
      try { await window.XLS.monthly(m, inMonth, list); } catch (er) { toast('엑셀 만들기 실패: ' + er.message); }
      e.target.disabled = false;
    };
  }

  // ---------- 길 찾기 ----------
  async function route() {
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
    const a = e.target.closest('[data-act="logout"]');
    if (a) { if (confirm('나갈까요? 쓰던 점검은 이 휴대폰에 남아 있습니다.')) { API.logout(); go('#/'); } }
  });
  window.addEventListener('hashchange', route);
  window.APP = { CL, itemScore, grade, sections, deducted, storeName, num, downloadBlob, fmtDate };
  route();

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
})();
