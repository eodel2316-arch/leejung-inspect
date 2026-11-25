// 저장소 연결: 구글 앱스 스크립트(API_URL 있음) 또는 시험 모드(이 브라우저의 IndexedDB)
// 구글 저장소는 한 번 부를 때 2~3초가 걸려서, 목록·기록은 휴대폰에 저장본을 두고 먼저 보여 준 뒤 뒤에서 새로 받는다.
(function () {
  const CFG = window.APP_CONFIG;
  const DEMO = !CFG.API_URL;

  // ---- IndexedDB 작은 도우미 ----
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('leejung-inspect', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('photos');
        d.createObjectStore('inspections');
        d.createObjectStore('kv');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function idb(store, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
    });
  }
  const idbGet = (s, k) => idb(s, 'readonly', o => o.get(k));
  const idbPut = (s, k, v) => idb(s, 'readwrite', o => o.put(v, k));
  const idbDel = (s, k) => idb(s, 'readwrite', o => o.delete(k));
  const idbAll = (s) => idb(s, 'readonly', o => o.getAll());

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const blobToDataUrl = b => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });

  // ---- 세션 ----
  function session() {
    try { return JSON.parse(localStorage.getItem('inspect.session') || 'null'); } catch (e) { return null; }
  }
  function setSession(s) {
    if (s) localStorage.setItem('inspect.session', JSON.stringify(s));
    else localStorage.removeItem('inspect.session');
    if (!s) localStorage.removeItem('inspect.list');
  }

  // ---- 휴대폰 저장본(목록) ----
  function cachedList() {
    try { return JSON.parse(localStorage.getItem('inspect.list') || 'null'); } catch (e) { return null; }
  }
  function putCache(list) {
    try { localStorage.setItem('inspect.list', JSON.stringify(list)); } catch (e) { /* 꽉 차면 저장 안 함 */ }
  }
  function upsertCache(x) {
    if (!x) return;
    const l = cachedList() || [];
    const i = l.findIndex(y => y.id === x.id);
    if (i >= 0) l[i] = x; else l.unshift(x);
    putCache(l);
  }

  // ---- 앱스 스크립트 호출 ----
  async function call(action, data) {
    const s = session();
    const body = JSON.stringify(Object.assign({ action, token: s && s.token }, data || {}));
    let r;
    try {
      r = await fetch(CFG.API_URL, { method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
    } catch (e) {
      throw new Error('인터넷에 연결되지 않았습니다. 연결을 확인하고 다시 눌러 주세요.');
    }
    const j = await r.json();
    if (!j.ok) {
      if (j.code === 'AUTH') { setSession(null); setTimeout(() => location.reload(), 1500); }
      throw new Error(j.error || '저장소에서 오류가 났습니다.');
    }
    return j;
  }

  // 같은 사진을 두 번 올리지 않도록 진행 중인 업로드를 기억
  const uploading = new Map();

  const API = {
    DEMO, uid, session,
    logout() { setSession(null); },

    async login(storeId, pw) {
      if (DEMO) {
        const isHq = storeId === 'HQ';
        const ok = isHq ? pw === CFG.DEMO_HQ_PW : pw === CFG.DEMO_STORE_PW;
        if (!ok) throw new Error('비밀번호가 맞지 않습니다.');
        const s = { role: isHq ? 'hq' : 'store', storeId: isHq ? null : storeId, token: 'demo' };
        setSession(s); return s;
      }
      const j = await call('login', { storeId, pw });
      const s = { role: j.role, storeId: j.storeId, token: j.token };
      setSession(s);
      API.list().catch(() => {}); // 목록을 미리 받아 둠
      return s;
    },

    // 초안(휴대폰 안)
    saveDraft: (key, d) => idbPut('kv', 'draft:' + key, d),
    loadDraft: key => idbGet('kv', 'draft:' + key),
    deleteDraft: key => idbDel('kv', 'draft:' + key),
    async putLocalPhoto(blob) { const id = 'l:' + uid(); await idbPut('photos', id, blob); return id; },
    async deleteLocalPhoto(id) { if (id && id.startsWith('l:')) await idbDel('photos', id); },

    async photoUrl(ref) {
      if (!ref) return '';
      if (ref.startsWith('g:')) return 'https://drive.google.com/thumbnail?id=' + ref.slice(2) + '&sz=w1200';
      const b = await idbGet('photos', ref);
      return b ? URL.createObjectURL(b) : '';
    },
    async photoBlob(ref) {
      if (!ref) return null;
      if (ref.startsWith('g:')) { const j = await call('getPhoto', { fileId: ref.slice(2) }); return (await fetch(j.dataUrl)).blob(); }
      return idbGet('photos', ref);
    },

    // 휴대폰 사진(l:)을 저장소로 올리고 저장소 참조를 돌려줌. 같은 사진을 동시에 두 번 부르면 한 번만 올림.
    uploadPhoto(ref, meta) {
      if (!ref || !ref.startsWith('l:')) return Promise.resolve(ref);
      if (uploading.has(ref)) return uploading.get(ref);
      const p = (async () => {
        const b = await idbGet('photos', ref);
        if (DEMO) { const id = 'p:' + uid(); await idbPut('photos', id, b); return id; }
        const j = await call('uploadPhoto', Object.assign({ dataUrl: await blobToDataUrl(b) }, meta || {}));
        return 'g:' + j.fileId;
      })();
      uploading.set(ref, p);
      p.catch(() => uploading.delete(ref));
      return p;
    },

    async submit(insp) {
      if (DEMO) await idbPut('inspections', insp.id, insp);
      else insp = (await call('submit', { inspection: insp })).inspection;
      upsertCache(insp);
      return insp;
    },

    cachedList,
    // 저장소에서 새로 받음(받은 것은 저장본으로)
    async list() {
      let all;
      if (DEMO) {
        const s = session();
        all = await idbAll('inspections');
        if (s && s.role === 'store') all = all.filter(x => x.storeId === s.storeId);
      } else all = (await call('list', {})).inspections;
      all.sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
      putCache(all);
      return all;
    },
    cachedGet: id => (cachedList() || []).find(x => x.id === id) || null,
    async get(id) {
      const x = DEMO ? await idbGet('inspections', id) : (await call('get', { id })).inspection;
      upsertCache(x);
      return x;
    },

    async confirm(id, name) {
      let x;
      if (DEMO) {
        x = await idbGet('inspections', id);
        x.confirmedAt = new Date().toISOString(); x.confirmedBy = name;
        await idbPut('inspections', id, x);
      } else x = (await call('confirm', { id, name })).inspection;
      upsertCache(x); return x;
    },

    async fix(id, no, fix) {
      let x;
      if (DEMO) {
        x = await idbGet('inspections', id);
        x.items[no].fix = fix;
        await idbPut('inspections', id, x);
      } else x = (await call('fix', { id, no, fix })).inspection;
      upsertCache(x); return x;
    },

    async remove(id) {
      if (DEMO) await idbDel('inspections', id); else await call('delete', { id });
      putCache((cachedList() || []).filter(x => x.id !== id));
    }
  };

  window.API = API;
})();
