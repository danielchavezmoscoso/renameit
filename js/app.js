/* RenameIt web - estado general, navegación y la vista «Dividir y renombrar». */
(function () {
  "use strict";
  const { $, $$, el, store, bus, modal, toast, saveFiles, canPickFolder, readFile, pickFiles, setSteps, confirmBox } = UI;
  const core = RenameItCore, ops = RenameItPdf;
  pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

  const DEFAULT_CFG = { plantilla: "{apellidos} {nombres} - {curso} - Eval {eval}", formato_nombre: "Tipo Título",
    formato: "", unir_paginas_consecutivas: true, guardar: "zip" };
  const PRESETS = [
    ["Apellidos Nombres - Curso - Eval 1", "{apellidos} {nombres} - {curso} - Eval {eval}"],
    ["Nombres Apellidos - Curso - Eval 1", "{nombres} {apellidos} - {curso} - Eval {eval}"],
    ["Curso - Apellidos Nombres - Eval 1", "{curso} - {apellidos} {nombres} - Eval {eval}"],
    ["Apellidos Nombres", "{apellidos} {nombres}"],
  ];
  const CUSTOM = "Personalizado (escribir mi propia plantilla)";
  const STEPS = ["Elige los PDFs", "Revisa los nombres", "Divide y guarda", "Entrega en Classroom"];
  const AUTO = "Automático (detectar en cada página)";

  function loadFormats() {
    const f = store.get("formats", null);
    if (!Array.isArray(f) || !f.length) return [core.normFormat(JSON.parse(JSON.stringify(core.CBA_FORMAT)))];
    return f.map(core.normFormat);
  }

  const RI = window.RI = {
    cfg: Object.assign({}, DEFAULT_CFG, store.get("cfg", {})),
    formats: loadFormats(),
    pdfs: [],          // [{name, size, bytes, models}]
    items: [],
    outputs: [],       // último resultado: [{name, bytes, vars}]
    done: false,
    saveCfg() { store.set("cfg", this.cfg); },
    saveFormats() { store.set("formats", this.formats); bus.emit("formats"); },
    async addPdfs(files) {
      const pdfs = files.filter(f => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
      if (!pdfs.length) return 0;
      let n = 0;
      toast(`Leyendo ${pdfs.length} PDF(s)…`);
      for (const f of pdfs) {
        if (this.pdfs.some(p => p.name === f.name && p.size === f.size)) continue;
        try {
          const bytes = await readFile(f);
          const { models } = await ops.readPdf(bytes);
          this.pdfs.push({ name: f.name, size: f.size, bytes: bytes, models: models });
          n++;
        } catch (e) {
          toast(`No se pudo leer «${f.name}»: ${e.message || e}`);
        }
      }
      this.done = false;
      bus.emit("pdfs");
      return n;
    },
    view(name) { showView(name); },
  };

  // ------------------------------------------------------------------ navegación
  function showView(name) {
    $$(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + name));
    $$(".nav-btn").forEach(b => b.setAttribute("aria-current", b.dataset.view === name ? "page" : "false"));
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
    bus.emit("view", name);
    window.scrollTo(0, 0);
  }
  $$(".nav-btn").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));

  // ------------------------------------------------------------------ arrastrar y soltar en toda la página
  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
  document.addEventListener("dragenter", e => { if (hasFiles(e)) { dragDepth++; document.body.classList.add("dragging"); } });
  document.addEventListener("dragleave", e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("dragging"); } });
  document.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener("drop", async e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove("dragging");
    const files = Array.from(e.dataTransfer.files || []);
    const active = $(".view.active").id;
    if (active === "view-classroom") { bus.emit("classroom-drop", files); return; }
    if (active === "view-alerts") { bus.emit("alerts-drop", files); return; }
    if (active === "view-formats") { bus.emit("formats-drop", files); return; }
    const n = await RI.addPdfs(files);
    if (!n) toast("Solo se pueden agregar archivos PDF.");
  });

  // ------------------------------------------------------------------ vista «Dividir y renombrar»
  const presetSel = $("#preset"), tplIn = $("#template"), caseSel = $("#case"), fmtSel = $("#format-select");
  presetSel.append(...PRESETS.map(p => el("option", { value: p[1], text: p[0] })), el("option", { value: "", text: CUSTOM }));
  caseSel.append(...core.NAME_FORMATS.map(n => el("option", { text: n })));
  tplIn.value = RI.cfg.plantilla;
  caseSel.value = RI.cfg.formato_nombre;
  $("#merge").checked = !!RI.cfg.unir_paginas_consecutivas;

  function fillFormatSelect() {
    fmtSel.innerHTML = "";
    fmtSel.append(el("option", { value: "", text: AUTO }), ...RI.formats.map(f => el("option", { value: f.nombre, text: f.nombre })));
    fmtSel.value = RI.formats.some(f => f.nombre === RI.cfg.formato) ? RI.cfg.formato : "";
  }
  function syncPreset() {
    const p = PRESETS.find(x => x[1] === tplIn.value);
    presetSel.value = p ? p[1] : "";
    showCustom(!p);
  }
  function showCustom(on) {
    $("#custom-box").hidden = !on;
    $("#vars-card").hidden = !on || !RI.items.length;
  }
  presetSel.addEventListener("change", () => {
    if (presetSel.value) { tplIn.value = presetSel.value; showCustom(false); }
    else { showCustom(true); tplIn.focus(); }
    changed();
  });
  tplIn.addEventListener("input", changed);
  caseSel.addEventListener("change", changed);
  fmtSel.addEventListener("change", changed);
  $("#merge").addEventListener("change", changed);
  $("#add-var").addEventListener("change", e => { if (e.target.value) insertVar(e.target.value); e.target.value = ""; });

  function insertVar(name) {
    if (presetSel.value) { presetSel.value = ""; showCustom(true); }
    const s = tplIn.selectionStart ?? tplIn.value.length, en = tplIn.selectionEnd ?? s;
    tplIn.value = tplIn.value.slice(0, s) + "{" + name + "}" + tplIn.value.slice(en);
    tplIn.focus();
    tplIn.selectionStart = tplIn.selectionEnd = s + name.length + 2;
    changed();
  }

  // Guardar
  const saveRadios = $$('input[name="save"]');
  if (!canPickFolder) { $("#save-folder-opt").hidden = true; RI.cfg.guardar = "zip"; }
  saveRadios.forEach(r => { r.checked = r.value === RI.cfg.guardar; r.addEventListener("change", () => { RI.cfg.guardar = r.value; RI.saveCfg(); saveHint(); }); });
  function saveHint() {
    $("#save-hint").textContent = RI.cfg.guardar === "folder"
      ? "Al pulsar «Dividir y renombrar» eliges la carpeta; los archivos se guardan ahí directamente."
      : "Se descarga un .zip con todos los archivos a tu carpeta de Descargas." +
        (canPickFolder ? "" : " (Guardar en una carpeta solo funciona en Chrome y Edge.)");
  }
  saveHint();

  // Archivos
  $("#drop").addEventListener("click", addPdfsDialog);
  $("#drop").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); addPdfsDialog(); } });
  $("#add-pdfs").addEventListener("click", addPdfsDialog);
  $("#clear-pdfs").addEventListener("click", () => { RI.pdfs = []; RI.done = false; bus.emit("pdfs"); });
  async function addPdfsDialog() { await RI.addPdfs(await pickFiles($("#file-input"))); }

  function renderFiles() {
    const body = $("#files-body");
    body.innerHTML = "";
    RI.pdfs.forEach((p, i) => body.append(el("tr", {},
      el("td", { text: p.name, title: p.name }), el("td", { class: "num", text: p.models.length }),
      el("td", { class: "num" }, el("button", { class: "btn small", text: "Quitar", "aria-label": "Quitar " + p.name,
        onclick: () => { RI.pdfs.splice(i, 1); RI.done = false; bus.emit("pdfs"); } })))));
    $("#drop").hidden = RI.pdfs.length > 0;
    $("#files-box").hidden = RI.pdfs.length === 0;
  }

  // Vista previa
  let timer = null, selected = 0;
  function changed() {
    RI.cfg.plantilla = tplIn.value;
    RI.cfg.formato_nombre = caseSel.value;
    RI.cfg.formato = fmtSel.value;
    RI.cfg.unir_paginas_consecutivas = $("#merge").checked;
    RI.saveCfg();
    clearTimeout(timer);
    timer = setTimeout(render, 200);
  }
  function render() {
    const manual = new Map(RI.items.filter(it => it.manual).map(it => [it.pdf + ":" + it.pages.join(","), it.name]));
    RI.items = core.buildPlan(RI.pdfs, RI.cfg, RI.formats);
    for (const it of RI.items) {
      const k = it.pdf + ":" + it.pages.join(",");
      if (manual.has(k)) { it.name = manual.get(k); it.manual = true; }
    }
    const body = $("#preview-body");
    body.innerHTML = "";
    let warn = 0, nofmt = 0;
    RI.items.forEach((it, idx) => {
      const sinDatos = it.vars._sin_datos && !it.manual;
      if (sinDatos) { warn++; if (it.vars._sin_formato) nofmt++; }
      const nameTd = el("td", { class: "name", text: it.name + ".pdf", title: "Clic para cambiar el nombre", style: { cursor: "text" } });
      nameTd.addEventListener("click", e => { e.stopPropagation(); editName(it, nameTd); });
      const tr = el("tr", { class: [sinDatos ? "warn" : "", it.manual ? "manual" : "", idx === selected ? "sel" : ""].join(" "),
        onclick: () => { selected = idx; $$("#preview-body tr").forEach((r, j) => r.classList.toggle("sel", j === idx)); showVars(); } },
      nameTd, el("td", { text: RI.pdfs[it.pdf].name }), el("td", { class: "num", text: it.pages.map(p => p + 1).join(",") }),
      el("td", { text: it.vars.formato || "no reconocido" }));
      body.append(tr);
    });
    $("#preview-empty").hidden = RI.items.length > 0;
    const first = RI.items.find(it => !it.vars._sin_datos);
    $("#example").textContent = first ? `Ejemplo: ${first.name}.pdf`
      : presetSel.value === PRESETS[0][1] ? "Ejemplo: Perez Lopez Ana - INGB-T4 - Eval 1.pdf" : "";
    // datos disponibles para la plantilla
    const forced = RI.formats.find(f => f.nombre === RI.cfg.formato);
    const used = new Set(RI.items.map(it => it.vars.formato).filter(Boolean));
    const fmts = forced ? [forced] : (RI.formats.filter(f => used.has(f.nombre)).length ? RI.formats.filter(f => used.has(f.nombre)) : RI.formats);
    const names = core.formatVarNames(fmts);
    for (const x of ["estudiante", "apellidos", "nombres", "pagina2", "archivo"]) if (!names.includes(x)) names.push(x);
    const av = $("#add-var");
    av.innerHTML = "";
    av.append(el("option", { value: "", text: "elige…" }), ...names.map(n => el("option", { value: n, text: n })));
    // estado
    const pages = RI.pdfs.reduce((a, p) => a + p.models.length, 0);
    const msgs = [];
    let isWarn = false;
    if (!RI.pdfs.length) msgs.push("Empieza agregando tus PDFs: arrástralos a la página o haz clic en el recuadro.");
    else msgs.push(`${pages} página(s) → ${RI.items.length} archivo(s).`);
    if (nofmt) { msgs.push(`⚠ ${nofmt} página(s) de un tipo de PDF que no se reconoce: usa «Formatos de PDF».`); isWarn = true; }
    if (warn - nofmt) { msgs.push(`⚠ ${warn - nofmt} sin nombre de estudiante (en amarillo).`); isWarn = true; }
    const names2 = RI.items.map(i => i.name.toLowerCase());
    const dups = names2.length - new Set(names2).size;
    if (dups > 0) msgs.push(`${dups} nombre(s) repetido(s): se agregará (2), (3)…`);
    const st = $("#split-status");
    st.textContent = msgs.join("  ");
    st.classList.toggle("warn", isWarn);
    const run = $("#run");
    run.disabled = !RI.items.length;
    run.textContent = RI.items.length ? `Dividir y renombrar (${RI.items.length})` : "Dividir y renombrar";
    setSteps($("#split-steps"), STEPS, RI.done ? 3 : RI.items.length ? 1 : 0);
    if (selected >= RI.items.length) selected = 0;
    showCustom(!presetSel.value);
    showVars();
  }
  function showVars() {
    const body = $("#vars-body");
    body.innerHTML = "";
    const it = RI.items[selected];
    if (!it) return;
    for (const [k, v] of Object.entries(it.vars)) {
      if (k.startsWith("_")) continue;
      body.append(el("tr", { class: "clickable", title: "Agregar {" + k + "} a la plantilla", onclick: () => insertVar(k) },
        el("td", { class: "accent", text: "{" + k + "}" }), el("td", { text: v })));
    }
  }
  function editName(it, td) {
    const inp = el("input", { type: "text", class: "inline", value: it.name });
    td.textContent = "";
    td.append(inp);
    inp.focus(); inp.select();
    let finished = false;
    const done = save => {
      if (finished) return;
      finished = true;
      if (save && inp.value.trim()) { it.name = core.sanitize(inp.value); it.manual = true; }
      render();
    };
    inp.addEventListener("keydown", e => { if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); });
    inp.addEventListener("blur", () => done(true));
    inp.addEventListener("click", e => e.stopPropagation());
  }

  // Ejecutar
  $("#run").addEventListener("click", run);
  document.addEventListener("keydown", e => {
    if (e.ctrlKey && e.key === "Enter" && $("#view-split").classList.contains("active")) { e.preventDefault(); run(); }
    if (e.ctrlKey && (e.key === "o" || e.key === "O") && $("#view-split").classList.contains("active")) { e.preventDefault(); addPdfsDialog(); }
  });

  async function run() {
    if (!RI.items.length) return;
    const warn = RI.items.filter(it => it.vars._sin_datos && !it.manual).length;
    if (warn && !(await confirmBox("Faltan nombres", `${warn} archivo(s) no tienen el nombre del estudiante (filas amarillas) ` +
        "y se guardarán con el nombre del PDF y la página.\n\n¿Continuar de todas formas?"))) return;
    const btn = $("#run");
    btn.disabled = true;
    btn.textContent = "Dividiendo…";
    try {
      const libs = {};
      const taken = new Set(), outputs = [];
      for (const it of RI.items) {
        if (!libs[it.pdf]) libs[it.pdf] = await ops.loadLib(RI.pdfs[it.pdf].bytes);
        const bytes = await ops.extractPages(libs[it.pdf], it.pages);
        const name = core.uniqueName(core.sanitize(it.name) || "sin_nombre", taken) + ".pdf";
        outputs.push({ name: name, bytes: bytes, vars: it.vars });
      }
      RI.outputs = outputs;
      const msg = await saveFiles(outputs, RI.cfg.guardar, "RenameIt - divididos.zip");
      if (msg === null) { toast("No se eligió carpeta: no se guardó nada."); return; }
      RI.done = true;
      render();
      doneDialog(outputs, msg);
    } catch (e) {
      UI.alertBox("Ocurrió un error", String(e.message || e));
    } finally {
      btn.disabled = !RI.items.length;
      btn.textContent = `Dividir y renombrar (${RI.items.length})`;
    }
  }

  function doneDialog(outputs, msg) {
    const body = el("div", {},
      el("div", { class: "row", style: { alignItems: "flex-start", gap: "14px" } },
        el("div", { class: "done-icon", text: "✓" }),
        el("div", { class: "grow" }, el("h2", { text: `Se crearon ${outputs.length} archivo(s)` }), el("p", { class: "muted", text: msg, style: { margin: "2px 0 0" } }))),
      el("p", { style: { margin: "16px 0 0", fontWeight: "600" }, text: "¿Qué quieres hacer ahora?" }));
    const list = el("div", { class: "choice-list" });
    const m = modal({ body: body, actions: [{ text: "Cerrar" }] });
    const go = fn => () => { m.close(); fn(); };
    list.append(
      el("button", { class: "btn big primary", text: "Enviarlos a Google Classroom",
        onclick: go(() => { bus.emit("to-classroom", { files: outputs, kind: "eval" }); showView("classroom"); }) }),
      el("button", { class: "btn big outline", text: "Crear alertas académicas", onclick: go(() => showView("alerts")) }),
      el("button", { class: "btn big", text: "Descargar otra vez (.zip)",
        onclick: go(() => saveFiles(outputs, "zip", "RenameIt - divididos.zip")) }));
    body.append(list);
  }

  bus.on("pdfs", () => { renderFiles(); render(); });
  bus.on("formats", () => { fillFormatSelect(); render(); });

  fillFormatSelect();
  syncPreset();
  renderFiles();
  render();
  // La vista inicial se muestra cuando ya cargaron todos los scripts (classroom, alertas, formatos).
  document.addEventListener("DOMContentLoaded", () => {
    const start = (location.hash || "#split").slice(1);
    showView(["split", "classroom", "alerts", "formats", "help"].includes(start) ? start : "split");
  });
})();
