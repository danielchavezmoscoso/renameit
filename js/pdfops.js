/*
 * RenameIt web - operaciones con PDFs: leer páginas (pdf.js), dividir y llenar formularios (pdf-lib).
 * Funciona en el navegador (PDFLib y pdfjsLib globales) y en Node (se pasan con setLibs).
 */
(function (root) {
  "use strict";
  let PDFLib = root.PDFLib, pdfjsLib = root.pdfjsLib;
  const core = root.RenameItCore || (typeof require !== "undefined" ? require("./core.js") : null);

  function setLibs(pdflib, pdfjs) { PDFLib = pdflib; pdfjsLib = pdfjs; }

  /** Lee un PDF: devuelve {pdfjsDoc, models:[pageModel]} */
  async function readPdf(bytes) {
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(0), verbosity: 0 }).promise;
    const models = [];
    for (let i = 1; i <= doc.numPages; i++) models.push(await core.pageModel(await doc.getPage(i)));
    return { doc: doc, models: models };
  }

  /** Crea un PDF con las páginas indicadas (índices desde 0). */
  async function extractPages(srcDoc, pages) {
    const out = await PDFLib.PDFDocument.create();
    const copied = await out.copyPages(srcDoc, pages);
    copied.forEach(p => out.addPage(p));
    return out.save();
  }
  async function loadLib(bytes) {
    return PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
  }

  // ------------------------------------------------------------------ formularios de alerta
  function widgetsOf(doc) {
    const form = doc.getForm();
    const page = doc.getPage(0);
    const H = page.getHeight();
    const out = [];
    for (const f of form.getFields()) {
      const kind = f instanceof PDFLib.PDFCheckBox ? "check" : f instanceof PDFLib.PDFTextField ? "text"
        : f instanceof PDFLib.PDFDropdown ? "combo" : null;
      if (!kind) continue;
      const w = f.acroField.getWidgets()[0];
      if (!w) continue;
      const r = w.getRectangle();
      out.push({ name: f.getName(), kind: kind, rect: { x0: r.x, x1: r.x + r.width, y0: H - (r.y + r.height), y1: H - r.y },
        maxLen: kind === "text" ? (f.getMaxLength() || 0) : 0, options: kind === "combo" ? f.getOptions() : [] });
    }
    return out;
  }

  /** Analiza un formulario de alerta: devuelve la descripción (core.analyzeTemplate) o null si no lo es. */
  async function analyzeTemplate(fileName, bytes) {
    const doc = await loadLib(bytes);
    const widgets = widgetsOf(doc);
    const { models } = await readPdf(bytes);
    const t = core.analyzeTemplate(fileName, widgets, models[0]);
    if (!Object.keys(t.checks).length || !t.fields.student) return null;
    return t;
  }

  /** Llena el formulario. values: {course, schedule, date, tutor, student, comments, faltas, docente, contacto, atencion} */
  async function fillAlert(t, bytes, values, items) {
    const doc = await loadLib(bytes);
    const form = doc.getForm();
    const helv = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const byWidget = {};
    for (const [k, v] of Object.entries(t.fields)) byWidget[v] = k;
    const checkBy = {};
    for (const [k, v] of Object.entries(t.checks)) checkBy[v] = k;
    for (const f of form.getFields()) {
      const name = f.getName();
      if (f instanceof PDFLib.PDFCheckBox) {
        if (!(name in checkBy)) continue;
        if (items.has(checkBy[name])) f.check(); else f.uncheck();
        continue;
      }
      const k = byWidget[name];
      if (!k || !(k in values)) continue;
      let v = String(values[k] || "");
      v = winAnsi(v);
      if (f instanceof PDFLib.PDFTextField) {
        const ml = f.getMaxLength() || 0;
        if (ml && v.length > ml) v = v.slice(0, Math.max(ml - 1, 1)).trimEnd() + (ml > 3 ? "…" : "");
        if (k === "comments") {
          const size = v.length > 330 ? 9 : v.length > 200 ? 10 : 11;
          f.setFontSize(size);
          const w = f.acroField.getWidgets()[0].getRectangle().width - 10;
          v = wrap(v, helv, size, w);
        }
        f.setText(v);
        f.updateAppearances(helv);
      } else if (f instanceof PDFLib.PDFDropdown) {
        if (v) { f.select(v); f.updateAppearances(helv); }
      }
    }
    return doc.save();
  }

  function wrap(text, font, size, width) {
    const lines = [];
    let cur = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const cand = cur ? cur + " " + word : word;
      if (cur && font.widthOfTextAtSize(cand, size) > width) { lines.push(cur); cur = word; } else cur = cand;
    }
    if (cur) lines.push(cur);
    return lines.join("\n");
  }

  // Helvetica estándar solo tiene caracteres WinAnsi: reemplaza los que no estén.
  const WINANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
  function winAnsi(s) {
    let out = "";
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255) || WINANSI_EXTRA.includes(ch)) out += ch;
      else if (ch === "\n") out += " ";
      else out += ch.normalize("NFKD").replace(/[^\x20-\x7e]/g, "") || "?";
    }
    return out;
  }

  const api = { setLibs, readPdf, extractPages, loadLib, analyzeTemplate, fillAlert, widgetsOf };
  root.RenameItPdf = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
