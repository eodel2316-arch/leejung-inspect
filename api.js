// 저장소 연결: 구글 앱스 스크립트(API_URL 있음) 또는 시험 모드(이 브라우저의 IndexedDB)
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
        d.createObjectStore('photos');       // 사진(초안·시험 모드)
        d.createObjectStore('inspections');  // 시험 모드 점검 기록
        d.createObjectStore('kv');           // 초안 등
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

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function blobToDataUrl(b) {
    return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
  }

  // ---- 세션 ----
  function session() {
    try { return JSON.parse(localStorage.getItem('inspect.session') || 'null'); } catch (e) { return null; }
  }
  function setSession(s) {
    if (s) localStorage.setItem('inspect.session', JSON.stringify(s));
    else localStorage.removeItem('inspect.session');
  }

  // ---- 앱스 스크립트 호출 ----
  async function call(action, data) {
    const s = session();
    const body = JSON.stringify(Object.assign({ action, token: s && s.token }, data || {}));
    let r;
    try {
      r = await fetch(CFG.API_URL, { method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
    } catch (e) {
      throw new Error('인터넷 연결을 확인해 주세요.');
    }
    const j = await r.json();
    if (!j.ok) {
      if (j.code === 'AUTH') setSession(null);
      throw new Error(j.error || '저장소 오류');
    }
    return j;
  }

  // ---- 공개 함수 ----
  const API = {
    DEMO,
    uid,
    session,
    logout() { setSession(null); },

    async login(storeId, pw) {
      if (DEMO) {
        const isHq = storeId === 'HQ';
        const ok = isHq ? pw === CFG.DEMO_HQ_PW : pw === CFG.DEMO_STORE_PW;
        if (!ok) throw new Error('비밀번호가 맞지 않습니다.');
        const s = { role: isHq ? 'hq' : 'store', storeId: isHq ? null : storeId, token: 'demo' };
        setSession(s);
        return s;
      }
      const j = await call('login', { storeId, pw });
      const s = { role: j.role, storeId: j.storeId, token: j.token };
      setSession(s);
      return s;
    },

    // 초안 저장(휴대폰 안)
    async saveDraft(key, draft) { await idbPut('kv', 'draft:' + key, draft); },
    async loadDraft(key) { return idbGet('kv', 'draft:' + key); },
    async deleteDraft(key) { await idbDel('kv', 'draft:' + key); },
    async putLocalPhoto(blob) { const id = 'l:' + uid(); await idbPut('photos', id, blob); return id; },
    async deleteLocalPhoto(id) { if (id && id.startsWith('l:')) await idbDel('photos', id); },

    // 사진 주소(화면 표시용)
    async photoUrl(ref) {
      if (!ref) return '';
      if (ref.startsWith('g:')) return 'https://drive.google.com/thumbnail?id=' + ref.slice(2) + '&sz=w1200';
      const b = await idbGet('photos', ref);
      return b ? URL.createObjectURL(b) : '';
    },
    async photoBlob(ref) {
      if (!ref) return null;
      if (ref.startsWith('g:')) {
        const j = await call('getPhoto', { fileId: ref.slice(2) });
        const r = await fetch(j.dataUrl); return r.blob();
      }
      return idbGet('photos', ref);
    },

    // 휴대폰 사진(l:)을 저장소로 올리고 저장소 참조로 바꿈
    async uploadPhoto(ref, meta) {
      if (!ref || !ref.startsWith('l:')) return ref;
      if (DEMO) { // 시험 모드: 그대로 두되 이름만 'p:'로
        const b = await idbGet('photos', ref);
        const id = 'p:' + uid();
        await idbPut('photos', id, b);
        return id;
      }
      const b = await idbGet('photos', ref);
      const dataUrl = await blobToDataUrl(b);
      const j = await call('uploadPhoto', Object.assign({ dataUrl }, meta || {}));
      return 'g:' + j.fileId;
    },

    async submit(insp) {
      if (DEMO) { await idbPut('inspections', insp.id, insp); return insp; }
      const j = await call('submit', { inspection: insp });
      return j.inspection;
    },

    async list() {
      if (DEMO) {
        const s = session();
        let all = await idbAll('inspections');
        if (s && s.role === 'store') all = all.filter(x => x.storeId === s.storeId);
        return all.sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
      }
      const j = await call('list', {});
      return j.inspections;
    },

    async get(id) {
      if (DEMO) return idbGet('inspections', id);
      const j = await call('get', { id });
      return j.inspection;
    },

    async confirm(id, name) {
      if (DEMO) {
        const x = await idbGet('inspections', id);
        x.confirmedAt = new Date().toISOString(); x.confirmedBy = name;
        await idbPut('inspections', id, x); return x;
      }
      const j = await call('confirm', { id, name });
      return j.inspection;
    },

    // 본사만: 잘못 제출한 점검 지우기
    async remove(id) {
      if (DEMO) { await idbDel('inspections', id); return; }
      await call('delete', { id });
    },

    // 감점 항목 조치 완료(조치 후 사진·메모)
    async fix(id, no, fix) {
      if (DEMO) {
        const x = await idbGet('inspections', id);
        x.items[no].fix = fix;
        await idbPut('inspections', id, x); return x;
      }
      const j = await call('fix', { id, no, fix });
      return j.inspection;
    }
  };

  window.API = API;
})();
