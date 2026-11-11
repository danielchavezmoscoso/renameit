/* RenameIt web - vista «Formatos de PDF» (editor visual). */
(function () {
  "use strict";
  const { $, el, bus, modal, toast, confirmBox, alertBox, readFile, pickFiles, download } = UI;
  const core = RenameItCore, ops = RenameItPdf;
  const PALETTE = ["#0a2463", "#d62828", "#16a34a", "#b35900", "#6c757d", "#0a7c86", "#7c3aed"];
  const S = { cur: -1, work: null, dirty: false, sample: null, page: 0, scale: 1, fieldSel: -1 };
  const copy = o => JSON.parse(JSON.stringify(o));

  // ------------------------------------------------------------------ lista
  function renderList() {
    const box = $("#f-list");
    box.innerHTML = "";
    RI.formats.forEach((f, i) => box.append(el("div", { class: i === S.cur ? "sel" : "", text: f.nombre, onclick: () => select(i) })));
  }
  async function select(i) {
    if (i === S.cur) return;
    if (S.dirty && !(await confirmBox("Cambios sin guardar", `¿Descartar los cambios en «${S.work.nombre}»?`, "Descartar"))) return;
    S.cur = i;
    S.work = i >= 0 ? core.normFormat(copy(RI.formats[i])) : null;
    S.dirty = false;
    fillForm();
    renderList();
  }
  function uniqueName(name) {
    const names = new Set(RI.formats.map(f => f.nombre.toLowerCase()));
    let c = name, k = 2;
    while (names.has(c.toLowerCase())) c = `${name} ${k++}`;
    return c;
  }
  $("#f-new").addEventListener("click", () => {
    const body = el("div"), inp = el("input", { type: "text", placeholder: "Ej.: CBA Kids - Report card", style: { width: "100%" } });
    body.append(el("p", { text: "Nombre del nuevo formato:" }), inp);
    modal({ title: "Nuevo formato", body: body, actions: [{ text: "Cancelar" }, { text: "Crear", cls: "primary", onClick: () => {
      if (!inp.value.trim()) return false;
      RI.formats.push(core.normFormat({ nombre: uniqueName(inp.value.trim()) }));
      RI.saveFormats(); S.dirty = false; S.cur = -2; select(RI.formats.length - 1);
    } }] });
  });
  $("#f-dup").addEventListener("click", () => {
    if (S.cur < 0) return;
    const f = copy(RI.formats[S.cur]); f.nombre = uniqueName(f.nombre + " (copia)");
    RI.formats.push(f); RI.saveFormats(); S.dirty = false; select(RI.formats.length - 1);
  });
  $("#f-del").addEventListener("click", async () => {
    if (S.cur < 0) return;
    if (!(await confirmBox("Eliminar formato", `¿Eliminar el formato «${RI.formats[S.cur].nombre}»?\nEsto no se puede deshacer (salvo que lo hayas exportado).`, "Eliminar"))) return;
    RI.formats.splice(S.cur, 1); RI.saveFormats(); S.dirty = false; S.cur = -2;
    select(RI.formats.length ? 0 : -1);
  });
  $("#f-import").addEventListener("click", async () => importFiles(await pickFiles($("#f-file"))));
  async function importFiles(files) {
    let last = -1;
    for (const f of files.filter(x => /\.json$/i.test(x.name))) {
      try {
        const d = JSON.parse(new TextDecoder().decode(await readFile(f)));
        if (!d || !Array.isArray(d.campos)) throw new Error("no es un formato de RenameIt");
        d.nombre = uniqueName(String(d.nombre || core.stem(f.name)));
        RI.formats.push(core.normFormat(d)); last = RI.formats.length - 1;
      } catch (e) { alertBox("Importar", `${f.name}: ${e.message || e}`); }
    }
    if (last >= 0) { RI.saveFormats(); S.dirty = false; S.cur = -2; select(last); toast("Formato importado."); }
  }
  $("#f-export").addEventListener("click", () => {
    if (S.cur < 0) return;
    const f = S.dirty ? S.work : RI.formats[S.cur];
    download(core.sanitize(f.nombre) + ".json", new Blob([JSON.stringify(f, null, 2)], { type: "application/json" }));
  });

  // ------------------------------------------------------------------ formulario
  const orderSel = $("#f-order");
  core.NAME_ORDERS.forEach(o => orderSel.append(new Option(o, o)));
  function fillForm() {
    const w = S.work, on = !!w;
    for (const id of ["#f-name", "#f-desc", "#f-detect", "#f-student", "#f-order", "#f-tpl", "#f-save"]) $(id).disabled = !on;
    $("#f-name").value = on ? w.nombre : "";
    $("#f-desc").value = on ? w.descripcion || "" : "";
    $("#f-detect").value = on ? (w.detectar || []).join("\n") : "";
    $("#f-order").value = on ? w.orden_nombre : core.NAME_ORDERS[0];
    $("#f-tpl").value = on ? w.plantilla || "" : "";
    renderFields();
  }
  function formChanged() {
    if (!S.work) return;
    S.work.nombre = $("#f-name").value.trim();
    S.work.descripcion = $("#f-desc").value.trim();
    S.work.detectar = $("#f-detect").value.split("\n").map(s => s.trim()).filter(Boolean);
    S.work.campo_estudiante = $("#f-student").value;
    S.work.orden_nombre = $("#f-order").value;
    S.work.plantilla = $("#f-tpl").value;
    S.dirty = true;
    status();
  }
  for (const id of ["#f-name", "#f-desc", "#f-detect", "#f-tpl"]) $(id).addEventListener("input", formChanged);
  for (const id of ["#f-student", "#f-order"]) $(id).addEventListener("change", formChanged);

  function sampleModel() { return S.sample ? S.sample.models[S.page] : null; }
  function renderFields() {
    const tb = $("#f-fields");
    tb.innerHTML = "";
    const w = S.work;
    const sel = $("#f-student");
    sel.innerHTML = "";
    if (!w) { status(); drawMarks(); return; }
    const m = sampleModel();
    const vals = m ? core.extractFields(m, w.campos, S.sample.name).vals : {};
    w.campos.forEach((c, i) => {
      const [tipo, donde] = describe(c);
      tb.append(el("tr", { class: "clickable " + (i === S.fieldSel ? "sel" : ""), onclick: () => { S.fieldSel = i; renderFields(); },
        ondblclick: () => editField(i) },
      el("td", { class: "accent", text: c.nombre }), el("td", { text: tipo }), el("td", { text: donde }), el("td", { text: m ? vals[c.nombre] || "" : "" })));
    });
    w.campos.forEach(c => sel.append(new Option(c.nombre, c.nombre)));
    if (w.campo_estudiante && !w.campos.some(c => c.nombre === w.campo_estudiante)) sel.append(new Option(w.campo_estudiante, w.campo_estudiante));
    sel.value = w.campo_estudiante || "";
    status();
    drawMarks();
  }
  function describe(c) {
    const t = c.tipo;
    let where = "";
    if (t === "derecha_de" || t === "debajo_de") where = `«${c.etiqueta || ""}»`;
    else if (t === "zona") where = "zona " + (c.zona || []).map(x => (+x).toFixed(2)).join(" ");
    else if (t === "regex") where = c.patron || "";
    else if (t === "de_campo") where = `{${c.campo || ""}}  ${c.patron || ""}`;
    else if (t === "del_archivo") where = c.patron || "(nombre completo)";
    else if (t === "fijo") where = `«${c.valor || ""}»`;
    return [core.FIELD_TYPES[t] || t, where];
  }
  function status() {
    const w = S.work, m = sampleModel(), st = $("#f-status");
    if (!w) { st.textContent = RI.formats.length ? "" : "No hay formatos. Usa «Nuevo»."; return; }
    if (!m) { st.textContent = (S.dirty ? "Cambios sin guardar. " : "") + "Abre un PDF de muestra para probar el formato."; return; }
    const { vars } = core.pageVars(m, S.sample.name, S.page + 1, [], w);
    const name = core.renderTemplate(w.plantilla || RI.cfg.plantilla, vars, RI.cfg.formato_nombre);
    const ok = core.detectFormat(m.text, [w]);
    const state = !w.detectar.length ? "sin textos para reconocer: solo se usa si lo eliges a mano"
      : ok ? "✓ reconoce esta página" : "✗ no reconoce esta página (revisa los textos)";
    st.textContent = `${S.dirty ? "Cambios sin guardar · " : ""}${state} · Estudiante: ${vars.apellidos || ""} | ${vars.nombres || ""} · Nombre: ${name}.pdf`;
  }

  // campos
  $("#f-field-add").addEventListener("click", () => editField(-1, { tipo: "derecha_de" }));
  $("#f-field-edit").addEventListener("click", () => { if (S.fieldSel >= 0) editField(S.fieldSel); });
  $("#f-field-del").addEventListener("click", () => { if (S.work && S.fieldSel >= 0) { S.work.campos.splice(S.fieldSel, 1); S.fieldSel = -1; S.dirty = true; renderFields(); } });
  for (const [id, d] of [["#f-field-up", -1], ["#f-field-down", 1]]) $(id).addEventListener("click", () => {
    const c = S.work && S.work.campos, i = S.fieldSel, j = i + d;
    if (!c || i < 0 || j < 0 || j >= c.length) return;
    [c[i], c[j]] = [c[j], c[i]]; S.fieldSel = j; S.dirty = true; renderFields();
  });

  function editField(idx, preset) {
    if (!S.work) { toast("Primero crea o elige un formato."); return; }
    const f = Object.assign({}, idx >= 0 ? S.work.campos[idx] : preset);
    const others = S.work.campos.filter((_, i) => i !== idx).map(c => c.nombre);
    const name = el("input", { type: "text", value: f.nombre || "" });
    const tipo = el("select"); Object.entries(core.FIELD_TYPES).forEach(([k, v]) => tipo.append(new Option(v, k))); tipo.value = f.tipo || "derecha_de";
    const dyn = el("div", { class: "field-grid", style: { marginTop: "8px" } });
    const preview = el("p", { class: "accent", style: { fontWeight: "600" } });
    const inputs = {};
    function build() {
      dyn.innerHTML = "";
      const t = tipo.value;
      const add = (label, key, hint, opts) => {
        const i = opts && opts.list ? el("input", { type: "text", value: f[key] || "", list: "f-dl" }) : el("input", { type: "text", value: f[key] || "", class: opts && opts.mono ? "mono" : "" });
        i.addEventListener("input", upd); inputs[key] = i;
        dyn.append(el("span", { text: label }), i);
        if (hint) dyn.append(el("span"), el("span", { class: "hint", text: hint }));
      };
      for (const k in inputs) delete inputs[k];
      if (t === "derecha_de" || t === "debajo_de") add("Etiqueta impresa:", "etiqueta", "El texto fijo junto al dato, p. ej. STUDENT o Nombre:.");
      else if (t === "zona") {
        const z = f.zona || [0.1, 0.1, 0.5, 0.2];
        ["izq.", "arriba", "der.", "abajo"].forEach((lab, i) => { const k = "z" + i; f[k] = (+z[i]).toFixed(3); add(lab + ":", k); });
        dyn.append(el("span"), el("span", { class: "hint", text: "Más fácil: cierra y arrastra un rectángulo sobre la página de muestra." }));
      } else if (t === "regex") add("Patrón:", "patron", "Se usa lo que esté entre paréntesis. Ej.: Unidad\\s+(\\d+)", { mono: true });
      else if (t === "de_campo") {
        add("Tomar de:", "campo", "", { list: true });
        add("Patrón:", "patron", "Ej.: \\(([^)]+)\\) toma lo que está entre ( ).", { mono: true });
        const ch = el("input", { type: "checkbox" }); ch.checked = f.si_no === "todo"; inputs.si_no = ch; ch.addEventListener("change", upd);
        dyn.append(el("span"), el("label", { class: "check" }, ch, "Si el patrón no coincide, usar el campo completo"));
      } else if (t === "del_archivo") add("Patrón (opcional):", "patron", "Vacío = todo el nombre del archivo. Ej.: Eval\\s*(\\d+)", { mono: true });
      else if (t === "fijo") add("Valor:", "valor");
      dyn.append(el("datalist", { id: "f-dl" }, others.map(o => el("option", { value: o }))));
      upd();
    }
    function current() {
      const t = tipo.value, out = { nombre: name.value.trim(), tipo: t };
      if (t === "derecha_de" || t === "debajo_de") out.etiqueta = inputs.etiqueta.value.trim();
      else if (t === "zona") out.zona = [0, 1, 2, 3].map(i => Math.min(1, Math.max(0, parseFloat(inputs["z" + i].value) || 0)));
      else if (t === "regex" || t === "del_archivo") out.patron = inputs.patron.value;
      else if (t === "de_campo") { out.campo = inputs.campo.value.trim(); out.patron = inputs.patron.value; if (inputs.si_no.checked) out.si_no = "todo"; }
      else if (t === "fijo") out.valor = inputs.valor.value;
      return out;
    }
    function upd() {
      const c = current();
      if (c.patron) { try { new RegExp(c.patron); } catch (e) { preview.textContent = "Patrón inválido: " + e.message; return; } }
      const m = sampleModel();
      if (!m) { preview.textContent = "(abre un PDF de muestra para ver el valor)"; return; }
      const fields = S.work.campos.slice();
      if (idx >= 0) fields[idx] = c; else fields.push(c);
      preview.textContent = "Valor en la muestra: " + (core.extractFields(m, fields, S.sample.name).vals[c.nombre] || "(vacío)");
    }
    tipo.addEventListener("change", build);
    name.addEventListener("input", upd);
    const body = el("div", {}, el("div", { class: "field-grid" }, el("span", { text: "Nombre (para la plantilla):" }), name,
      el("span", { text: "Cómo encontrarlo:" }), tipo), dyn, preview);
    build();
    modal({ title: "Campo", body: body, wide: true, actions: [{ text: "Cancelar" }, { text: "Aceptar", cls: "primary", onClick: () => {
      const c = current();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.nombre)) { toast("El nombre debe ser una sola palabra sin tildes ni espacios (p. ej. estudiante, eval)."); return false; }
      if (others.includes(c.nombre)) { toast(`Ya hay un campo llamado «${c.nombre}».`); return false; }
      if (c.patron) { try { new RegExp(c.patron); } catch (e) { toast("El patrón no es válido."); return false; } }
      if (idx >= 0) {
        if (S.work.campo_estudiante === S.work.campos[idx].nombre) S.work.campo_estudiante = c.nombre;
        S.work.campos[idx] = c; S.fieldSel = idx;
      } else {
        S.work.campos.push(c); S.fieldSel = S.work.campos.length - 1;
        if (S.work.campos.length === 1 && !S.work.campo_estudiante) S.work.campo_estudiante = c.nombre;
      }
      S.dirty = true; renderFields();
    } }] });
  }

  $("#f-save").addEventListener("click", () => {
    const w = S.work;
    if (!w) return;
    if (!w.nombre) { toast("Ponle un nombre al formato."); return; }
    if (RI.formats.some((f, i) => i !== S.cur && f.nombre.toLowerCase() === w.nombre.toLowerCase())) { toast(`Ya existe un formato llamado «${w.nombre}».`); return; }
    const old = RI.formats[S.cur].nombre;
    RI.formats[S.cur] = copy(w);
    if (RI.cfg.formato === old && old !== w.nombre) { RI.cfg.formato = w.nombre; RI.saveCfg(); }
    S.dirty = false;
    RI.saveFormats();
    renderList(); status();
    toast("Formato guardado en este navegador.");
  });

  // ------------------------------------------------------------------ muestra
  $("#f-open").addEventListener("click", async () => openSample((await pickFiles($("#f-sample-file")))[0]));
  bus.on("formats-drop", files => {
    const pdf = files.find(f => /\.pdf$/i.test(f.name)), js = files.filter(f => /\.json$/i.test(f.name));
    if (js.length) importFiles(js);
    if (pdf) openSample(pdf);
  });
  async function openSample(file, bytes, name, page) {
    if (!file && !bytes) return;
    try {
      bytes = bytes || await readFile(file);
      const r = await ops.readPdf(bytes);
      S.sample = { name: name || file.name, doc: r.doc, models: r.models };
      S.page = page || 0;
      await drawPage();
      if (S.cur >= 0 && !S.dirty) {
        const det = core.detectFormat(r.models[S.page].text, RI.formats);
        if (det) await select(RI.formats.indexOf(det));
      }
      renderFields();
    } catch (e) { alertBox("Muestra", "No se pudo abrir el PDF: " + (e.message || e)); }
  }
  $("#f-prev").addEventListener("click", () => goPage(-1));
  $("#f-next").addEventListener("click", () => goPage(1));
  async function goPage(d) {
    if (!S.sample) return;
    const n = S.page + d;
    if (n < 0 || n >= S.sample.models.length) return;
    S.page = n; await drawPage(); renderFields();
  }

  let layer = null;
  async function drawPage() {
    const box = $("#f-sample");
    box.innerHTML = "";
    const page = await S.sample.doc.getPage(S.page + 1);
    const base = page.getViewport({ scale: 1 });
    const width = Math.max(box.clientWidth - 24, 260);
    S.scale = width / base.width;
    const vp = page.getViewport({ scale: S.scale * (window.devicePixelRatio || 1) });
    const canvas = el("canvas");
    canvas.width = vp.width; canvas.height = vp.height;
    canvas.style.width = width + "px"; canvas.style.height = base.height * S.scale + "px";
    // intent "print": dibuja sin esperar al refresco de pantalla (así funciona también con la pestaña en segundo plano)
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp, intent: "print" }).promise;
    layer = el("div", { class: "layer", style: { width: width + "px", height: base.height * S.scale + "px" } });
    box.append(canvas, layer);
    $("#f-page").textContent = `${S.page + 1} / ${S.sample.models.length}`;
    const det = core.detectFormat(S.sample.models[S.page].text, RI.formats);
    $("#f-detected").textContent = det ? "Esta página se reconoce como: " + det.nombre : "Esta página no coincide con ningún formato guardado.";
    bindLayer();
    drawMarks();
  }
  function drawMarks() {
    if (!layer) return;
    layer.querySelectorAll(".mark").forEach(x => x.remove());
    const m = sampleModel();
    if (!m || !S.work) return;
    const { rects } = core.extractFields(m, S.work.campos, S.sample.name);
    const selName = S.work.campos[S.fieldSel] && S.work.campos[S.fieldSel].nombre;
    Object.entries(rects).forEach(([name, r], k) => {
      const color = PALETTE[k % PALETTE.length];
      const d = el("div", { class: "mark", style: { left: (r.x0 * S.scale - 2) + "px", top: (r.y0 * S.scale - 1) + "px",
        width: ((r.x1 - r.x0) * S.scale + 4) + "px", height: ((r.y1 - r.y0) * S.scale + 2) + "px", borderColor: color,
        borderWidth: name === selName ? "3px" : "2px" } }, el("span", { text: name, style: { color: color } }));
      layer.append(d);
    });
  }
  function spanAt(x, y) {
    const m = sampleModel();
    const px = x / S.scale, py = y / S.scale;
    return m.spans.find(s => px >= s.x0 - 1 && px <= s.x1 + 1 && py >= s.y0 - 1 && py <= s.y1 + 1) || null;
  }
  function bindLayer() {
    let hover = null, drag = null, rect = null;
    const pos = e => { const b = layer.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
    layer.addEventListener("mousemove", e => {
      const [x, y] = pos(e);
      if (drag) {
        const [x0, y0] = drag;
        if (!rect && (Math.abs(x - x0) > 6 || Math.abs(y - y0) > 6)) { rect = el("div", { class: "drag-rect" }); layer.append(rect); }
        if (rect) Object.assign(rect.style, { left: Math.min(x, x0) + "px", top: Math.min(y, y0) + "px", width: Math.abs(x - x0) + "px", height: Math.abs(y - y0) + "px" });
        return;
      }
      const s = spanAt(x, y);
      if (!hover) { hover = el("div", { class: "hover-span" }); layer.append(hover); }
      hover.hidden = !s;
      if (s) Object.assign(hover.style, { left: (s.x0 * S.scale - 2) + "px", top: (s.y0 * S.scale - 2) + "px",
        width: ((s.x1 - s.x0) * S.scale + 4) + "px", height: ((s.y1 - s.y0) * S.scale + 4) + "px" });
    });
    layer.addEventListener("mouseleave", () => { if (hover) hover.hidden = true; });
    layer.addEventListener("mousedown", e => { if (e.button === 0) { drag = pos(e); e.preventDefault(); } });
    window.addEventListener("mouseup", e => {
      if (!drag) return;
      const [x0, y0] = drag, [x1, y1] = pos(e);
      drag = null;
      if (rect) {
        rect.remove(); rect = null;
        if (!S.work) { toast("Primero crea o elige un formato (botón «Nuevo»)."); return; }
        const m = sampleModel(), W = m.width * S.scale, H = m.height * S.scale;
        const cl = v => Math.min(1, Math.max(0, v));
        const z = [cl(Math.min(x0, x1) / W), cl(Math.min(y0, y1) / H), cl(Math.max(x0, x1) / W), cl(Math.max(y0, y1) / H)].map(v => Math.round(v * 10000) / 10000);
        editField(-1, { tipo: "zona", zona: z, nombre: S.work.campos.some(c => c.nombre === "estudiante") ? "" : "estudiante" });
        return;
      }
      if (e.target !== layer && !layer.contains(e.target)) return;
      const s = spanAt(x1, y1);
      if (s) spanMenu(s.str, e.clientX, e.clientY);
    });
  }
  function suggest(text) {
    const t = core.fold(text);
    const guesses = [["student", "estudiante"], ["alumno", "estudiante"], ["estudiante", "estudiante"], ["nombre", "estudiante"],
      ["name", "estudiante"], ["teacher", "docente"], ["docente", "docente"], ["module", "modulo"], ["course", "curso"],
      ["curso", "curso"], ["level", "nivel"], ["nivel", "nivel"], ["date", "fecha"], ["fecha", "fecha"], ["schedule", "horario"],
      ["horario", "horario"], ["unit", "unidad"], ["unidad", "unidad"]];
    const have = S.work.campos.map(c => c.nombre);
    for (const [k, n] of guesses) if (t.includes(k) && !have.includes(n)) return n;
    return t.replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 20) || "campo";
  }
  function spanMenu(text, x, y) {
    document.querySelectorAll(".popmenu").forEach(p => p.remove());
    if (!S.work) { toast("Primero crea o elige un formato (botón «Nuevo»)."); return; }
    const short = text.length > 40 ? text.slice(0, 37) + "…" : text;
    const menu = el("div", { class: "popmenu", style: { left: Math.min(x, innerWidth - 300) + "px", top: Math.min(y, innerHeight - 160) + "px" } },
      el("div", { class: "label", text: `«${short}»` }),
      el("div", { text: "Es una etiqueta: el dato está a su DERECHA…", onclick: () => { close(); editField(-1, { tipo: "derecha_de", etiqueta: text, nombre: suggest(text) }); } }),
      el("div", { text: "Es una etiqueta: el dato está DEBAJO…", onclick: () => { close(); editField(-1, { tipo: "debajo_de", etiqueta: text, nombre: suggest(text) }); } }),
      el("div", { text: "Usar este texto para reconocer el formato", onclick: () => {
        close();
        const lines = $("#f-detect").value.split("\n").map(s => s.trim()).filter(Boolean);
        if (!lines.includes(text)) { lines.push(text); $("#f-detect").value = lines.join("\n"); formChanged(); }
      } }));
    function close() { menu.remove(); document.removeEventListener("mousedown", outside, true); }
    function outside(e) { if (!menu.contains(e.target)) close(); }
    document.body.append(menu);
    setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
  }

  bus.on("view", async v => {
    if (v !== "formats") return;
    if (S.cur < 0 && RI.formats.length) { S.cur = -2; await select(0); }
    if (!S.sample && RI.pdfs.length) await openSample(null, RI.pdfs[0].bytes, RI.pdfs[0].name, 0);
    else if (S.sample) await drawPage();
  });
  bus.on("formats", () => { renderList(); });
  renderList();
  fillForm();
})();
