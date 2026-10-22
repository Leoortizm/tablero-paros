"""Arma el tablero: junta src/template.html + src/core.js + src/rules.json.
Uso:
  python3 build.py             -> dist/ (versión sin Firebase)
  python3 build.py --firebase  -> public/index.html (para Firebase Hosting; requiere firebase/firebase-config.json)
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

import sys
if '--firebase' in sys.argv:
    cfg_path = root / 'firebase/firebase-config.json'
    if not cfg_path.exists():
        sys.exit('Falta firebase/firebase-config.json (copia firebase/firebase-config.example.json y completa tus datos).')
    cfg = json.dumps(json.loads(cfg_path.read_text(encoding='utf-8')), ensure_ascii=False)
    shim = (root / 'firebase/shim.js').read_text(encoding='utf-8').replace('/*FIREBASE_CONFIG*/', cfg)
    page = t.replace('<script id="rules-js">', '<script>window.__READONLY = true;\n' + shim + '</script>\n<script id="rules-js">')
    assert page != t
    (root / 'public').mkdir(exist_ok=True)
    (root / 'public/index.html').write_text(
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + page + '</body></html>',
        encoding='utf-8')
    print('listo: public/index.html')
