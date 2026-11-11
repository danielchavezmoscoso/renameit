/* RenameIt web - vista «Enviar a Classroom». */
(function () {
  "use strict";
  const { $, el, store, bus, toast, confirmBox, alertBox, readFile, pickFiles } = UI;
  const core = RenameItCore, ops = RenameItPdf, G = GoogleCR;
  const NO_SEND = "(no enviar)";
  const QUALITY = { alta: ["✓ sí", "ok"], revisar: ["revisar", "warn"], "sin coincidencia": ["—", "err"], manual: ["elegido a mano", ""] };
  const prefs = Object.assign({
    clientId: "", title_eval: "Evaluación {eval} - {nombres} {apellidos}", title_alerta: "Alerta académica - {nombres} {apellidos}",
    desc_eval: "", desc_alerta: "", draft: true,
  }, store.get("classroom", {}));
  const S = { rows: [], kind: "eval", courses: [], students: {}, topics: {}, busy: false };

  const clientIn = $("#g-client");
  clientIn.value = prefs.clientId || (window.RENAMEIT_CONFIG || {}).googleClientId || "";
  $("#g-setup").open = !clientIn.value;
  clientIn.addEventListener("change", () => { prefs.clientId = clientIn.value.trim(); save(); });
  $("#c-draft").checked = prefs.draft;
  $("#c-draft").addEventListener("change", () => { prefs.draft = $("#c-draft").checked; save(); refresh(); });
  $("#c-title").addEventListener("input", () => { prefs["title_" + S.kind] = $("#c-title").value; save(); refresh(); });
  $("#c-desc").addEventListener("input", () => { prefs["desc_" + S.kind] = $("#c-desc").value; save(); });
  function save() { store.set("classroom", prefs); }
  function setKind(kind) {
    S.kind = kind;
    $("#c-title").value = prefs["title_" + kind];
    $("#c-desc").value = prefs["desc_" + kind];
  }
  setKind("eval");

  function account() {
    $("#g-account").textContent = G.account ? "✓ Conectado como: " + G.account
      : clientIn.value ? "Pulsa «Iniciar sesión con Google» para conectar tu cuenta."
        : "Primero completa la Configuración (abajo) con el ID de cliente de Google.";
    $("#g-signin").textContent = G.account ? "Recargar cursos" : "Iniciar sesión con Google";
    $("#g-signout").hidden = !G.account;
  }

  $("#g-signin").addEventListener("click", async () => {
    const id = clientIn.value.trim();
    if (!id) { $("#g-setup").open = true; clientIn.focus(); toast("Falta el ID de cliente de Google."); return; }
    status("Abriendo la ventana de Google…");
    try {
      await G.signIn(id);
      prefs.clientId = id; save();
      account();
      status("Cargando tus cursos…");
      S.courses = await G.courses();
      fillCourses();
      status(S.courses.length ? "Elige el curso (paso 2)." : "No tienes cursos activos como docente.");
    } catch (e) { status("Error: " + (e.message || e), true); }
  });
  $("#g-signout").addEventListener("click", () => {
    G.signOut(); S.courses = []; S.students = {}; S.topics = {};
    fillCourses(); account(); refresh();
  });

  const label = c => c.name + (c.section ? " · " + c.section : "");
  function fillCourses() {
    const sel = $("#c-course");
    sel.innerHTML = "";
    sel.append(new Option(S.courses.length ? "Elige un curso…" : "Inicia sesión para ver tus cursos", ""));
    S.courses.forEach(c => sel.append(new Option(label(c), c.id)));
    const g = guessCourse();
    if (g) { sel.value = g.id; loadCourse(); }
  }
  function guessCourse() {
    const keys = new Set(S.rows.map(r => core.alnum(r.vars.curso || "")).filter(k => k.length >= 3));
    if (!keys.size) return null;
    const hits = S.courses.filter(c => [...keys].some(k => core.alnum(label(c) + (c.descriptionHeading || "")).includes(k)));
    return hits.length === 1 ? hits[0] : null;
  }
  const current = () => S.courses.find(c => c.id === $("#c-course").value);
  $("#c-course").addEventListener("change", loadCourse);

  async function loadCourse() {
    const c = current();
    S.students = {}; S.topics = {};
    $("#c-topics").innerHTML = "";
    if (!c) { rematch(); return; }
    status("Cargando alumnos del curso…");
    try {
      const studs = await G.students(c.id);
      for (const s of studs) S.students[s.userId] = (s.profile && s.profile.name && s.profile.name.fullName) || s.userId;
      const tps = await G.topics(c.id);
      for (const t of tps) { S.topics[t.name] = t.topicId; $("#c-topics").append(el("option", { value: t.name })); }
      rematch();
    } catch (e) { status("Error: " + (e.message || e), true); }
  }

  function rematch() {
    const files = S.rows.map((r, i) => [i, r.tokens]);
    const studs = Object.entries(S.students).map(([id, n]) => [id, core.normTokens(n)]);
    const res = core.matchStudents(files, studs);
    S.rows.forEach((r, i) => { if (!r.status.startsWith("✓")) { [r.studentId, r.quality] = res[i]; r.status = ""; } });
    refresh();
  }

  function title(r) {
    const v = Object.assign({}, r.vars, { alumno: S.students[r.studentId] || "" });
    return core.renderTemplate($("#c-title").value, v, (RI.cfg || {}).formato_nombre || "Como está", true);
  }
  function desc(r) {
    const tpl = $("#c-desc").value.trim();
    if (!tpl) return "";
    const v = Object.assign({}, r.vars, { alumno: S.students[r.studentId] || "" });
    return tpl.replace(/\{(\w+)\}/g, (m, k) => v[k] || "").trim();
  }

  function refresh() {
    const body = $("#c-body");
    body.innerHTML = "";
    const have = Object.keys(S.students).length > 0;
    const names = Object.entries(S.students).sort((a, b) => a[1].localeCompare(b[1]));
    let alta = 0, rev = 0, sin = 0;
    S.rows.forEach((r, i) => {
      let cls = "";
      if (r.status.startsWith("✓")) cls = "ok";
      else if (r.status.startsWith("✗")) cls = "error";
      else if (have && !r.studentId) { cls = "error"; sin++; }
      else if (have && r.quality === "revisar") { cls = "warn"; rev++; }
      else if (have) alta++;
      let who;
      if (have) {
        who = el("select", { "aria-label": "Alumno para " + r.name });
        who.append(new Option(NO_SEND, ""), ...names.map(([id, n]) => new Option(n, id)));
        who.value = r.studentId || "";
        who.addEventListener("change", () => {
          const sid = who.value || null;
          if (sid) S.rows.forEach(o => { if (o !== r && o.studentId === sid) { o.studentId = null; o.quality = "sin coincidencia"; } });
          r.studentId = sid; r.quality = "manual"; refresh();
        });
      } else who = el("span", { class: "muted", text: "—" });
      const q = QUALITY[r.quality] || ["", ""];
      body.append(el("tr", { class: cls },
        el("td", { text: r.name }), el("td", {}, who),
        el("td", {}, have && q[0] ? el("span", { class: "badge " + q[1], text: q[0] }) : ""),
        el("td", { text: title(r) }), el("td", { text: r.status })));
    });
    $("#c-empty").hidden = S.rows.length > 0;
    if (have) {
      const sinPdf = Object.keys(S.students).length - new Set(S.rows.map(r => r.studentId).filter(Boolean)).size;
      status(`${alta} listos` + (rev ? `, ${rev} para revisar (amarillo)` : "") + (sin ? `, ${sin} sin alumno (rojo, no se envían)` : "") +
        (sinPdf > 0 ? `.  ${sinPdf} alumno(s) del curso sin PDF.` : "."));
    } else if (S.rows.length) {
      status(G.account ? "Elige el curso (paso 2)." : "Inicia sesión y elige el curso para ver a qué alumno va cada PDF.");
    } else status("");
    const n = S.rows.filter(r => r.studentId && !r.status.startsWith("✓")).length;
    const send = $("#c-send");
    send.disabled = !(n && have && !S.busy);
    send.textContent = n ? `Enviar ${n} ${$("#c-draft").checked ? "borrador(es)" : "material(es)"}` : "Enviar a Classroom";
    $("#c-open").disabled = !current();
  }
  function status(t, warn) { const s = $("#c-status"); s.textContent = t; s.classList.toggle("warn", !!warn); }

  async function addFiles(files, kind) {
    if (kind && kind !== S.kind) { S.rows = []; setKind(kind); }
    for (const f of files) {
      if (S.rows.some(r => r.name === f.name && r.bytes.length === f.bytes.length)) continue;
      const v = f.vars || {};
      const est = v.estudiante || "";
      S.rows.push({ name: f.name, bytes: f.bytes, vars: v, tokens: core.normTokens(est || core.stem(f.name)),
        studentId: null, quality: "", status: "" });
    }
    if (Object.keys(S.students).length) rematch(); else { const g = guessCourse(); if (g && S.courses.length && !current()) { $("#c-course").value = g.id; loadCourse(); } refresh(); }
  }
  async function addLocal(files) {
    const out = [];
    for (const f of files.filter(x => /\.pdf$/i.test(x.name))) {
      const bytes = await readFile(f);
      let vars = {};
      try {
        const { models } = await ops.readPdf(bytes);
        const forced = RI.formats.find(x => x.nombre === RI.cfg.formato) || null;
        vars = models.length ? core.pageVars(models[0], f.name, 1, RI.formats, forced).vars : {};
      } catch (e) { vars = {}; }
      out.push({ name: f.name, bytes: bytes, vars: vars });
    }
    addFiles(out);
  }
  $("#c-add").addEventListener("click", async () => addLocal(await pickFiles($("#c-file"))));
  $("#c-clear").addEventListener("click", () => { S.rows = []; refresh(); });
  bus.on("classroom-drop", files => addLocal(files));
  bus.on("to-classroom", d => addFiles(d.files, d.kind));

  $("#c-open").addEventListener("click", () => {
    const c = current();
    if (c && c.alternateLink) window.open(c.alternateLink.replace("/c/", "/w/") + "/t/all", "_blank", "noopener");
  });

  $("#c-send").addEventListener("click", async () => {
    const c = current();
    const todo = S.rows.filter(r => r.studentId && !r.status.startsWith("✓"));
    if (!c || !todo.length) return;
    const draft = $("#c-draft").checked;
    const sent = new Set(store.get("sentlog", []));
    const dup = todo.filter(r => sent.has(`${c.id}|${r.studentId}|${title(r)}`)).length;
    const rev = todo.filter(r => r.quality === "revisar").length;
    let msg = `Curso: ${label(c)}\nSe crearán ${todo.length} material(es) ${draft ? "en BORRADOR" : "PUBLICADOS (los alumnos los verán ya)"}, cada uno visible solo para su alumno.`;
    if (rev) msg += `\n\n⚠ ${rev} tienen coincidencia «revisar» (amarillo). Verifica que el alumno sea el correcto.`;
    if (dup) msg += `\n\n⚠ ${dup} ya se enviaron antes con el mismo título a ese alumno y se volverán a enviar.`;
    if (!(await confirmBox("Confirmar envío", msg, "Enviar"))) return;
    S.busy = true; refresh();
    let ok = 0, fail = 0, firstErr = "";
    try {
      const topicName = $("#c-topic").value.trim();
      let topicId = null;
      if (topicName) {
        topicId = S.topics[topicName];
        if (!topicId) { status(`Creando tema «${topicName}»…`); topicId = (await G.createTopic(c.id, topicName)).topicId; S.topics[topicName] = topicId; }
      }
      status("Preparando carpeta en Drive…");
      const root = await G.ensureFolder("RenameIt Classroom");
      const folder = await G.ensureFolder(label(c), root);
      let n = 0;
      for (const r of todo) {
        n++;
        status(`Enviando ${n}/${todo.length}: ${S.students[r.studentId]}…`);
        try {
          const fid = await G.uploadPdf(r.name, r.bytes, folder);
          const t = title(r);
          await G.createMaterial(c.id, r.studentId, t, desc(r), fid, topicId, draft);
          r.status = draft ? "✓ borrador" : "✓ publicado";
          ok++;
          sent.add(`${c.id}|${r.studentId}|${t}`);
          store.set("sentlog", [...sent]);
        } catch (e) {
          r.status = "✗ " + (e.message || e); fail++; firstErr = firstErr || (e.message || String(e));
        }
        refresh();
      }
    } catch (e) { firstErr = firstErr || (e.message || String(e)); }
    S.busy = false;
    refresh();
    const text = `Terminado: ${ok} enviado(s)` + (fail ? `, ${fail} con error (en rojo)` : "");
    status(text + ".", !!fail);
    if (firstErr) alertBox("Classroom", `${text}.\n\nPrimer error:\n${firstErr}`);
    else if (ok) {
      const go = await confirmBox("Listo", `${text}.` + (draft ? "\n\nQuedaron como BORRADOR: revísalos y publícalos desde Classroom." : "") +
        "\n\n¿Abrir el curso en Classroom?", "Abrir Classroom");
      if (go) $("#c-open").click();
    }
  });

  account();
  refresh();
})();
