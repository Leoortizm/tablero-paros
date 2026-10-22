// Revisa reportes de Atlas desde la terminal: node tools/check.js reporte1.xlsx [reporte2.xlsx ...]
// Requiere: npm install xlsx@0.18.5
const fs = require('fs');
const XLSX = require('xlsx');
global.RULES = require('../src/rules.json');
const Core = require('../src/core.js');
for (const f of process.argv.slice(2)) {
  const wb = XLSX.read(fs.readFileSync(f), { sheets: 'Data' });
  const out = Core.aggregateRows(Core.sheetRows(XLSX, wb.Sheets.Data), new Date().toISOString());
  for (const [n, a] of Object.entries(out)) {
    const t = { em: true, op: true, ext: false };
    const w = Core.sumRange(a, a.desde, a.hasta, t);
    console.log(`${n}: ${a.desde} a ${a.hasta} · ${a.filas} filas · paro interno ${w.sel.toFixed(1)} h · disp ${(w.disp * 100).toFixed(1)}%`);
  }
}
