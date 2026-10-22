"""Arma el tablero: junta src/template.html + src/core.js + src/rules.json.
Salidas:
  dist/tablero.html  -> fragmento HTML para publicar en una página
  dist/index.html    -> página completa para abrir directo en el navegador
"""
import json, pathlib
root = pathlib.Path(__file__).parent
t = (root / 'src/template.html').read_text(encoding='utf-8')
rules = json.dumps(json.loads((root / 'src/rules.json').read_text(encoding='utf-8')), ensure_ascii=False)
core = (root / 'src/core.js').read_text(encoding='utf-8')
assert '</script' not in core
t = t.replace('/*RULES_JSON*/', rules).replace('/*CORE_JS*/', core)
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist/tablero.html').write_text(t, encoding='utf-8')
(root / 'dist/index.html').write_text(
    '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + t + '</body></html>',
    encoding='utf-8')
print('listo:', len(t), 'bytes')
