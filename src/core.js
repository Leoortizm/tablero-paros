/* Lógica de lectura y agregación de los reportes de Atlas. Funciona igual en el navegador y en Node. */
const Core = (() => {
  const R = RULES;
  const rx = {
    comp: R.COMPONENTE.map(([r, l]) => [new RegExp(r), l]),
    causa: R.CAUSA.map(([r, l]) => [new RegExp(r), l]),
    equipo: R.EQUIPO_LVL1.map(([r, l]) => [new RegExp(r), l]),
  };
  const valid = new Set(R.VALID_COMP);
  const first = (rules, t) => { for (const [re, l] of rules) if (re.test(t)) return l; return null; };
  const norm = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9% ]/g, ' ').replace(/\s+/g, ' ').trim();
  const fix = (t) => t.split(' ').map((w) => (Object.prototype.hasOwnProperty.call(R.TYPOS, w) ? R.TYPOS[w] : w)).join(' ');

  const cache = new Map();
  function classify(note, lvl1) {
    const key = (note || '') + '\u0001' + (lvl1 || '');
    let c = cache.get(key);
    if (c) return c;
    const t = note ? fix(norm(note)) : '';
    let comp = t ? first(rx.comp, t) : null;
    let causa = t ? first(rx.causa, t) : null;
    if (!comp) comp = first(rx.equipo, String(lvl1 || '').toLowerCase()) || 'Línea completa';
    if (!valid.has(comp)) comp = 'Línea completa';
    if (!causa || causa === 'Sin descripción útil') causa = 'Otras fallas / intervención';
    c = { comp, causa };
    cache.set(key, c);
    return c;
  }

  const serialToMs = (n) => Math.round((n - 25569) * 86400) * 1000;
  function dayOf(v) {
    if (typeof v === 'number') return new Date(serialToMs(v)).toISOString().slice(0, 10);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[0];
    const d = new Date(v);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  function msOf(v) {
    if (typeof v === 'number') return serialToMs(v);
    const d = new Date(v);
    return isNaN(d) ? NaN : d.getTime();
  }
  const dnum = (f) => Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10)) / 864e5;
  const dstr = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
  const addDays = (f, n) => dstr(dnum(f) + n);
  const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);
  const cleanNote = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 170);


  /* Atlas escribe una dimensión errónea (A1:X6): se recalcula el rango real de la hoja */
  function sheetRows(XLSX, ws) {
    let lastKey = null;
    for (const k in ws) if (k.charCodeAt(0) !== 33) lastKey = k;
    if (lastKey) {
      const last = XLSX.utils.decode_cell(lastKey);
      const cur = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { e: { c: 0 } };
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(last.r, 5), c: Math.max(cur.e.c, 30) } });
    }
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });
  }

  /* rows: arreglo de arreglos de la hoja "Data" (la primera fila con "Asset" es el encabezado) */
  function aggregateRows(rows, loadedAt) {
    let h = rows.findIndex((r) => r && r.indexOf && r.indexOf('Asset') >= 0 && r.indexOf('Super Reason') >= 0);
    if (h < 0) throw new Error('No encontré las columnas de Atlas (Asset, Super Reason…)');
    const head = rows[h];
    const col = (n) => head.indexOf(n);
    const C = {
      asset: col('Asset'), ld: col('Logical Date'), st: col('Start Time'), en: col('End Time'), min: col('Minutes'),
      sr: col('Super Reason'), l1: col('Reason Lvl1'), l2: col('Reason Lvl2'), nt: col('Notes'),
    };
    for (const k of Object.keys(C)) if (C[k] < 0) throw new Error('Falta la columna ' + k + ' en el reporte');
    const per = new Map();
    const get = (name) => {
      let a = per.get(name);
      if (!a) { a = { linea: name, days: {}, itemsMap: new Map(), stops: [], filas: 0 }; per.set(name, a); }
      return a;
    };
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r[C.asset] == null || r[C.ld] == null) continue;
      const sr = String(r[C.sr] || '');
      const minutes = Number(r[C.min]);
      if (!isFinite(minutes)) continue;
      const f = dayOf(r[C.ld]);
      if (!f) continue;
      const a = get(String(r[C.asset]));
      a.filas++;
      const isUp = sr === 'Uptime';
      const isExt = /Externa/i.test(sr);
      const isInt = /Paradas/i.test(sr);
      if (!isUp && !isExt && !isInt) continue;
      const d = a.days[f] || (a.days[f] = { up: 0, em: 0, op: 0, ext: 0 });
      if (isUp) { d.up += minutes; continue; }
      const t = isExt ? 'ext' : (/Electromec/i.test(sr) ? 'em' : 'op');
      d[t] += minutes;
      const note = r[C.nt] == null ? '' : cleanNote(r[C.nt]);
      const cl = classify(note, r[C.l1]);
      const key = f + '|' + cl.comp + '|' + cl.causa + '|' + t;
      let it = a.itemsMap.get(key);
      if (!it) { it = { f, comp: cl.comp, causa: cl.causa, t, min: 0, reg: 0, notes: new Map() }; a.itemsMap.set(key, it); }
      it.min += minutes; it.reg++;
      if (note) {
        const k = note.toLowerCase();
        const n = it.notes.get(k);
        if (n) n.m += minutes; else it.notes.set(k, { t: note, m: minutes });
      }
      if (isInt) a.stops.push({ s: msOf(r[C.st]), e: msOf(r[C.en]), min: minutes, comp: cl.comp, causa: cl.causa, note, f, t });
    }
    const out = {};
    for (const [name, a] of per) {
      const items = [];
      for (const it of a.itemsMap.values()) {
        let top = '';
        let best = -1;
        for (const n of it.notes.values()) if (n.m > best) { best = n.m; top = n.t; }
        items.push({ f: it.f, comp: it.comp, causa: it.causa, t: it.t, min: Math.round(it.min * 10) / 10, reg: it.reg, note: top });
      }
      // paros largos: filas internas consecutivas del mismo componente se juntan
      a.stops.sort((x, y) => x.s - y.s);
      const largos = [];
      let cur = null;
      const flush = () => {
        if (cur && cur.min >= 30) largos.push({ f: cur.f, hora: isNaN(cur.s) ? '' : hhmm(cur.s), t: cur.t, min: Math.round(cur.min), comp: cur.comp, causa: cur.causa, note: cur.notes.slice(0, 2).join(' | ').slice(0, 200) });
      };
      for (const s of a.stops) {
        if (cur && s.comp === cur.comp && s.t === cur.t && Math.abs(s.s - cur.e) <= 2000) {
          cur.min += s.min; cur.e = s.e;
          if (s.note && cur.notes.indexOf(s.note) < 0) cur.notes.push(s.note);
        } else {
          flush();
          cur = { s: s.s, e: s.e, min: s.min, comp: s.comp, causa: s.causa, f: s.f, t: s.t, notes: s.note ? [s.note] : [] };
        }
      }
      flush();
      const dates = Object.keys(a.days).sort();
      out[name] = {
        v: 2, linea: name, desde: dates[0], hasta: dates[dates.length - 1], cargado: loadedAt || null,
        filas: a.filas, days: a.days, items, largos,
      };
    }
    return out;
  }

  const pick = (d, ty) => (ty.em ? d.em : 0) + (ty.op ? d.op : 0) + (ty.ext ? d.ext : 0);
  const span = (s, e) => dnum(e) - dnum(s) + 1;
  function prevRange(s, e) { const n = span(s, e); return { s: addDays(s, -n), e: addDays(s, -1), n }; }

  function sumRange(agg, s, e, ty) {
    let up = 0, em = 0, op = 0, ext = 0, dias = 0;
    for (let x = dnum(s); x <= dnum(e); x++) {
      const d = agg.days[dstr(x)];
      if (d) { up += d.up; em += d.em; op += d.op; ext += d.ext; dias++; }
    }
    const sel = pick({ em, op, ext }, ty);
    return { up: up / 60, em: em / 60, op: op / 60, ext: ext / 60, sel: sel / 60, dias, disp: up + sel > 0 ? up / (up + sel) : null };
  }

  const itemsIn = (agg, s, e, ty) => agg.items.filter((it) => ty[it.t] && it.f >= s && it.f <= e);
  const largosIn = (agg, s, e, ty) => agg.largos.filter((x) => ty[x.t] && x.f >= s && x.f <= e);

  /* componente + causa + tipo dentro del periodo y del periodo anterior (mismo largo) */
  function compare(agg, s, e, ty) {
    const pr = prevRange(s, e), n = pr.n;
    const m = new Map();
    const touch = (it) => {
      const k = it.comp + '|' + it.causa + '|' + it.t;
      let o = m.get(k);
      if (!o) { o = { comp: it.comp, causa: it.causa, t: it.t, h: 0, hp: 0, dias: new Set(), reg: 0, note: '', nm: -1 }; m.set(k, o); }
      return o;
    };
    for (const it of itemsIn(agg, s, e, ty)) {
      const o = touch(it);
      o.h += it.min / 60; o.reg += it.reg; o.dias.add(it.f);
      if (it.note && it.min > o.nm) { o.nm = it.min; o.note = it.note; }
    }
    for (const it of itemsIn(agg, pr.s, pr.e, ty)) touch(it).hp += it.min / 60;
    return [...m.values()].map((o) => ({ comp: o.comp, causa: o.causa, t: o.t, h: o.h, hp: o.hp, dias: o.dias.size, reg: o.reg, note: o.note, estado: estado(o.h, o.hp, o.dias.size, n) }))
      .sort((a, b) => (b.h + b.hp * 0.01) - (a.h + a.hp * 0.01));
  }

  /* los umbrales en horas se escalan con el largo del periodo (base: 7 días) */
  function estado(h, hp, dias, n) {
    const k = Math.max(1, n / 7);
    if (h < 0.25 * k && hp >= 1 * k) return 'Resuelto';
    if (hp < 0.25 * k && h >= 1 * k) return 'Nuevo';
    if (h >= hp * 1.3 && h - hp >= 0.75 * k) return 'Empeora';
    if (h <= hp * 0.6 && hp - h >= 0.75 * k) return 'Mejora';
    if (dias >= Math.ceil(n / 2)) return 'Persiste';
    return 'Intermitente';
  }

  function dayDetail(agg, f, ty) {
    const d = agg.days[f] || { up: 0, em: 0, op: 0, ext: 0 };
    const m = new Map();
    for (const it of agg.items) {
      if (it.f !== f || !ty[it.t]) continue;
      const k = it.comp + '|' + it.causa + '|' + it.t;
      let o = m.get(k);
      if (!o) { o = { comp: it.comp, causa: it.causa, t: it.t, min: 0, reg: 0, note: '', nm: -1 }; m.set(k, o); }
      o.min += it.min; o.reg += it.reg;
      if (it.note && it.min > o.nm) { o.nm = it.min; o.note = it.note; }
    }
    const list = [...m.values()].sort((a, b) => b.min - a.min);
    const sel = pick(d, ty);
    return {
      f, up: d.up / 60, em: d.em / 60, op: d.op / 60, ext: d.ext / 60, sel: sel / 60,
      disp: d.up + sel > 0 ? d.up / (d.up + sel) : null,
      parcial: (d.up + d.em + d.op + d.ext) / 60 < 14 && !!agg.days[f],
      hay: !!agg.days[f], list, largos: agg.largos.filter((x) => x.f === f && ty[x.t]).sort((a, b) => a.hora.localeCompare(b.hora)),
    };
  }

  /* junta un reporte nuevo con lo guardado: los días que trae el reporte reemplazan a los guardados; el resto se conserva */
  function mergeLine(old, nw) {
    const keep = (f) => f < nw.desde || f > nw.hasta;
    const days = {};
    for (const f in old.days) if (keep(f)) days[f] = old.days[f];
    Object.assign(days, nw.days);
    const items = old.items.filter((x) => keep(x.f)).concat(nw.items);
    const largos = old.largos.filter((x) => keep(x.f)).concat(nw.largos);
    const dates = Object.keys(days).sort();
    return { v: 2, linea: nw.linea, desde: dates[0], hasta: dates[dates.length - 1], cargado: nw.cargado, filas: (old.filas || 0) + nw.filas, days, items, largos };
  }

  /* columnas del gráfico y del mapa: días (hasta 45), semanas (hasta 200 días) o meses */
  function buckets(s, e) {
    const n = span(s, e), out = [];
    if (n <= 45) { for (let x = dnum(s); x <= dnum(e); x++) out.push({ s: dstr(x), e: dstr(x), u: 'd' }); }
    else if (n <= 200) {
      for (let x = dnum(s); x <= dnum(e); x += 7) out.push({ s: dstr(x), e: dstr(Math.min(x + 6, dnum(e))), u: 'w' });
    } else {
      let cur = s;
      while (cur <= e) {
        const y = +cur.slice(0, 4), mo = +cur.slice(5, 7);
        const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
        const be = last < e ? last : e;
        out.push({ s: cur, e: be, u: 'm' });
        cur = addDays(be, 1);
      }
    }
    return out;
  }

  function series(agg, bs, ty) {
    return bs.map((b) => {
      let up = 0, sel = 0, has = false;
      for (let x = dnum(b.s); x <= dnum(b.e); x++) {
        const d = agg.days[dstr(x)];
        if (d) { has = true; up += d.up; sel += pick(d, ty); }
      }
      return { b, h: has ? sel / 60 : null, disp: has && up + sel > 0 ? up / (up + sel) : null };
    });
  }

  function heat(agg, bs, ty, rowsMax) {
    const idx = new Map();
    bs.forEach((b, i) => { for (let x = dnum(b.s); x <= dnum(b.e); x++) idx.set(dstr(x), i); });
    const m = new Map();
    for (const it of agg.items) {
      if (!ty[it.t] || !idx.has(it.f)) continue;
      let o = m.get(it.comp);
      if (!o) { o = { comp: it.comp, tot: 0, v: new Array(bs.length).fill(0) }; m.set(it.comp, o); }
      o.v[idx.get(it.f)] += it.min / 60; o.tot += it.min / 60;
    }
    return { buckets: bs, rows: [...m.values()].sort((a, b) => b.tot - a.tot).slice(0, rowsMax) };
  }

  return { classify, sheetRows, aggregateRows, mergeLine, sumRange, prevRange, itemsIn, largosIn, compare, dayDetail, buckets, series, heat, estado, addDays, dnum, dstr, span };
})();
if (typeof module !== 'undefined') module.exports = Core;
