# Tablero de paros

Tablero web para ver, día a día, los paros de líneas de producción de embotellado. Se alimenta arrastrando los reportes Excel de la plataforma Atlas.

Todo se procesa en el navegador: los Excel no se suben a ningún servidor.

## Qué muestra
- **Tarjetas por línea:** disponibilidad, horas de paro, eventos, duración media del paro (MTTR) y tiempo medio entre paros (MTBF), frente al periodo anterior del mismo largo.
- **Lo importante:** cuántos equipos concentran el paro, el mayor contribuyente, las causas que requieren atención y el paro más largo. El botón *Copiar resumen* deja el texto listo para la reunión diaria.
- **Prioridades:** Pareto por equipo (al tocar un equipo se ven sus causas y se filtra el resto), paros más largos del periodo y la tabla "En qué enfocarse" con el estado de cada causa (Nuevo, Empeora, Persiste, Intermitente, Mejora, Resuelto), filtro por estado y descarga en CSV.
- **Tendencia:** horas de paro por día, semana o mes y mapa de calor equipo × día.
- **Día a día:** causas y paros largos de un día, con navegación entre días.
- Filtros: línea, periodo, tipo de paro (electromecánico, operacional, externo) y equipo.

## Estructura
| Ruta | Qué es |
|---|---|
| `src/template.html` | Estructura de la página |
| `src/styles.css` | Estilos |
| `src/app.js` | Pantalla: filtros, tarjetas, pestañas, gráficos, guardado y carga de archivos |
| `src/core.js` | Lectura del reporte, clasificación y cálculos (funciona en navegador y en Node) |
| `src/rules.json` | Reglas de texto: causas a partir de los comentarios y correcciones de ortografía |
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
- **Equipo:** es el `Reason Lvl1` de Atlas tal como viene en el reporte (por ejemplo, Etiquetadora, Termoencogible, Transp. Llena-Etique); solo se corrige la ortografía.
- **Causa:** sale del comentario (`Notes`) con las reglas de `src/rules.json`.
- Si Atlas no trae un equipo (causa externa, programada o vacío), el comentario también decide el equipo; si no alcanza, queda como "Línea completa".

## Definiciones
- Paro interno = Paradas Electromecánicas + Paradas Operacionales.
- Disponibilidad = Uptime / (Uptime + paro de los tipos elegidos).
- Evento = fila de paro registrada en Atlas. MTTR = minutos de paro / eventos. MTBF = horas de Uptime / eventos.
- Paro largo = filas seguidas del mismo componente y tipo que suman 30 min o más.
- Al cargar un reporte, las fechas que trae reemplazan a las guardadas y el resto se conserva.
- Estados: *Nuevo* y *Resuelto* si casi no hay horas en uno de los dos periodos; *Empeora* y *Mejora* si el cambio supera 30 % (o 40 %) y 0,75 h por cada 7 días; *Persiste* si ocurre en la mitad de los días o más; *Intermitente* en el resto.

## Datos
Los reportes de Atlas son datos de la empresa y no se versionan: `.gitignore` bloquea `*.xlsx` y `*.csv`.
