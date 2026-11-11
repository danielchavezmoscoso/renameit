/* RenameIt web - vista «Alertas académicas». */
(function () {
  "use strict";
  const { $, $$, el, store, bus, modal, toast, alertBox, confirmBox, idbGet, idbSet, readFile, pickFiles, saveFiles } = UI;
  const core = RenameItCore, ops = RenameItPdf;
  const today = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; };
  const P = Object.assign({ virtual: false, menor: false, docente: "", contacto: "", atencion: "",
    intro: "Resultados de la evaluación {eval}:", ignoreZero: false, obs: false,
    nombre: "{apellidos} {nombres} - {curso} - Alerta academica",
    rules: JSON.parse(JSON.stringify(core.DEFAULT_RULES)) }, store.get("alerts", {}));
  const S = { alerts: [], templates: [], extra: [] };
  const save = () => store.set("alerts", P);
  const blankGrades = () => ({ skills: {}, speaking: null, general: null, ausencias: null, trabajo: "", conducta: "", observaciones: "" });

  // ------------------------------------------------------------------ ajustes
  $$('input[name="a-mod"]').forEach(r => { r.checked = (r.value === "1") === !!P.virtual; r.addEventListener("change", () => { P.virtual = r.value === "1"; save(); recompute(); }); });
  $$('input[name="a-age"]').forEach(r => { r.checked = (r.value === "1") === !!P.menor; r.addEventListener("change", () => { P.menor = r.value === "1"; save(); recompute(); }); });
  for (const [id, key] of [["#a-doc", "docente"], ["#a-contact", "contacto"], ["#a-hours", "atencion"]]) {
    $(id).value = P[key] || "";
    $(id).addEventListener("change", () => { P[key] = $(id).value.trim(); save(); });
  }
  $("#a-date").value = today();
  $("#a-obs").checked = !!P.obs;
  $("#a-obs").addEventListener("change", () => { P.obs = $("#a-obs").checked; save(); recompute(); });

  // ------------------------------------------------------------------ formularios
  async function loadStoredTemplates() {
    const list = (await idbGet("templates")) || [];
    S.templates = [];
    for (const t of list) {
      try { const a = await ops.analyzeTemplate(t.name, t.bytes); if (a) S.templates.push({ t: a, bytes: t.bytes }); } catch (e) { /* ignorar */ }
    }
    showTemplates();
    recompute();
  }
  function showTemplates() {
    $("#a-tpls").textContent = S.templates.length ? `✓ ${S.templates.length} formulario(s) cargado(s)`
      : "⚠ Carga los formularios oficiales de alerta (solo la primera vez).";
    $("#a-tpls").className = "hint grow " + (S.templates.length ? "accent" : "warn-text");
  }
  $("#a-load-tpls").addEventListener("click", async () => {
    const files = await pickFiles($("#a-tpl-file"));
    if (!files.length) return;
    const keep = [], bad = [];
    for (const f of files) {
      const bytes = await readFile(f);
      try { const a = await ops.analyzeTemplate(f.name, bytes); if (a) keep.push({ name: f.name, bytes: bytes }); else bad.push(f.name); }
      catch (e) { bad.push(f.name); }
    }
    if (keep.length) { await idbSet("templates", keep); await loadStoredTemplates(); toast(`${keep.length} formulario(s) guardado(s) en este navegador.`); }
    if (bad.length) alertBox("Formularios", "Estos archivos no parecen formularios de alerta académica:\n" + bad.join("\n"));
  });
  function pickTemplate(a) {
    const kids = core.isKidsCourse(a.vars);
    const pool = S.templates.filter(x => x.t.kids === kids).length ? S.templates.filter(x => x.t.kids === kids) : S.templates;
    if (!pool.length) return null;
    const score = x => (x.t.virtual === !!P.virtual) * 2 + (kids || x.t.menor === !!P.menor ? 1 : 0);
    return pool.reduce((a, b) => (score(b) > score(a) ? b : a));
  }

  // ------------------------------------------------------------------ tarjetas
  function readCards() {
    const manual = S.alerts.filter(a => a.manual);
    const alerts = [];
    let skipped = 0;
    const sources = RI.pdfs.concat(S.extra);
    const forced = RI.formats.find(f => f.nombre === RI.cfg.formato) || null;
    for (const pdf of sources) {
      pdf.models.forEach((m, i) => {
        const g = core.readGrades(m);
        if (!core.hasGrades(g)) { skipped++; return; }
        const { vars } = core.pageVars(m, pdf.name, i + 1, RI.formats, forced);
        if (!vars.estudiante) { skipped++; return; }
        alerts.push(newAlert(vars, g));
      });
    }
    S.alerts = alerts.concat(manual);
    if (!P.docente) {
      const t = alerts.find(a => a.vars.docente);
      if (t) { P.docente = core.applyCase(t.vars.docente, "Tipo Título"); $("#a-doc").value = P.docente; save(); }
    }
    $("#a-src").textContent = sources.length ? `${alerts.length} tarjeta(s) con notas en ${sources.length} PDF(s).` +
      (skipped ? ` ${skipped} página(s) sin notas reconocibles.` : "") : "Carga las tarjetas en «Dividir y renombrar» o con «+ PDFs».";
    recompute();
  }
  function newAlert(vars, g) {
    return { vars: vars || {}, grades: g || blankGrades(), tpl: null, items: new Set(), reasons: [], create: false,
      edited: false, manual: !vars, student: "", tutor: "", course: "", schedule: "", comment: "", faltas: "" };
  }
  $("#a-use-main").addEventListener("click", () => { readCards(); if (!RI.pdfs.length) toast("No hay PDFs cargados en «Dividir y renombrar»."); });
  async function addExtra(files) {
    for (const f of files.filter(x => /\.pdf$/i.test(x.name))) {
      try { const bytes = await readFile(f); const { models } = await ops.readPdf(bytes); S.extra.push({ name: f.name, models: models }); }
      catch (e) { toast("No se pudo leer " + f.name); }
    }
    readCards();
  }
  $("#a-add").addEventListener("click", async () => addExtra(await pickFiles($("#a-file"))));
  bus.on("alerts-drop", addExtra);
  bus.on("pdfs", readCards);

  // ------------------------------------------------------------------ reglas → alerta
  function prepare(a) {
    if (a.edited) return;
    const pick = pickTemplate(a);
    a.tpl = pick;
    const t = pick && pick.t, v = a.vars;
    if (!a.manual) {
      a.student = core.fitName(core.applyCase(v.nombres || "", "Tipo Título"), core.applyCase(v.apellidos || "", "Tipo Título"),
        t ? (t.maxlen.student || 0) : 0);
      a.course = t ? core.matchOption(t, "course", v.curso || "") : (v.curso || "");
      a.schedule = t ? core.matchOption(t, "schedule", v.horario || "") : (v.horario || "");
      a.faltas = a.grades.ausencias === null ? "" : String(a.grades.ausencias);
    }
    const r = core.evaluate(a.grades, P.rules, P.ignoreZero);
    if (a.manual) return;
    a.items = r.items; a.reasons = r.reasons; a.create = r.reasons.length > 0;
    let c = "";
    if (r.parts.length) {
      const intro = P.intro.replace(/\{(\w+)\}/g, (m, k) => v[k] || "").trim();
      c = (intro ? intro + " " : "") + r.parts.join(" ");
    }
    if (P.obs && a.grades.observaciones) c = (c ? c + " " : "") + a.grades.observaciones;
    a.comment = c;
  }
  function recompute() { S.alerts.forEach(prepare); render(); rulesSummary(); }
  function rulesSummary() {
    const act = P.rules.filter(r => r.activa !== false);
    $("#a-rules").textContent = act.length ? "Se crea una alerta si:\n• " + act.map(core.describeRule).join("\n• ")
      : "No hay reglas activas: marca las alertas a mano.";
  }
  const itemOrder = k => core.ITEMS.findIndex(x => x[0] === k);

  function render() {
    const body = $("#a-body");
    body.innerHTML = "";
    S.alerts.forEach(a => {
      const g = a.grades, low = core.lowestMini(g);
      const cb = el("input", { type: "checkbox", "aria-label": "Crear alerta para " + a.student });
      cb.checked = a.create;
      cb.addEventListener("click", e => e.stopPropagation());
      cb.addEventListener("change", () => { a.create = cb.checked; a.edited = true; render(); });
      body.append(el("tr", { class: "clickable " + (a.create ? "warn" : "") + (a.edited || a.manual ? " manual" : ""),
        title: "Clic para revisar y editar", onclick: () => edit(a) },
      el("td", { class: "num" }, cb), el("td", { class: "name", text: a.student || a.vars.estudiante || "" }),
      el("td", { text: a.course || a.vars.curso || "" }), el("td", { class: "num", text: g.general ?? "" }),
      el("td", { class: "num", text: g.speaking ?? "" }),
      el("td", { text: low ? `${core.SKILL_NAMES[low[1]]} ${low[2].mini}/${low[2].max}` : "" }),
      el("td", { class: "num", text: g.ausencias ?? "" }),
      el("td", { text: [...a.items].sort((x, y) => itemOrder(x) - itemOrder(y)).map(k => core.ITEM_NAMES[k].split(" (")[0]).join(", ") }),
      el("td", { text: a.comment, style: { maxWidth: "360px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } })));
    });
    $("#a-empty").hidden = S.alerts.length > 0;
    const n = S.alerts.filter(a => a.create).length;
    const btn = $("#a-create");
    btn.disabled = !(n && S.templates.length);
    btn.textContent = n ? `Crear ${n} alerta(s)` : "Crear alertas";
    const st = $("#a-status");
    st.classList.toggle("warn", !S.templates.length);
    st.textContent = !S.templates.length ? "⚠ Falta cargar los formularios de alerta (paso 2)."
      : S.alerts.length ? `${n} alerta(s) para crear de ${S.alerts.length} estudiante(s).` : "";
  }

  // ------------------------------------------------------------------ editar una alerta
  function edit(a, isNew) {
    const t0 = a.tpl || S.templates[0];
    if (!t0) { alertBox("Alertas", "Primero carga los formularios de alerta (paso 2)."); return; }
    const g = a.grades;
    const box = el("div", { class: "stack" });
    const createCb = el("input", { type: "checkbox" }); createCb.checked = isNew ? true : a.create;
    box.append(el("label", { class: "check" }, createCb, "Crear esta alerta"));
    if (g.general !== null || Object.keys(g.skills).length) {
      const notas = [`General ${g.general ?? "—"}`, `Speaking ${g.speaking ?? "—"}`];
      for (const [k, d] of Object.entries(g.skills)) notas.push(`${core.SKILL_NAMES[k]}: mini ${d.mini ?? "—"}/${d.max}, overall ${d.overall ?? "—"}`);
      if (g.trabajo || g.conducta) notas.push(`Trabajo: ${g.trabajo || "—"} · Conducta: ${g.conducta || "—"}`);
      box.append(el("p", { class: "hint", text: "Notas de la tarjeta: " + notas.join(" · ") }));
      if (a.reasons.length) box.append(el("p", { text: "Motivo: " + a.reasons.join("; "), style: { color: "var(--red)", margin: "0" } }));
    }
    const tplSel = el("select");
    S.templates.forEach((x, i) => tplSel.append(new Option(x.t.title, i)));
    tplSel.value = String(S.templates.indexOf(t0));
    const inp = v => el("input", { type: "text", value: v || "" });
    const student = inp(a.student), tutor = inp(a.tutor), course = el("input", { type: "text", value: a.course, list: "a-dl-course" }),
      sched = el("input", { type: "text", value: a.schedule, list: "a-dl-sched" }), faltas = el("input", { type: "text", value: a.faltas, style: { width: "70px" } });
    const dlC = el("datalist", { id: "a-dl-course" }), dlS = el("datalist", { id: "a-dl-sched" });
    box.append(el("div", { class: "field-grid" },
      el("span", { text: "Formulario:" }), tplSel, el("span", { text: "Estudiante:" }), student,
      el("span", { text: "Señor(a) / tutor:" }), tutor, el("span", { text: "Módulo:" }), course,
      el("span", { text: "Horario:" }), sched), dlC, dlS);
    const checks = el("div", { class: "checks-grid" });
    box.append(el("div", { class: "card" }, el("h2", { text: "Precisa trabajar en" }), checks,
      el("div", { class: "row", style: { marginTop: "8px" } }, el("span", { text: "Faltas acumuladas:" }), faltas)));
    const ta = el("textarea", { rows: 4 }); ta.value = a.comment;
    const count = el("p", { class: "hint", style: { margin: "2px 0 0", textAlign: "right" } });
    box.append(el("span", { text: "Comentarios:" }), ta, count);
    let state = new Set(a.items);
    function build() {
      const t = S.templates[+tplSel.value].t;
      checks.innerHTML = "";
      Object.keys(t.checks).sort((x, y) => itemOrder(x) - itemOrder(y)).forEach(k => {
        const c = el("input", { type: "checkbox" }); c.checked = state.has(k);
        c.addEventListener("change", () => { if (c.checked) state.add(k); else state.delete(k); });
        checks.append(el("label", { class: "check" }, c, t.checkLabels[k] || core.ITEM_NAMES[k]));
      });
      dlC.innerHTML = ""; (t.options.course || []).filter(o => o.replace(/[.\s]/g, "")).forEach(o => dlC.append(el("option", { value: o })));
      dlS.innerHTML = ""; (t.options.schedule || []).filter(o => o.replace(/[.\s]/g, "")).forEach(o => dlS.append(el("option", { value: o })));
      cnt();
    }
    function cnt() {
      const ml = S.templates[+tplSel.value].t.maxlen.comments || 0, n = ta.value.trim().length;
      count.textContent = ml ? `${n}/${ml} caracteres` + (n > ml ? "  ⚠ se recortará" : "") : `${n} caracteres`;
    }
    tplSel.addEventListener("change", build);
    ta.addEventListener("input", cnt);
    build();
    modal({ title: isNew ? "Nueva alerta" : "Alerta académica", body: box, wide: true, actions: [
      { text: "Cancelar" },
      { text: "Aceptar", cls: "primary", onClick: () => {
        if (!student.value.trim()) { toast("Escribe el nombre del estudiante."); return false; }
        a.tpl = S.templates[+tplSel.value]; a.create = createCb.checked; a.student = student.value.trim();
        a.tutor = tutor.value.trim(); a.course = course.value.trim(); a.schedule = sched.value.trim(); a.faltas = faltas.value.trim();
        a.items = state; a.comment = ta.value.replace(/\s+/g, " ").trim(); a.edited = true;
        if (isNew && !S.alerts.includes(a)) S.alerts.push(a);
        render();
      } }] });
  }
  $("#a-manual").addEventListener("click", () => {
    if (!S.templates.length) { alertBox("Alertas", "Primero carga los formularios de alerta (paso 2)."); return; }
    const a = newAlert(null, null);
    a.tpl = pickTemplate(a);
    edit(a, true);
  });

  // ------------------------------------------------------------------ reglas
  $("#a-edit-rules").addEventListener("click", () => {
    let rules = JSON.parse(JSON.stringify(P.rules));
    const body = el("div");
    body.append(el("p", { class: "hint", text: "Se crea una alerta cuando se cumple al menos una regla activa. Las notas por destreza se comparan en porcentaje (14/20 = 70 %); la nota general y Speaking, sobre 100." }));
    const tb = el("tbody");
    body.append(el("div", { class: "table-wrap", style: { maxHeight: "50vh" } },
      el("table", {}, el("thead", {}, el("tr", {}, el("th", { class: "num", text: "Activa" }), el("th", { text: "Si…" }),
        el("th", { text: "Marca" }), el("th", { text: "Frase del comentario" }), el("th"))), tb)));
    const draw = () => {
      tb.innerHTML = "";
      rules.forEach((r, i) => {
        const on = el("input", { type: "checkbox" }); on.checked = r.activa !== false;
        on.addEventListener("change", () => { r.activa = on.checked; });
        tb.append(el("tr", {}, el("td", { class: "num" }, on), el("td", { text: core.describeRule(r) }),
          el("td", { text: (r.marcar || []).map(m => m === core.SKILL_FOR ? "la destreza" : core.ITEM_NAMES[m].split(" (")[0]).join(", ") }),
          el("td", { text: r.texto || "" }),
          el("td", {}, el("button", { class: "btn small", text: "Editar", onclick: () => editRule(r, x => { rules[i] = x; draw(); }) }), " ",
            el("button", { class: "btn small", text: "Quitar", onclick: () => { rules.splice(i, 1); draw(); } }))));
      });
    };
    draw();
    const intro = el("input", { type: "text", value: P.intro, style: { width: "100%" } });
    const zero = el("input", { type: "checkbox" }); zero.checked = !!P.ignoreZero;
    body.append(el("div", { class: "row", style: { marginTop: "10px" } },
      el("button", { class: "btn small", text: "+ Agregar regla", onclick: () => editRule({ activa: true, dato: "general", cond: "<", valor: "80", marcar: [], texto: "" }, x => { rules.push(x); draw(); }) }),
      el("button", { class: "btn small", text: "Restaurar predeterminadas", onclick: () => { rules = JSON.parse(JSON.stringify(core.DEFAULT_RULES)); draw(); } })),
    el("p", { style: { margin: "12px 0 4px" }, text: "El comentario empieza con ({eval} = número de evaluación):" }), intro,
    el("label", { class: "check", style: { marginTop: "8px" } }, zero, "Ignorar notas en 0 (todavía no registradas)"));
    modal({ title: "Reglas de alertas académicas", body: body, wide: true, actions: [
      { text: "Cancelar" },
      { text: "Guardar reglas", cls: "primary", onClick: async () => {
        P.rules = rules; P.intro = intro.value; P.ignoreZero = zero.checked; save();
        if (S.alerts.some(a => a.edited && !a.manual) && await confirmBox("Reglas", "¿Aplicar las reglas nuevas también a las alertas que editaste a mano?", "Sí, aplicar"))
          S.alerts.forEach(a => { if (!a.manual) a.edited = false; });
        recompute();
      } }] });
  });

  function editRule(rule, done) {
    const r = JSON.parse(JSON.stringify(rule));
    const dato = el("select"); Object.entries(core.DATOS).forEach(([k, v]) => dato.append(new Option(v, k))); dato.value = r.dato;
    const cond = el("select"); const val = el("input", { type: "text", value: r.valor, list: "a-dl-levels", style: { width: "140px" } });
    const levels = el("datalist", { id: "a-dl-levels" }); core.LEVELS.forEach(l => levels.append(el("option", { value: l })));
    const fixCond = () => {
      const txt = core.TEXT_DATOS.has(dato.value);
      cond.innerHTML = ""; (txt ? ["="] : core.CONDS).forEach(c => cond.append(new Option(c, c)));
      cond.value = txt ? "=" : (core.CONDS.includes(r.cond) ? r.cond : "<");
      if (txt && !core.LEVELS.includes(val.value)) val.value = "Debe Mejorar";
      if (!txt && core.LEVELS.includes(val.value)) val.value = "70";
    };
    dato.addEventListener("change", fixCond); fixCond();
    const marks = el("div", { class: "checks-grid" });
    const opts = [[core.SKILL_FOR, "La destreza que falló"]].concat(core.ITEMS.map(x => [x[0], x[1]]));
    const boxes = opts.map(([k, n]) => { const c = el("input", { type: "checkbox", value: k }); c.checked = (r.marcar || []).includes(k); marks.append(el("label", { class: "check" }, c, n)); return c; });
    const texto = el("input", { type: "text", value: r.texto || "", style: { width: "100%" } });
    const on = el("input", { type: "checkbox" }); on.checked = r.activa !== false;
    const body = el("div", { class: "stack" }, el("div", { class: "row" }, el("span", { text: "Si" }), dato, cond, val, levels),
      el("p", { style: { margin: "10px 0 2px", fontWeight: "600" }, text: "Marcar en el formulario:" }), marks,
      el("p", { style: { margin: "10px 0 2px" }, text: "Frase para el comentario (puedes usar {nota}, {max}, {porcentaje} y {destreza}):" }), texto,
      el("label", { class: "check" }, on, "Regla activa"));
    modal({ title: "Regla", body: body, wide: true, actions: [{ text: "Cancelar" }, { text: "Aceptar", cls: "primary", onClick: () => {
      if (!core.TEXT_DATOS.has(dato.value) && isNaN(parseFloat(val.value.replace(",", ".")))) { toast("El valor debe ser un número."); return false; }
      done({ activa: on.checked, dato: dato.value, cond: cond.value, valor: val.value.trim(),
        marcar: boxes.filter(b => b.checked).map(b => b.value), texto: texto.value.trim() });
    } }] });
  }

  // ------------------------------------------------------------------ crear
  $("#a-create").addEventListener("click", async () => {
    const todo = S.alerts.filter(a => a.create);
    if (!todo.length || !S.templates.length) return;
    P.docente = $("#a-doc").value.trim(); P.contacto = $("#a-contact").value.trim(); P.atencion = $("#a-hours").value.trim(); save();
    const btn = $("#a-create"); btn.disabled = true; btn.textContent = "Creando…";
    const outputs = [], taken = new Set(), errors = [];
    for (const a of todo) {
      const pick = a.tpl || pickTemplate(a);
      try {
        const v = Object.assign({}, a.vars);
        if (a.manual || !v.estudiante) { const [ap, no] = core.splitName(a.student, "Nombres Apellidos"); Object.assign(v, { estudiante: a.student, apellidos: ap, nombres: no }); }
        v.curso = v.curso || a.course;
        const name = core.uniqueName(core.renderTemplate(P.nombre, v, RI.cfg.formato_nombre) || "Alerta academica", taken) + ".pdf";
        const bytes = await ops.fillAlert(pick.t, pick.bytes, { course: a.course, schedule: a.schedule, date: $("#a-date").value.trim(),
          tutor: a.tutor, student: a.student, comments: a.comment, faltas: a.faltas, docente: P.docente, contacto: P.contacto,
          atencion: P.atencion }, a.items);
        outputs.push({ name: name, bytes: bytes, vars: v });
      } catch (e) { errors.push(`${a.student}: ${e.message || e}`); }
    }
    render();
    if (errors.length) alertBox("Algunas alertas no se pudieron crear", errors.slice(0, 8).join("\n"));
    if (!outputs.length) return;
    const msg = await saveFiles(outputs, RI.cfg.guardar, "RenameIt - alertas.zip");
    if (msg === null) { toast("No se eligió carpeta: no se guardó nada."); return; }
    const body = el("div", {}, el("div", { class: "row", style: { alignItems: "flex-start", gap: "14px" } },
      el("div", { class: "done-icon", text: "✓" }),
      el("div", { class: "grow" }, el("h2", { text: `Se crearon ${outputs.length} alerta(s)` }), el("p", { class: "muted", text: msg, style: { margin: "2px 0 0" } }))));
    const m = modal({ body: body, actions: [{ text: "Cerrar" }] });
    body.append(el("div", { class: "choice-list" },
      el("button", { class: "btn big primary", text: "Enviarlas a Google Classroom", onclick: () => { m.close(); bus.emit("to-classroom", { files: outputs, kind: "alerta" }); RI.view("classroom"); } }),
      el("button", { class: "btn big", text: "Descargar otra vez (.zip)", onclick: () => { m.close(); saveFiles(outputs, "zip", "RenameIt - alertas.zip"); } })));
  });

  bus.on("view", v => { if (v === "alerts" && !S.alerts.length && RI.pdfs.length) readCards(); });
  bus.on("formats", readCards);
  rulesSummary();
  readCards();
  loadStoredTemplates();
})();
