# Tablero de paros

Tablero web para ver, día a día, los paros de líneas de producción de embotellado. Se alimenta arrastrando los reportes Excel de la plataforma Atlas.

Todo se procesa en el navegador: los Excel no se suben a ningún servidor.

## Qué muestra
- Tarjetas por línea: disponibilidad, horas de paro y paros de más de 30 min, frente al periodo anterior del mismo largo.
- Horas de paro por día, semana o mes, según el largo del periodo.
- Detalle del día con causas, paros largos y navegación día a día.
- Mapa de calor componente × día.
- "En qué enfocarse": estado de cada causa (Nuevo, Empeora, Persiste, Intermitente, Mejora, Resuelto).
- Filtros: línea, periodo (desde–hasta) y tipo de paro (electromecánico, operacional, externo).

## Estructura
| Ruta | Qué es |
|---|---|
| `src/template.html` | Interfaz (HTML, CSS y script de pantalla) |
| `src/core.js` | Lectura del reporte, clasificación y cálculos (funciona en navegador y en Node) |
| `src/rules.json` | Reglas de texto: equipos de Atlas (`Reason Lvl1`) y causas a partir de los comentarios |
| `build.py` | Junta lo anterior en `dist/` |
| `dist/tablero.html` | Fragmento HTML listo para publicar |
| `dist/index.html` | Página completa, se abre directo en el navegador |
| `firebase/` | Puente a Firebase (Firestore y acceso con Google) |
| `firestore.rules`, `firebase.json` | Reglas de seguridad y configuración de Hosting |
| `tools/check.js` | Revisa reportes desde la terminal |
| `docs/FIREBASE.md` | Guía para publicarlo en Firebase |

## Cómo se arma
```
python3 build.py
```

## Publicarlo
Ver [docs/FIREBASE.md](docs/FIREBASE.md): página pública de solo lectura y carga de datos solo para el administrador.

## Formato esperado del reporte
Hoja `Data` con el encabezado en la fila 3 y las columnas `Asset`, `Logical Date`, `Start Time`, `End Time`, `Minutes`, `Super Reason`, `Reason Lvl1`, `Reason Lvl2` y `Notes`. Un archivo puede traer una o varias líneas (se agrupan por `Asset`). Atlas escribe una dimensión de hoja errónea (`A1:X6`); `core.js` recalcula el rango real.

## Cómo se clasifica un paro
- **Equipo:** lo define Atlas con `Reason Lvl1` (por ejemplo, Etiquetadora, Termoencogible, Transp. Llena-Etique). Los transportadores se agrupan en uno solo.
- **Causa:** sale del comentario (`Notes`) con las reglas de `src/rules.json`.
- Si Atlas no trae un equipo (causa externa, programada o vacío), el comentario también decide el equipo; si no alcanza, queda como "Línea completa".

## Definiciones
- Paro interno = Paradas Electromecánicas + Paradas Operacionales.
- Disponibilidad = Uptime / (Uptime + paro de los tipos elegidos).
- Paro largo = filas seguidas del mismo componente y tipo que suman 30 min o más.
- Al cargar un reporte, las fechas que trae reemplazan a las guardadas y el resto se conserva.
- Estados: *Nuevo* y *Resuelto* si casi no hay horas en uno de los dos periodos; *Empeora* y *Mejora* si el cambio supera 30 % (o 40 %) y 0,75 h por cada 7 días; *Persiste* si ocurre en la mitad de los días o más; *Intermitente* en el resto.

## Datos
Los reportes de Atlas son datos de la empresa y no se versionan: `.gitignore` bloquea `*.xlsx` y `*.csv`.
