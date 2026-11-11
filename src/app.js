(() => {
  const $ = (id) => document.getElementById(id);
  const nf1 = new Intl.NumberFormat('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat('es', { maximumFractionDigits: 0 });
  const dShort = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dLong = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const D = (f) => new Date(f + 'T00:00:00Z');
  const fH = (x) => nf1.format(x) + ' h';
  const fP = (x) => nf1.format(x * 100) + '%';
  const fDur = (m) => (m >= 60 ? nf1.format(m / 60) + ' h' : nf0.format(m) + ' min');
  const el = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'class') e.className = attrs[k]; else if (k === 'text') e.textContent = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]);
    }
    for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  };
  const NS = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs, ...kids) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    for (const c of kids.flat()) if (c != null) e.append(c);
    return e;
  };

  const store = { lines: {}, savedAt: null };

  /* ---------- guardado local (solo comodidad; la página funciona sin él) ---------- */
  const idb = {
    open: () => new Promise((res, rej) => {
      const r = indexedDB.open('tablero-paros', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }),
    async get(k) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
    async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
  };
  const persist = async () => { try { await idb.set('store', JSON.parse(JSON.stringify(store))); } catch (e) { /* sin guardado */ } };
  const restore = async () => { try { const s = await idb.get('store'); if (s && s.lines) { for (const k in s.lines) if (s.lines[k] && s.lines[k].v === 2) store.lines[k] = s.lines[k]; store.savedAt = s.savedAt; return Object.keys(store.lines).length > 0; } } catch (e) { /* vacío */ } return false; };


  /* ---------- guardado en línea (base de datos del artefacto, privada de tu cuenta) ---------- */
  const cloud = { db: null, saving: false };
  const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  /* modo edición: en la versión pública solo el administrador (con sesión) carga reportes */
  const edit = { on: !window.__READONLY };
  function refreshNoData() { $('nodata').hidden = edit.on || !$('app').hidden; }
  function applyEdit() {
    $('btn-load').style.display = edit.on ? '' : 'none';
    $('drop').style.display = edit.on ? '' : 'none';
    const a = $('btn-admin');
    a.hidden = !window.TableroAuth;
    a.textContent = window.__auth && window.__auth.email ? 'Cerrar sesión' : 'Acceso administrador';
    refreshNoData();
  }
  const cloudStatus = (t, bad) => { const e = $('cloud'); e.textContent = t; e.style.color = bad ? 'var(--bad)' : ''; };
  async function pack(obj) {
    const s = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip'));
    const u = new Uint8Array(await new Response(s).arrayBuffer());
    let bin = ''; for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  async function unpack(z) {
    const bin = atob(z), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const s = new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(s).text());
  }
  async function cloudSave(list) {
    if (!cloud.db || !list.length) return;
    cloudStatus('Guardando en línea…');
    try {
      for (const n of list) {
        const z = await pack(store.lines[n]);
        if (z.length > 240000) throw new Error('archivo muy grande');
        await cloud.db.doc('lines/' + slug(n)).set({ name: n, cargado: store.lines[n].cargado, hasta: store.lines[n].hasta, z });
      }
      cloudStatus('Guardado en línea');
    } catch (e) { cloudStatus('No se pudo guardar en línea (' + (e && (e.code || e.message) || 'error') + ')', true); }
  }
  async function cloudStart() {
    if (!(window.claude && window.claude.use)) return;
    let db = null;
    try { db = await window.claude.use('db'); } catch (e) { /* sin base */ }
    if (!db) return;
    cloud.db = db;
    cloudStatus('Sincronizando…');
    db.collection('lines').onSnapshot(async (snap) => {
      let changed = false;
      const remote = new Map();
      for (const d of snap.docs) {
        const v = d.data();
        if (!v || !v.z) continue;
        remote.set(v.name, v.cargado);
        const cur = store.lines[v.name];
        if (cur && cur.cargado >= v.cargado) continue;
        try { const ln = await unpack(v.z); if (ln.v !== 2) continue; store.lines[v.name] = ln; changed = true; } catch (e) { /* doc ilegible */ }
      }
      if (changed) { await persist(); init(false); }
      const up = names().filter((n) => !remote.has(n) || remote.get(n) < store.lines[n].cargado);
      if (edit.on && up.length && !cloud.saving) { cloud.saving = true; await cloudSave(up); cloud.saving = false; }
      else if (!edit.on) {
        cloudStatus(names().length ? '' : 'Aún no hay datos publicados.');
        if (!names().length) $('nodata').textContent = 'Aún no hay datos publicados.';
      } else cloudStatus(remote.size ? 'Sincronizado en línea' : 'Aún no hay datos en línea: carga tus reportes');
    }, () => cloudStatus('Sin conexión a la base en línea', true));
  }

  /* ---------- lectura de archivos ---------- */
  const rng = (a, b) => dShort.format(D(a)) + ' – ' + dShort.format(D(b));
  function lineGrid(head, rows) {
    const g = el('div', { class: 'lt', style: '--cols:' + head.length });
    head.forEach((h) => g.append(el('span', { class: 'lh', text: h })));
    rows.forEach((r) => r.forEach((c, i) => g.append(el('span', { class: i === 0 ? 'ln' : (typeof c === 'object' && c ? 'warn' : 'dt'), text: c ? (typeof c === 'object' ? c.w : c) : '' }))));
    return g;
  }
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  function parseInWorker(buf, loadedAt) {
    return new Promise((resolve, reject) => {
      let w;
      try {
        const src = "importScripts('" + XLSX_URL + "');\n" + $('rules-js').textContent + '\n' + $('core-js').textContent + '\n' +
          "self.onmessage = (e) => { try { const wb = XLSX.read(new Uint8Array(e.data.buf), { type: 'array', sheets: 'Data' }); const ws = wb.Sheets['Data']; if (!ws) throw new Error('No encontré la hoja Data'); const rows = Core.sheetRows(XLSX, ws); self.postMessage({ ok: Core.aggregateRows(rows, e.data.at) }); } catch (err) { self.postMessage({ err: String(err && err.message || err) }); } };";
        w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      } catch (e) { reject(e); return; }
      w.onmessage = (m) => { w.terminate(); m.data.err ? reject(new Error(m.data.err)) : resolve(m.data.ok); };
      w.onerror = (e) => { w.terminate(); reject(new Error('worker')); };
      w.postMessage({ buf: buf.slice(0), at: loadedAt });
    });
  }
  function parseInPage(buf, loadedAt) {
    return new Promise((resolve, reject) => setTimeout(() => {
      try {
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array', sheets: 'Data' });
        const ws = wb.Sheets['Data'];
        if (!ws) throw new Error('No encontré la hoja Data');
        resolve(Core.aggregateRows(Core.sheetRows(XLSX, ws), loadedAt));
      } catch (e) { reject(e); }
    }, 30));
  }

  let busy = false;
  async function handleFiles(list) {
    if (!edit.on) return;
    const files = [...list].filter((f) => /\.xlsx?$/i.test(f.name));
    const ul = $('files');
    if (!files.length) { ul.replaceChildren(el('li', { class: 'err', text: 'Elige archivos Excel (.xlsx) descargados de Atlas.' })); return; }
    if (typeof XLSX === 'undefined') { ul.replaceChildren(el('li', { class: 'err', text: 'No se pudo cargar el lector de Excel. Revisa tu conexión e intenta de nuevo.' })); return; }
    if (busy) return;
    busy = true;
    ul.replaceChildren();
    let any = false;
    const loadedAt = new Date().toISOString();
    const loadedNames = new Set();
    for (const f of files) {
      const li = el('li', { text: 'Leyendo ' + f.name + '…' });
      ul.append(li);
      try {
        const buf = await f.arrayBuffer();
        let out;
        try { out = await parseInWorker(buf, loadedAt); } catch (e) { out = await parseInPage(buf, loadedAt); }
        const names = Object.keys(out);
        if (!names.length) throw new Error('El archivo no trae eventos');
        const gaps = {};
        for (const n of names) {
          const prev = store.lines[n];
          if (prev && prev.v === 2) {
            if (out[n].desde > Core.addDays(prev.hasta, 1)) gaps[n] = dShort.format(D(Core.addDays(prev.hasta, 1))) + ' a ' + dShort.format(D(Core.addDays(out[n].desde, -1)));
            store.lines[n] = Core.mergeLine(prev, out[n]);
          } else store.lines[n] = out[n];
          loadedNames.add(n);
        }
        const anyGap = names.some((n) => gaps[n]);
        li.replaceChildren(el('div', { class: 'fh' }, f.name),
          lineGrid(anyGap ? ['Línea', 'Cargado ahora', 'Total guardado', 'Aviso'] : ['Línea', 'Cargado ahora', 'Total guardado'],
            names.map((n) => [n, rng(out[n].desde, out[n].hasta), rng(store.lines[n].desde, store.lines[n].hasta)].concat(anyGap ? [gaps[n] ? { w: 'Faltan los días ' + gaps[n] } : ''] : []))));
        any = true;
      } catch (e) {
        li.className = 'err';
        li.textContent = f.name + ': ' + (e && e.message ? e.message : 'no se pudo leer');
      }
    }
    busy = false;
    if (any) { store.savedAt = loadedAt; await persist(); init(true); cloudSave([...loadedNames]); }
  }

  /* ---------- estado y utilidades ---------- */
  const TL = { em: 'electromecánico', op: 'operacional', ext: 'externo' };
  const TB = { em: 'Electromecánicas', op: 'Operacionales', ext: 'Externas' };
  const dMonth = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const ev = (n) => nf0.format(n) + (n === 1 ? ' evento' : ' eventos');
  const TABS = { pri: 'Prioridades', ten: 'Tendencia', dia: 'Día a día' };
  const ui = { line: null, s: null, e: null, day: null, ty: { em: true, op: true, ext: false }, tab: 'pri', comp: null, flt: 'all' };
  /* preferencias de quien mira (línea, pestaña y tipos de paro); la página funciona igual sin ellas */
  const PREF = 'tablero-paros:ui';
  const loadPrefs = () => { try { const p = JSON.parse(localStorage.getItem(PREF) || 'null'); if (!p) return; if (p.line) ui.line = p.line; if (p.tab && TABS[p.tab]) ui.tab = p.tab; if (p.ty && (p.ty.em || p.ty.op || p.ty.ext)) ui.ty = { em: !!p.ty.em, op: !!p.ty.op, ext: !!p.ty.ext }; } catch (e) { /* sin preferencias */ } };
  const savePrefs = () => { try { localStorage.setItem(PREF, JSON.stringify({ line: ui.line, tab: ui.tab, ty: ui.ty })); } catch (e) { /* sin preferencias */ } };
  loadPrefs();
  const setLine = (n) => { if (n !== ui.line) ui.comp = null; ui.line = n; renderAll(); };
  const goDay = (f, line) => { if (line && line !== ui.line) { ui.comp = null; ui.line = line; } ui.day = f; ui.tab = 'dia'; hideTip(); renderAll(); document.getElementById('tabs').scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  const tyList = () => ['em', 'op', 'ext'].filter((k) => ui.ty[k]);
  const tyText = () => { const l = tyList().map((k) => TL[k]); return l.length > 1 ? l.slice(0, -1).join(', ') + ' y ' + l[l.length - 1] : l[0]; };
  const isInternal = () => ui.ty.em && ui.ty.op && !ui.ty.ext;
  const dispLabel = () => (isInternal() ? 'Disponibilidad interna' : 'Disponibilidad (tipos elegidos)');
  const nDays = () => Core.span(ui.s, ui.e);
  const LPAL = ['var(--b-blue)', 'var(--b-green)', 'var(--b-purple)', 'var(--b-orange)', 'var(--b-yellow)'];
  const lineColor = (n) => LPAL[Math.max(0, names().indexOf(n)) % LPAL.length];
  const dot = (n) => el('i', { class: 'dot', style: '--lc:' + lineColor(n) });
  const KEEP = /^(L2 Krones|Zegla 30|Zegla 40)$/i; /* solo las líneas de interés */
  const names = () => Object.keys(store.lines).filter((n) => KEEP.test(n)).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  const maxDate = () => names().map((n) => store.lines[n].hasta).sort().pop();
  const minDate = () => names().map((n) => store.lines[n].desde).sort()[0];
  const rangeText = (s, e) => (s === e ? dShort.format(D(s)) : dShort.format(D(s)) + ' – ' + dShort.format(D(e)));
  const bLabel = (b) => (b.u === 'd' ? dLong.format(D(b.s)) : b.u === 'w' ? 'Semana del ' + rangeText(b.s, b.e) : dMonth.format(D(b.s)));
  const unitName = () => { const b = Core.buckets(ui.s, ui.e)[0]; return b.u === 'd' ? 'día' : b.u === 'w' ? 'semana' : 'mes'; };

  function defDay(f) {
    const a = store.lines[ui.line];
    const d = a && Core.dayDetail(a, f, ui.ty);
    return d && d.parcial && f > a.desde ? Core.addDays(f, -1) : f;
  }

  function init(fromLoad) {
    const ns = names();
    if (!ns.length) { $('app').hidden = true; return; }
    $('drop').classList.add('compact');
    $('drop-intro').hidden = true;
    document.querySelector('.priv').hidden = true;
    if (!ui.line || !ns.includes(ui.line)) { ui.line = ns[0]; ui.comp = null; }
    $('asof').textContent = 'Datos hasta el ' + dLong.format(D(maxDate()));
    const mx = maxDate(), mn = minDate();
    if (fromLoad || !ui.e) { ui.e = mx; ui.s = Core.addDays(mx, -6); }
    if (ui.e > mx) ui.e = mx;
    if (ui.s < mn) ui.s = mn;
    if (ui.s > ui.e) ui.s = ui.e;
    if (fromLoad || !ui.day) ui.day = defDay(ui.e);
    if (!$('files').children.length) {
      $('files').replaceChildren(el('li', {}, el('div', { class: 'fh' }, 'Datos guardados'), lineGrid(['Línea', 'Fechas guardadas'], ns.map((n) => [n, rng(store.lines[n].desde, store.lines[n].hasta)]))));
    }
    $('app').hidden = false;
    refreshNoData();
    renderAll();
  }

  function setPeriod(s, e) {
    const mx = maxDate(), mn = minDate();
    if (e > mx) e = mx;
    if (s < mn) s = mn;
    if (s > e) s = e;
    ui.s = s; ui.e = e;
    if (ui.day < s || ui.day > e) ui.day = defDay(e);
    renderAll();
  }

  function renderAll() {
    savePrefs(); renderControls(); renderNotice(); renderKpis(); renderFocus(); renderTabs(); renderPareto(); renderLargos(); renderCompare(); renderBars(); renderHeat(); renderDay();
  }

  function renderControls() {
    const mx = maxDate(), mn = minDate();
    const a = $('d-from'), b = $('d-to');
    a.min = b.min = mn; a.max = b.max = mx;
    if (document.activeElement !== a) a.value = ui.s;
    if (document.activeElement !== b) b.value = ui.e;
    const sp = $('seg-pre'); sp.replaceChildren();
    const first = mx.slice(0, 8) + '01';
    const pre = [['7 días', Core.addDays(mx, -6)], ['30 días', Core.addDays(mx, -29)], ['Este mes', first], ['Todo', mn]];
    for (const [lab, from] of pre) {
      const f = from < mn ? mn : from;
      sp.append(el('button', { type: 'button', 'aria-pressed': String(ui.s === f && ui.e === mx), text: lab, onclick: () => setPeriod(f, mx) }));
    }
    const ch = $('chip-comp'); ch.replaceChildren(); ch.hidden = !ui.comp;
    if (ui.comp) ch.append(el('span', { text: 'Equipo' }), el('button', { type: 'button', class: 'chip on', 'aria-label': 'Quitar filtro de equipo ' + ui.comp, onclick: () => { ui.comp = null; renderAll(); } }, ui.comp, ' ×'));
    const st = $('seg-type'); st.replaceChildren();
    for (const k of ['em', 'op', 'ext']) {
      st.append(el('button', { type: 'button', 'aria-pressed': String(!!ui.ty[k]), text: TB[k], onclick: () => {
        if (ui.ty[k] && tyList().length === 1) return;
        ui.ty[k] = !ui.ty[k]; ui.day = defDay(ui.day > ui.e ? ui.e : ui.day); renderAll();
      } }));
    }
  }
  const onDate = () => {
    const f = $('d-from'), t = $('d-to');
    if (!f.value || !t.value || !f.validity.valid || !t.validity.valid) return;
    let s = f.value, e = t.value;
    if (s > e) { if (document.activeElement === f) e = s; else s = e; }
    setPeriod(s, e);
  };
  $('d-from').addEventListener('change', onDate);
  $('d-to').addEventListener('change', onDate);
  ['d-from', 'd-to'].forEach((id) => $(id).addEventListener('blur', () => { $('d-from').value = ui.s; $('d-to').value = ui.e; }));

  function renderNotice() {
    const n = $('notice');
    const parts = [];
    for (const name of names()) {
      const a = store.lines[name];
      if (a.hasta >= ui.s && a.hasta <= ui.e && Core.dayDetail(a, a.hasta, ui.ty).parcial) parts.push(name);
    }
    if (parts.length) { n.hidden = false; n.textContent = 'El último día cargado tiene datos parciales en ' + parts.join(', ') + ' (el turno sigue en curso o falta el reporte completo); cuenta dentro del periodo.'; }
    else n.hidden = true;
  }

  /* ---------- tarjetas por línea ---------- */
  function deltaEl(diff, goodWhenUp, unit, digits) {
    if (diff == null || !isFinite(diff)) return el('span', { class: 'delta flat', text: 'sin comparación' });
    const abs = Math.abs(diff);
    if (abs < 0.05) return el('span', { class: 'delta flat', text: 'sin cambio' });
    const up = diff > 0;
    return el('span', { class: 'delta ' + (up === goodWhenUp ? 'good' : 'bad'), text: (up ? '+' : '−') + new Intl.NumberFormat('es', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(abs) + unit });
  }
  function renderKpis() {
    const host = $('kpis'); host.replaceChildren();
    const pr = Core.prevRange(ui.s, ui.e);
    const n = nDays();
    const ns = names();
    const lines = el('div', { class: 'kp-lines', style: '--n:' + ns.length, role: 'group', 'aria-label': 'Línea' });
    let anyPrev = false;
    for (const name of ns) {
      const a = store.lines[name];
      const w = Core.sumRange(a, ui.s, ui.e, ui.ty), p = Core.sumRange(a, pr.s, pr.e, ui.ty);
      const noPrev = pr.e < a.desde;
      if (!noPrev) anyPrev = true;
      lines.append(el('button', { type: 'button', class: 'kp-line', style: '--lc:' + lineColor(name), 'aria-pressed': String(name === ui.line), onclick: () => setLine(name) },
        el('span', { class: 'nm' }, dot(name), name),
        el('span', { class: 'v', text: w.disp == null ? '—' : fP(w.disp) }),
        el('span', { class: 's' }, fH(w.sel) + ' de paro', noPrev || w.disp == null || p.disp == null ? null : [' · ', deltaEl((w.disp - p.disp) * 100, true, ' pts', 1)])));
    }
    host.append(lines);
    const a = store.lines[ui.line];
    const w = Core.sumRange(a, ui.s, ui.e, ui.ty), p = Core.sumRange(a, pr.s, pr.e, ui.ty);
    const r = Core.reliability(a, ui.s, ui.e, ui.ty), rp = Core.reliability(a, pr.s, pr.e, ui.ty);
    const largos = Core.largosIn(a, ui.s, ui.e, ui.ty).length, largosP = Core.largosIn(a, pr.s, pr.e, ui.ty).length;
    const noPrev = pr.e < a.desde;
    const cell = (k, v, d) => el('div', {}, el('span', { class: 'k', text: k }), el('span', { class: 'v' }, v), noPrev ? null : el('span', { class: 'd' }, d || '—'));
    const unit = (txt) => { const m = /^(.*?)(\s(?:h|min))$/.exec(txt); return m ? [m[1], el('small', { text: m[2] })] : txt; };
    host.append(el('div', { class: 'kp-det' },
      cell('Horas de paro', unit(fH(w.sel)), deltaEl(w.sel - p.sel, false, ' h', 1)),
      cell('Eventos', nf0.format(r.reg), deltaEl(r.reg - rp.reg, false, '', 0)),
      cell('Paros de 30 min o más', nf0.format(largos), deltaEl(largos - largosP, false, '', 0)),
      cell('Duración media (MTTR)', r.mttr == null ? '—' : unit(fDur(r.mttr)), r.mttr != null && rp.mttr != null ? deltaEl(r.mttr - rp.mttr, false, ' min', 0) : null),
      cell('Tiempo entre paros (MTBF)', r.mtbf == null ? '—' : unit(fH(r.mtbf)), r.mtbf != null && rp.mtbf != null ? deltaEl(r.mtbf - rp.mtbf, true, ' h', 1) : null)));
    $('kp-cap').textContent = 'La cifra grande es la ' + dispLabel().toLowerCase() + ' de cada línea en el periodo. ' +
      (anyPrev ? 'Los cambios comparan con los ' + n + (n === 1 ? ' día previo' : ' días previos') + ' (' + rangeText(pr.s, pr.e) + ').' : 'Aún no hay un periodo previo cargado para comparar.');
  }

  /* ---------- lo importante de la línea ---------- */
  const ATT = { Nuevo: 1, Empeora: 1, Persiste: 1 };
  function focusData() {
    const a = store.lines[ui.line];
    const par = Core.pareto(a, ui.s, ui.e, ui.ty);
    const vital = [];
    for (const r of par.rows) { vital.push(r); if (r.cum >= 0.8) break; }
    const cmp = Core.compare(a, ui.s, ui.e, ui.ty).filter((x) => x.h + x.hp >= 0.5);
    const att = cmp.filter((x) => ATT[x.estado]);
    const largos = Core.largosIn(a, ui.s, ui.e, ui.ty).slice().sort((x, y) => y.min - x.min);
    return { a, par, vital, cmp, att, largos };
  }
  function renderFocus() {
    const f = focusData();
    $('focus-title').replaceChildren(dot(ui.line), 'Paros de ' + ui.line);
    $('focus-sub').textContent = rangeText(ui.s, ui.e) + ' · paro ' + tyText();
    const host = $('focus-body'); host.replaceChildren();
    if (!f.par.rows.length) { host.append('Sin paros de este tipo en el periodo.'); return; }
    const go = (txt, onclick) => el('button', { type: 'button', class: 'go', text: txt, onclick });
    const toTable = (flt) => { ui.tab = 'pri'; ui.flt = flt; renderAll(); $('cmp').scrollIntoView({ block: 'center', behavior: 'smooth' }); };
    const top = f.par.rows[0], nv = f.vital.length;
    host.append(el('b', { text: top.k }), ' concentra el ' + nf0.format(top.pct * 100) + '% del paro: ' + fH(top.h) + ' en ' + ev(top.reg) + '. ');
    if (nv > 1) host.append(nv + ' equipos explican el ' + nf0.format(f.vital[nv - 1].cum * 100) + '%. ');
    if (f.att.length) host.append(go(nf0.format(f.att.length) + (f.att.length === 1 ? ' causa requiere atención' : ' causas requieren atención'), () => toTable('att')), '. ');
    else host.append('Ninguna causa nueva, que empeore o que persista. ');
    const l0 = f.largos[0];
    if (l0) host.append('El paro más largo duró ', go(fDur(l0.min) + ' (' + l0.comp + ', ' + dShort.format(D(l0.f)) + (l0.hora ? ' ' + l0.hora : '') + ')', () => goDay(l0.f)), '.');
  }
  function summaryText() {
    const f = focusData(), a = f.a;
    const w = Core.sumRange(a, ui.s, ui.e, ui.ty), r = Core.reliability(a, ui.s, ui.e, ui.ty);
    const L = [];
    L.push('Paros ' + ui.line + ' · ' + rangeText(ui.s, ui.e) + ' (' + tyText() + ')');
    L.push(dispLabel() + ': ' + (w.disp == null ? '—' : fP(w.disp)) + ' · Paro: ' + fH(w.sel) + ' · Eventos: ' + nf0.format(r.reg) + (r.mttr == null ? '' : ' · MTTR: ' + fDur(r.mttr)) + (r.mtbf == null ? '' : ' · MTBF: ' + fH(r.mtbf)));
    if (f.par.rows.length) {
      L.push('', 'Equipos con más paro:');
      f.par.rows.slice(0, 5).forEach((x, i) => L.push((i + 1) + '. ' + x.k + ': ' + fH(x.h) + ' (' + nf0.format(x.pct * 100) + '%, ' + ev(x.reg) + ')'));
    }
    if (f.att.length) {
      L.push('', 'Requieren atención:');
      f.att.slice(0, 6).forEach((x) => L.push('- ' + x.comp + ' · ' + x.causa + ': ' + fH(x.h) + ' (' + x.estado + ', antes ' + fH(x.hp) + ')' + (x.note ? ' — ' + x.note : '')));
    }
    if (f.largos.length) {
      L.push('', 'Paros de 30 min o más:');
      f.largos.slice(0, 6).forEach((x) => L.push('- ' + dShort.format(D(x.f)) + (x.hora ? ' ' + x.hora : '') + ' · ' + fDur(x.min) + ' · ' + x.comp + (x.note ? ' — ' + x.note : '')));
    }
    return L.join('\n');
  }
  async function copySummary(btn) {
    const txt = summaryText();
    let ok = false;
    try { await navigator.clipboard.writeText(txt); ok = true; } catch (e) {
      try { const ta = el('textarea', { style: 'position:fixed;opacity:0' }); ta.value = txt; document.body.append(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch (e2) { ok = false; }
    }
    const old = btn.textContent; btn.textContent = ok ? 'Copiado' : 'No se pudo copiar';
    setTimeout(() => { btn.textContent = old; }, 1800);
  }
  function downloadCsv() {
    const a = store.lines[ui.line];
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const num = (x) => nf1.format(x).replace(/\./g, '');
    const rows = [['Línea', 'Desde', 'Hasta', 'Equipo', 'Causa', 'Tipo', 'Horas', 'Horas periodo previo', 'Eventos', 'Días con paro', 'Estado', 'Comentario más repetido']];
    for (const x of Core.compare(a, ui.s, ui.e, ui.ty, ui.comp)) rows.push([ui.line, ui.s, ui.e, x.comp, x.causa, TL[x.t], num(x.h), num(x.hp), x.reg, x.dias, x.estado, x.note]);
    const blob = new Blob(['﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const u = URL.createObjectURL(blob);
    const link = el('a', { href: u, download: 'paros-' + slug(ui.line) + '-' + ui.s + '_' + ui.e + '.csv' });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(u), 2000);
  }

  /* ---------- pestañas ---------- */
  function renderTabs() {
    const host = $('tabs'); host.replaceChildren();
    for (const k in TABS) {
      host.append(el('button', { type: 'button', role: 'tab', id: 'tabbtn-' + k, 'aria-selected': String(ui.tab === k), 'aria-controls': 'tab-' + k, text: TABS[k], onclick: () => { ui.tab = k; renderAll(); } }));
      $('tab-' + k).hidden = ui.tab !== k;
    }
  }

  /* ---------- Pareto por equipo (o por causa de un equipo) ---------- */
  function renderPareto() {
    const a = store.lines[ui.line];
    const par = Core.pareto(a, ui.s, ui.e, ui.ty, ui.comp);
    $('par-title').textContent = ui.comp ? 'Causas de ' + ui.comp : 'Pareto por equipo';
    const host = $('par'); host.replaceChildren();
    const sub = $('par-sub');
    if (!par.rows.length) { sub.textContent = ''; host.append(el('div', { class: 'empty', text: 'Sin paros de este tipo en el periodo.' })); return; }
    let nv = 0; for (const r of par.rows) { nv++; if (r.cum >= 0.8) break; }
    sub.textContent = fH(par.tot) + ' de paro en ' + par.rows.length + (ui.comp ? (par.rows.length === 1 ? ' causa.' : ' causas.') : (par.rows.length === 1 ? ' equipo.' : ' equipos.') + ' Toca un equipo para ver sus causas.');
    if (ui.comp) host.append(el('button', { type: 'button', class: 'linklike back', text: '← Todos los equipos', onclick: () => { ui.comp = null; renderAll(); } }));
    const mx = par.rows[0].h;
    host.append(el('div', { class: 'hd' }, el('span', { text: ui.comp ? 'Causa' : 'Equipo' }), el('span', {}), el('span', { text: 'Horas' }), el('span', { text: '% paro' }), el('span', { class: 'x', text: 'Acum.' }), el('span', { class: 'x', text: 'Eventos' })));
    par.rows.slice(0, 12).forEach((r, i) => {
      const kids = [
        el('span', { class: 'nm', text: r.k }),
        el('div', { class: 'track' }, el('div', { class: 'fill' + (i < nv ? '' : ' ext'), style: 'width:' + (100 * r.h / mx).toFixed(1) + '%' })),
        el('span', { class: 'n h', text: nf1.format(r.h) }), el('span', { class: 'n', text: nf0.format(r.pct * 100) + '%' }),
        el('span', { class: 'n x', text: nf0.format(r.cum * 100) + '%' }), el('span', { class: 'n x', text: nf0.format(r.reg) })];
      const cls = 'it' + (i < nv ? '' : ' rest');
      host.append(ui.comp ? el('div', { class: cls }, kids) : el('button', { type: 'button', class: cls + ' pick', 'aria-label': r.k + ': ' + fH(r.h) + ', ver sus causas', onclick: () => { ui.comp = r.k; renderAll(); } }, kids));
      if (i === nv - 1 && par.rows.length > nv) host.append(el('div', { class: 'cut', text: 'Hasta aquí, el ' + nf0.format(r.cum * 100) + '% del paro' }));
    });
    if (par.rows.length > 12) host.append(el('div', { class: 'small muted', style: 'padding:8px', text: 'Y ' + (par.rows.length - 12) + ' más con menos horas.' }));
  }

  /* ---------- paros más largos del periodo ---------- */
  function renderLargos() {
    const a = store.lines[ui.line];
    const list = Core.largosIn(a, ui.s, ui.e, ui.ty).filter((x) => !ui.comp || x.comp === ui.comp).sort((x, y) => y.min - x.min);
    $('lar-sub').textContent = list.length ? nf0.format(list.length) + ' de 30 min o más' + (ui.comp ? ' en ' + ui.comp : '') + '. Toca uno para ver ese día.' : '';
    const host = $('lar'); host.replaceChildren();
    if (!list.length) { host.append(el('div', { class: 'empty', text: 'No hubo paros de 30 min o más en el periodo.' })); return; }
    for (const x of list.slice(0, 8)) host.append(el('button', { type: 'button', class: 'l pick', onclick: () => goDay(x.f) },
      el('span', { class: 'num dur', text: fDur(x.min) }), el('span', { class: 'num muted', text: dShort.format(D(x.f)) + (x.hora ? ' ' + x.hora : '') }), el('span', { class: 'what', text: x.comp + ' · ' + x.causa }),
      el('span', { class: 'nt', text: x.note || 'Sin comentario en Atlas' })));
  }

  /* ---------- tooltip ---------- */
  const tip = $('tip');
  const root = document.querySelector('.pz');
  function showTip(ev, lines) {
    tip.replaceChildren(...lines.map((l, i) => el('div', { class: i ? '' : 'muted' }, l)));
    tip.hidden = false;
    const r = root.getBoundingClientRect();
    let x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 14;
    const tw = tip.offsetWidth;
    if (x + tw > r.width) x = Math.max(0, ev.clientX - r.left - tw - 14);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  const hideTip = () => { tip.hidden = true; };

  /* ---------- barras ---------- */
  function renderBars() {
    const host = $('bars'); host.replaceChildren();
    const n = nDays();
    const ds = n < 14 ? Core.addDays(ui.e, -13) : ui.s;
    const bs = Core.buckets(ds, ui.e);
    const u = bs[0].u;
    $('bars-title').textContent = 'Horas de paro por ' + (u === 'd' ? 'día' : u === 'w' ? 'semana' : 'mes');
    $('bars-sub').textContent = 'Paro ' + tyText() + ', ' + rangeText(ui.s, ui.e) + (n < 14 ? ' (se muestran 14 días para dar contexto)' : '') + '.' + (u === 'd' ? ' Toca un día para ver su detalle.' : ' Toca una barra para ver el primer día de ese tramo.');
    $('leg-in').textContent = 'Dentro del periodo';
    $('leg-out').hidden = n >= 14;
    $('leg-avg').hidden = u !== 'd';
    let ymax = 2;
    const sets = names().map((nm) => ({ n: nm, a: store.lines[nm], d: Core.series(store.lines[nm], bs, ui.ty) }));
    for (const s of sets) for (const d of s.d) if (d.h != null && d.h > ymax) ymax = d.h;
    ymax = Math.ceil(ymax / 2) * 2;
    for (const s of sets) {
      const box = el('div', {});
      const tot = Core.sumRange(s.a, ui.s, ui.e, ui.ty);
      box.append(el('h3', {}, el('span', { class: s.n === ui.line ? 'cur' : '' }, dot(s.n), s.n), el('span', { class: 'num muted small', text: fH(tot.sel) + ' en el periodo' })));
      const wrap = el('div', {});
      box.append(wrap); host.append(box);
      drawBars(wrap, s, ymax, bs);
    }
  }
  function drawBars(wrap, s, ymax, bs) {
    const N = bs.length, daily = bs[0].u === 'd';
    const W = 400, H = 160, ml = 26, mr = 4, mt = 8, mb = 22;
    const iw = W - ml - mr, ih = H - mt - mb, step = iw / N, bw = Math.max(1.2, step - (step > 6 ? 1.6 : 0.6));
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Horas de paro de ' + s.n });
    for (const t of [0, ymax / 2, ymax]) {
      const y = mt + ih * (1 - t / ymax);
      svg.append(sv('line', { x1: ml, x2: W - mr, y1: y, y2: y, stroke: 'var(--line)', 'stroke-width': 1 }));
      const lab = sv('text', { x: ml - 5, y: y + 3.5, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 11 });
      lab.textContent = nf0.format(t); svg.append(lab);
    }
    const selIdx = daily && s.n === ui.line ? bs.findIndex((b) => b.s === ui.day) : -1;
    if (selIdx >= 0) svg.append(sv('rect', { x: ml + selIdx * step, y: mt, width: step, height: ih, fill: 'var(--sel)' }));
    s.d.forEach((d, i) => {
      if (d.h == null) return;
      const h = Math.max(1, ih * d.h / ymax);
      svg.append(sv('rect', { x: ml + i * step + (step - bw) / 2, y: mt + ih - h, width: bw, height: h, fill: d.b.e >= ui.s ? 'var(--accent)' : 'var(--bar-mute)' }));
    });
    if (daily) {
      const pts = [];
      s.d.forEach((d, i) => {
        if (i < 6) return;
        const vals = s.d.slice(i - 6, i + 1).map((x) => x.h).filter((x) => x != null);
        if (vals.length < 4) return;
        pts.push((ml + i * step + step / 2).toFixed(1) + ',' + (mt + ih * (1 - vals.reduce((p, c) => p + c, 0) / vals.length / ymax)).toFixed(1));
      });
      if (pts.length > 2) svg.append(sv('polyline', { points: pts.join(' '), fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }
    const every = Math.max(1, Math.ceil(N / 6));
    for (let i = 0; i < N; i += every) {
      const t = sv('text', { x: ml + i * step + step / 2, y: H - 5, 'text-anchor': i === 0 ? 'start' : 'middle', fill: 'var(--muted)', 'font-size': 11 });
      t.textContent = bs[i].u === 'm' ? new Intl.DateTimeFormat('es', { month: 'short', timeZone: 'UTC' }).format(D(bs[i].s)) : dShort.format(D(bs[i].s));
      if (i === 0) t.setAttribute('x', ml); svg.append(t);
    }
    const hit = sv('rect', { x: ml, y: 0, width: iw, height: H - mb, fill: 'transparent', style: 'cursor:pointer' });
    const idxOf = (ev) => { const r = svg.getBoundingClientRect(); const x = (ev.clientX - r.left) * (W / r.width) - ml; return Math.min(N - 1, Math.max(0, Math.floor(x / step))); };
    hit.addEventListener('pointermove', (ev) => {
      const d = s.d[idxOf(ev)];
      showTip(ev, [bLabel(d.b), d.h == null ? 'Sin datos' : el('span', {}, el('b', { text: fH(d.h) }), ' de paro · disp. ' + (d.disp == null ? '—' : fP(d.disp)))]);
    });
    hit.addEventListener('pointerleave', hideTip);
    hit.addEventListener('click', (ev) => { const d = s.d[idxOf(ev)]; goDay(d.b.s, s.n); });
    svg.append(hit);
    wrap.replaceChildren(svg);
  }

  /* ---------- detalle del día ---------- */
  function renderDay() {
    const a = store.lines[ui.line];
    if (ui.day < a.desde) ui.day = a.desde;
    if (ui.day > a.hasta) ui.day = a.hasta;
    $('day-line').replaceChildren(dot(ui.line), ui.line);
    $('day-when').textContent = dLong.format(D(ui.day));
    $('day-prev').disabled = ui.day <= a.desde;
    $('day-next').disabled = ui.day >= a.hasta;
    const d = Core.dayDetail(a, ui.day, ui.ty);
    const body = $('day-body'); body.replaceChildren();
    if (!d.hay) { body.append(el('div', { class: 'empty', text: 'Atlas no trae datos de este día para ' + ui.line + '.' })); return; }
    const st = (lab, val) => el('div', { class: 'stat' }, el('span', { text: lab }), el('b', { text: val }));
    body.append(el('div', { class: 'stats' },
      st(dispLabel(), d.disp == null ? '—' : fP(d.disp)), st('Paro (tipos elegidos)', fH(d.sel)),
      st('Electromecánico', fH(d.em)), st('Operacional', fH(d.op)), st('Externo', fH(d.ext)),
      st('Paros de más de 30 min', nf0.format(d.largos.length))));
    const multi = tyList().length > 1;
    const left = el('div', {}, el('h3', { text: 'Causas del día' }));
    const hb = el('div', { class: 'hb' });
    const top = d.list.slice(0, 8);
    const mx = Math.max(1, ...top.map((x) => x.min));
    for (const x of top) {
      hb.append(el('div', { class: 'it' },
        el('div', { class: 'lab' }, el('span', {}, x.comp + ' · ' + x.causa, multi ? el('span', { class: 'tag', text: '· ' + TL[x.t] }) : null), el('span', { class: 'num', text: fDur(x.min) + ' · ' + nf0.format(x.reg) + '×' })),
        el('div', { class: 'track' }, el('div', { class: 'fill' + (x.t === 'ext' ? ' ext' : ''), style: 'width:' + (100 * x.min / mx).toFixed(1) + '%' })),
        x.note ? el('div', { class: 'nt', text: x.note }) : null));
    }
    if (!top.length) hb.append(el('div', { class: 'empty', text: 'Sin paros de este tipo.' }));
    left.append(hb);
    const right = el('div', {}, el('h3', { text: 'Paros de 30 min o más' }));
    const lg = el('div', { class: 'long' });
    for (const x of d.largos) lg.append(el('div', { class: 'l' }, el('span', { class: 'num dur', text: fDur(x.min) }), el('span', { class: 'num muted', text: x.hora }), el('span', { class: 'what', text: x.comp + ' · ' + x.causa }), el('div', { class: 'nt', text: x.note || 'Sin comentario en Atlas' })));
    if (!d.largos.length) lg.append(el('div', { class: 'empty', text: 'No hubo paros de 30 min o más este día.' }));
    right.append(lg);
    body.append(el('div', { class: 'two' }, left, right));
  }
  const stepDay = (k) => { const a = store.lines[ui.line]; const f = Core.addDays(ui.day, k); if (f >= a.desde && f <= a.hasta) { ui.day = f; renderAll(); } };
  $('day-prev').addEventListener('click', () => stepDay(-1));
  $('day-next').addEventListener('click', () => stepDay(1));

  /* ---------- mapa de calor ---------- */
  function renderHeat() {
    const a = store.lines[ui.line];
    const bs = Core.buckets(ui.s, ui.e);
    const u = bs[0].u;
    $('heat-title').textContent = 'Qué se repite: ' + (ui.comp ? 'causas de ' + ui.comp : 'equipo') + ' por ' + (u === 'd' ? 'día' : u === 'w' ? 'semana' : 'mes');
    $('heat-sub').textContent = ui.line + ' · horas de paro ' + tyText() + ', ' + rangeText(ui.s, ui.e) + '. Más oscuro, más horas.';
    const hm = Core.heat(a, bs, ui.ty, 10, ui.comp);
    const n = bs.length;
    const host = $('heat'); host.replaceChildren();
    host.style.gridTemplateColumns = `minmax(8.5rem, 13rem) repeat(${n}, minmax(1.7rem, 1fr)) 3.6rem`;
    host.append(el('div', {}));
    const clab = (b) => (b.u === 'm' ? new Intl.DateTimeFormat('es', { month: 'short', timeZone: 'UTC' }).format(D(b.s)) : String(+b.s.slice(8)) + ' ' + dShort.format(D(b.s)).replace(/^\d+\s*/, '').slice(0, 3));
    bs.forEach((b) => host.append(el('div', { class: 'cl' + (u === 'd' && b.s === ui.day ? ' sel' : ''), text: clab(b) })));
    host.append(el('div', { class: 'cl', text: 'total' }));
    if (!hm.rows.length) { host.append(el('div', { class: 'empty', text: 'Sin paros de este tipo en el periodo.' })); return; }
    let mx = 0.5;
    for (const r of hm.rows) for (const v of r.v) if (v > mx) mx = v;
    for (const r of hm.rows) {
      host.append(el('div', { class: 'rl', text: r.comp }));
      r.v.forEach((v, i) => {
        const b = bs[i];
        const t = v > 0 ? 0.1 + 0.9 * Math.pow(v / mx, 0.75) : 0;
        const c = el('button', { type: 'button', class: 'c' + (u === 'd' && b.s === ui.day ? ' sel' : ''), 'aria-label': r.comp + ', ' + bLabel(b) + ': ' + fH(v) });
        if (v > 0) { c.style.background = 'color-mix(in srgb, var(--accent) ' + Math.round(t * 100) + '%, var(--cell0))'; c.style.color = t > 0.55 ? 'var(--on-accent)' : 'var(--ink)'; if (v >= 0.1) c.textContent = v >= 10 ? nf0.format(v) : nf1.format(v); }
        c.addEventListener('pointermove', (ev) => showTip(ev, [bLabel(b), el('span', {}, r.comp + ': ', el('b', { text: fH(v) }))]));
        c.addEventListener('pointerleave', hideTip);
        c.addEventListener('click', () => goDay(b.s));
        host.append(c);
      });
      host.append(el('div', { class: 'tot', text: fH(r.tot) }));
    }
  }

  /* ---------- en qué enfocarse ---------- */
  const BADGE = { Empeora: 'b-bad', Nuevo: 'b-bad', Persiste: 'b-warn', Intermitente: 'b-flat', Mejora: 'b-ok', Resuelto: 'b-ok' };
  const FLT = { all: 'Todas', att: 'Requieren atención', ok: 'Mejoran' };
  function renderCompare() {
    const a = store.lines[ui.line];
    const pr = Core.prevRange(ui.s, ui.e), n = nDays();
    $('cmp-sub').textContent = (ui.comp ? ui.comp + ' · ' : '') + rangeText(ui.s, ui.e) + ' frente a ' + rangeText(pr.s, pr.e) + ' (' + n + (n === 1 ? ' día' : ' días') + ' cada uno).';
    const multi = tyList().length > 1;
    const all = Core.compare(a, ui.s, ui.e, ui.ty, ui.comp).filter((x) => x.h + x.hp >= 0.5);
    const tot = Core.sumRange(a, ui.s, ui.e, ui.ty).sel;
    const fl = $('cmp-flt'); fl.replaceChildren();
    const cnt = { all: all.length, att: all.filter((x) => ATT[x.estado]).length, ok: all.filter((x) => x.estado === 'Mejora' || x.estado === 'Resuelto').length };
    for (const k in FLT) fl.append(el('button', { type: 'button', class: 'chip' + (ui.flt === k ? ' on' : ''), 'aria-pressed': String(ui.flt === k), text: FLT[k] + ' ' + cnt[k], onclick: () => { ui.flt = k; renderAll(); } }));
    const rows = all.filter((x) => ui.flt === 'all' || (ui.flt === 'att' ? ATT[x.estado] : (x.estado === 'Mejora' || x.estado === 'Resuelto'))).slice(0, 15);
    const t = $('cmp'); t.replaceChildren();
    t.append(el('thead', {}, el('tr', {}, el('th', { text: 'Equipo · causa' }), el('th', { class: 'n', text: 'Periodo' }), el('th', { class: 'n hide-s', text: '% del paro' }), el('th', { class: 'n hide-s', text: 'Previo' }), el('th', { class: 'n hide-s', text: 'Eventos' }), el('th', { class: 'n hide-s', text: 'Días' }), el('th', { text: 'Estado' }), el('th', { class: 'hide-s', text: 'Comentario más repetido' }))));
    const tb = el('tbody', {});
    for (const x of rows) tb.append(el('tr', {},
      el('td', {}, el('b', { text: x.comp }), ' · ' + x.causa, multi ? el('span', { class: 'tag', text: '· ' + TL[x.t] }) : null), el('td', { class: 'n', text: fH(x.h) }), el('td', { class: 'n hide-s', text: tot ? nf0.format(100 * x.h / tot) + '%' : '—' }), el('td', { class: 'n hide-s', text: fH(x.hp) }),
      el('td', { class: 'n hide-s', text: nf0.format(x.reg) }), el('td', { class: 'n hide-s', text: x.dias + '/' + n }), el('td', {}, el('span', { class: 'badge ' + BADGE[x.estado], text: x.estado })),
      el('td', { class: 'nota hide-s', text: x.note || '—' })));
    if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: 8, class: 'empty', text: ui.flt === 'all' ? 'Sin paros relevantes en este periodo.' : 'Ninguna causa en este grupo.' })));
    t.append(tb);
  }

  /* ---------- arranque ---------- */
  $('btn-copy').addEventListener('click', (e) => copySummary(e.currentTarget));
  $('btn-csv').addEventListener('click', downloadCsv);
  $('btn-load').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
  const drop = $('drop');
  drop.addEventListener('click', (e) => { if (!drop.classList.contains('compact') && e.target.tagName !== 'A') $('file').click(); });
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (!$('app').hidden) renderBars(); }, 150); });

  window.addEventListener('tablero-auth', (e) => {
    window.__auth = e.detail;
    edit.on = !!e.detail.admin;
    applyEdit();
    if (e.detail.email && !e.detail.admin) cloudStatus('Sin permiso de edición. Tu UID: ' + e.detail.uid, true);
  });
  $('btn-admin').addEventListener('click', () => {
    if (!window.TableroAuth) return;
    Promise.resolve(window.__auth && window.__auth.email ? window.TableroAuth.signOut() : window.TableroAuth.signIn()).catch(() => cloudStatus('No se pudo iniciar sesión', true));
  });
  if (window.__auth) edit.on = !!window.__auth.admin;
  applyEdit();

  restore().then((ok) => { if (ok) init(true); }).then(cloudStart);
})();
