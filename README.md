# RenameIt (versión web)

Divide los PDFs de las tarjetas de evaluación en un archivo por estudiante, les pone nombre automáticamente,
llena las alertas académicas y los publica en Google Classroom como material visible solo para cada alumno.

**Privacidad:** todo se procesa dentro del navegador. Los PDFs no se suben a ningún servidor; solo los que
envías a Classroom se suben a tu propio Google Drive. Los formatos, reglas y preferencias se guardan en el
navegador (localStorage / IndexedDB).

## Uso

Abre la página publicada y sigue los pasos. La sección **Ayuda** explica cada parte.

## Google Classroom

La página usa un ID de cliente OAuth de tipo «Aplicación web» (Google Cloud Console → Credenciales), con la
dirección de esta página como «Origen de JavaScript autorizado». El ID va en `js/config.js` (no es secreto).

## Estructura

- `index.html`, `css/app.css` — interfaz (design system CBA La Paz).
- `js/core.js` — lógica: lectura de texto, formatos, nombres, notas, reglas, coincidencia de alumnos.
- `js/pdfops.js` — dividir PDFs y llenar formularios (pdf-lib).
- `js/app.js`, `js/classroom.js`, `js/alerts.js`, `js/formats.js` — vistas.
- `js/google.js` — Classroom y Drive (Google Identity Services + API REST).
- `vendor/` — pdf.js 3.11.174 (Apache 2.0), pdf-lib 1.17.1 (MIT), JSZip 3.10.1 (MIT/GPLv3), con sus licencias.
