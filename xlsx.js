// 엑셀 내보내기: 점검 1건 = 원본 양식에 채우기, 월 취합 = 새 통합문서
(function () {
  const EXCELJS = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
  let loading = null;
  function load() {
    if (window.ExcelJS) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = EXCELJS; s.onload = res;
      s.onerror = () => { loading = null; rej(new Error('엑셀 도구를 못 불러왔습니다(인터넷 확인)')); };
      document.head.appendChild(s);
    });
    return loading;
  }
  const A = () => window.APP;
  const korDate = d => { const [y, m, dd] = d.split('-'); return `${y}년 ${Number(m)}월 ${Number(dd)}일`; };

  async function save(wb, name) {
    wb.calcProperties = Object.assign({}, wb.calcProperties, { fullCalcOnLoad: true });
    const buf = await wb.xlsx.writeBuffer();
    A().downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
  }

  // 점검 1건 → 원본 점검표 양식 그대로 채운 파일
  async function inspection(x) {
    await load();
    const cl = A().CL[x.type];
    const buf = await (await fetch('templates/' + x.type + '.xlsx')).arrayBuffer();
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    const store = A().storeName(x.storeId);
    ws.getCell('H1').value = '점검일 : ' + korDate(x.date);
    ws.getCell('B3').value = store;
    const who = (x.by === 'hq' ? '본사 ' : '') + x.inspector;
    const mgr = x.confirmedBy || '';
    if (x.type === 'mood') {
      ws.getCell('D3').value = `점검자 : ${who}     점장 : ${mgr}`;
      for (const it of cl.items) {
        const v = x.items[it.no];
        ws.getCell('H' + it.row).value = v.score;
        ws.getCell('J' + it.row).value = noteText(cl, v);
      }
      ws.getCell('A33').value = x.notes || '';
      ws.getCell('A35').value = x.dueDate ? '조치 기한 : ' + korDate(x.dueDate) : '';
    } else {
      ws.getCell('E3').value = `육부장(점검자) : ${who}     점장 : ${mgr}`;
      for (const it of cl.items) {
        const v = x.items[it.no];
        ws.getCell('G' + it.row).value = v.score;
        ws.getCell('I' + it.row).value = noteText(cl, v);
      }
      ws.getCell('A39').value = '특이사항 : ' + (x.notes || '') + (x.dueDate ? '   / 조치 기한 : ' + korDate(x.dueDate) : '');
    }
    await save(wb, `${store}_${cl.name}_${x.date}.xlsx`);
  }
  function noteText(cl, v) {
    const p = [];
    if (cl.scoring === 'deduct') { if (v.light) p.push(`가벼운 문제 ${v.light}`); if (v.big) p.push(`큰 문제 ${v.big}`); }
    if (v.note) p.push(v.note);
    if (v.fix) p.push('조치 완료: ' + (v.fix.note || '') + ' (' + (v.fix.at || '').slice(0, 10) + ')');
    return p.join(' / ');
  }

  // 월 취합 → 매장별·점검목록·항목별 시트
  async function monthly(month, inMonth, all) {
    await load();
    const { CL, grade, sections, deducted, storeName } = A();
    const wb = new ExcelJS.Workbook();
    const head = (ws, cols) => {
      ws.columns = cols;
      const r = ws.getRow(1); r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4D3A' } };
      r.alignment = { vertical: 'middle', horizontal: 'center' }; ws.views = [{ state: 'frozen', ySplit: 1 }];
    };
    const latest = (sid, t) => inMonth.filter(x => x.storeId === sid && x.type === t).sort((a, b) => b.date.localeCompare(a.date))[0];

    const s1 = wb.addWorksheet('매장별');
    head(s1, [{ header: '매장', key: 's', width: 20 },
      { header: '무드 점수', key: 'm', width: 10 }, { header: '무드 등급', key: 'mg', width: 10 }, { header: '무드 점검일', key: 'md', width: 12 }, { header: '무드 구분', key: 'mb', width: 10 },
      { header: '육부 점수', key: 'p', width: 10 }, { header: '육부 등급', key: 'pg', width: 10 }, { header: '육부 점검일', key: 'pd', width: 12 }, { header: '육부 구분', key: 'pb', width: 10 }]);
    for (const st of window.APP_CONFIG.STORES) {
      const m = latest(st.id, 'mood'), p = latest(st.id, 'meat');
      s1.addRow({ s: st.name,
        m: m ? m.total : '', mg: m ? grade(m.total).g : '', md: m ? m.date : '', mb: m ? (m.by === 'hq' ? '본사' : '매장') : '',
        p: p ? p.total : '', pg: p ? grade(p.total).g : '', pd: p ? p.date : '', pb: p ? (p.by === 'hq' ? '본사' : '매장') : '' });
    }

    const s2 = wb.addWorksheet('점검목록');
    const secCols = t => sections(CL[t]).map(s => s.name);
    head(s2, [{ header: '점검일', key: 'd', width: 12 }, { header: '매장', key: 's', width: 20 }, { header: '종류', key: 't', width: 10 },
      { header: '구분', key: 'b', width: 8 }, { header: '점검자', key: 'i', width: 10 }, { header: '총점', key: 'tot', width: 8 }, { header: '등급', key: 'g', width: 6 },
      { header: '점장 확인', key: 'c', width: 18 }, { header: '감점 항목', key: 'n', width: 10 }, { header: '조치 완료', key: 'f', width: 10 },
      { header: '조치 기한', key: 'due', width: 12 }, { header: '구분별 소계', key: 'sub', width: 60 }, { header: '특이사항', key: 'no', width: 40 }]);
    for (const x of inMonth.slice().sort((a, b) => a.date.localeCompare(b.date))) {
      const ded = deducted(CL[x.type], x);
      s2.addRow({ d: x.date, s: storeName(x.storeId), t: CL[x.type].name, b: x.by === 'hq' ? '본사' : '매장', i: x.inspector,
        tot: x.total, g: grade(x.total).g, c: x.confirmedAt ? `${x.confirmedBy} ${x.confirmedAt.slice(0, 10)}` : '확인 전',
        n: ded.length, f: ded.filter(it => x.items[it.no].fix).length, due: x.dueDate || '',
        sub: secCols(x.type).map(k => `${k} ${(x.subs || {})[k]}`).join(' / '), no: x.notes || '' });
    }

    const s3 = wb.addWorksheet('항목별');
    head(s3, [{ header: '점검일', key: 'd', width: 12 }, { header: '매장', key: 's', width: 20 }, { header: '종류', key: 't', width: 10 },
      { header: '구분', key: 'sec', width: 16 }, { header: '번호', key: 'no', width: 6 }, { header: '항목', key: 'it', width: 26 },
      { header: '배점', key: 'max', width: 6 }, { header: '득점', key: 'sc', width: 6 }, { header: '비고', key: 'note', width: 30 },
      { header: '조치 내용', key: 'fx', width: 30 }, { header: '조치일', key: 'fd', width: 12 }]);
    for (const x of inMonth) for (const it of CL[x.type].items) {
      const v = x.items[it.no];
      const row = s3.addRow({ d: x.date, s: storeName(x.storeId), t: CL[x.type].name, sec: it.section, no: it.no, it: it.title,
        max: it.max, sc: v.score, note: v.note || '', fx: v.fix ? v.fix.note : '', fd: v.fix ? (v.fix.at || '').slice(0, 10) : '' });
      if (v.score < it.max) row.getCell('sc').font = { bold: true, color: { argb: 'FFC8372D' } };
    }
    await save(wb, `매장점검_취합_${month}.xlsx`);
  }

  window.XLS = { inspection, monthly };
})();
