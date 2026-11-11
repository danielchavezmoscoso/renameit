/*
 * RenameIt web - lógica (sin interfaz). Funciona en el navegador y en Node (para pruebas).
 * Es una traducción de renameit.py, alertas.py y classroom.py.
 */
(function (root) {
  "use strict";

  // ------------------------------------------------------------------ utilidades de texto
  function fold(s) {
    return (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }
  function alnum(s) { return fold(s).replace(/[^a-z0-9]/g, ""); }
  function clean(t) {
    t = (t || "").replace(/\s+/g, " ").trim();
    return t.replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "").trim();
  }
  function pyRegex(pattern, flags) {
    // Los patrones vienen de los formatos (escritos para Python). Los básicos son iguales en JS.
    return new RegExp(pattern.replace(/\(\?P</g, "(?<"), flags || "i");
  }

  // ------------------------------------------------------------------ modelo de página (pdf.js)
  function mult(m1, m2) {
    return [m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]];
  }

  /** Convierte una página de pdf.js en {width, height, items, spans, lines, text}. Coordenadas desde arriba-izquierda. */
  async function pageModel(page) {
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const tx = mult(vp.transform, it.transform);
      const fs = Math.hypot(tx[2], tx[3]) || it.height || 10;
      const x0 = tx[4], base = tx[5];
      items.push({ str: it.str, x0: x0, x1: x0 + it.width * vp.scale, y0: base - fs * 0.82, y1: base + fs * 0.22,
        base: base, fs: fs });
    }
    return buildModel(vp.width, vp.height, items);
  }

  function group(items, maxGap) {
    const sorted = items.slice().sort((a, b) => (a.base - b.base) || (a.x0 - b.x0));
    const rows = [];
    for (const it of sorted) {
      const row = rows.find(r => Math.abs(r.base - it.base) < Math.max(r.fs, it.fs) * 0.3);
      if (row) row.list.push(it); else rows.push({ base: it.base, fs: it.fs, list: [it] });
    }
    const out = [];
    for (const r of rows) {
      r.list.sort((a, b) => a.x0 - b.x0);
      let cur = null;
      for (const it of r.list) {
        const gap = cur ? it.x0 - cur.x1 : Infinity;
        if (cur && gap < Math.max(cur.fs, it.fs) * maxGap && gap > -cur.fs) {
          cur.str += (gap > it.fs * 0.12 && !/\s$/.test(cur.str) && !/^\s/.test(it.str) ? " " : "") + it.str;
          cur.x1 = Math.max(cur.x1, it.x1); cur.y0 = Math.min(cur.y0, it.y0); cur.y1 = Math.max(cur.y1, it.y1);
        } else {
          cur = Object.assign({}, it);
          out.push(cur);
        }
      }
    }
    for (const s of out) s.str = s.str.replace(/\s+/g, " ").trim();
    return out.filter(s => s.str);
  }

  function buildModel(width, height, items) {
    const spans = group(items, 0.35);      // como los «spans» de PyMuPDF: texto seguido con el mismo estilo
    const lines = group(items, 1.0);       // como las «líneas»: lo que está junto en una misma fila
    lines.sort((a, b) => (Math.round(a.y0) - Math.round(b.y0)) || (a.x0 - b.x0));
    const text = rowsText(lines);
    return { width: width, height: height, items: items, spans: spans, lines: lines, text: text };
  }

  function rowsText(lines) {
    const rows = [];
    for (const l of lines) {
      const r = rows.find(x => Math.abs(x.base - l.base) < l.fs * 0.3);
      if (r) r.list.push(l); else rows.push({ base: l.base, list: [l] });
    }
    rows.sort((a, b) => a.base - b.base);
    return rows.map(r => r.list.sort((a, b) => a.x0 - b.x0).map(l => l.str).join(" ")).join("\n");
  }

  // ------------------------------------------------------------------ extracción de campos
  function findLabel(spans, label) {
    const lab = (label || "").trim().toLowerCase();
    if (!lab) return null;
    return spans.find(s => s.str.toLowerCase() === lab) || spans.find(s => s.str.toLowerCase().startsWith(lab)) || null;
  }
  function rightOf(spans, label) {
    const lr = findLabel(spans, label);
    if (!lr) return ["", null];
    const cy = (lr.y0 + lr.y1) / 2;
    let best = null;
    for (const s of spans) {
      if (s.x0 >= lr.x1 - 1 && s.y0 - 3 <= cy && cy <= s.y1 + 3 && s !== lr) {
        const d = s.x0 - lr.x1;
        if (!best || d < best[0]) best = [d, s];
      }
    }
    return best ? [clean(best[1].str), best[1]] : ["", null];
  }
  function below(spans, label) {
    const lr = findLabel(spans, label);
    if (!lr) return ["", null];
    let best = null;
    for (const s of spans) {
      if (s !== lr && s.y0 >= lr.y1 - 1 && s.x1 > lr.x0 - 20 && s.x0 < lr.x1 + 20) {
        const d = s.y0 - lr.y1;
        if (!best || d < best[0]) best = [d, s];
      }
    }
    return best ? [clean(best[1].str), best[1]] : ["", null];
  }
  function regexValue(pattern, text) {
    let m;
    try { m = pyRegex(pattern).exec(text || ""); } catch (e) { return null; }
    if (!m) return null;
    return clean(m.length > 1 ? (m[1] || "") : m[0]);
  }
  function zoneRect(model, z) {
    return { x0: z[0] * model.width, y0: z[1] * model.height, x1: z[2] * model.width, y1: z[3] * model.height };
  }
  function zoneText(model, r) {
    const inside = model.items.filter(it => {
      const cx = (it.x0 + it.x1) / 2, cy = (it.y0 + it.y1) / 2;
      return cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1;
    });
    return clean(rowsText(group(inside, 1.0)).replace(/\n/g, " "));
  }
  function stem(name) { return (name || "").replace(/\.[^.]+$/, ""); }

  /** Devuelve {vals, rects} — los rectángulos sirven para marcar el dato en la vista previa. */
  function extractFields(model, campos, srcName) {
    const vals = {}, rects = {};
    for (const c of campos || []) {
      const name = c.nombre;
      if (!name) continue;
      let val = "", rect = null;
      try {
        switch (c.tipo || "derecha_de") {
          case "derecha_de": [val, rect] = rightOf(model.spans, c.etiqueta); break;
          case "debajo_de": [val, rect] = below(model.spans, c.etiqueta); break;
          case "zona": rect = zoneRect(model, c.zona || [0, 0, 0, 0]); val = zoneText(model, rect); break;
          case "regex": val = regexValue(c.patron || "", model.text) || ""; break;
          case "de_campo": {
            const base = vals[c.campo] || "";
            const got = c.patron ? regexValue(c.patron, base) : base;
            val = got !== null ? got : (c.si_no === "todo" ? base : "");
            break;
          }
          case "del_archivo": {
            const st = stem(srcName);
            const got = c.patron ? regexValue(c.patron, st) : st;
            val = got || "";
            break;
          }
          case "fijo": val = c.valor || ""; break;
          default: val = "";
        }
      } catch (e) { val = ""; rect = null; }
      vals[name] = val;
      if (rect) rects[name] = rect;
    }
    return { vals: vals, rects: rects };
  }

  // ------------------------------------------------------------------ formatos
  const CBA_FORMAT = {
    nombre: "CBA - Tarjeta de evaluación",
    descripcion: "Evaluation Card del Centro Boliviano Americano (una página por estudiante).",
    detectar: ["EVALUATION CARD", "STUDENT"],
    campo_estudiante: "estudiante",
    orden_nombre: "Apellidos, Nombres",
    plantilla: "",
    campos: [
      { nombre: "estudiante", tipo: "derecha_de", etiqueta: "STUDENT" },
      { nombre: "docente", tipo: "derecha_de", etiqueta: "TEACHER" },
      { nombre: "modulo", tipo: "derecha_de", etiqueta: "MODULE" },
      { nombre: "horario", tipo: "derecha_de", etiqueta: "SCHEDULE" },
      { nombre: "gestion", tipo: "derecha_de", etiqueta: "BIMESTER" },
      { nombre: "programa", tipo: "derecha_de", etiqueta: "EVALUATION CARD" },
      { nombre: "fecha", tipo: "derecha_de", etiqueta: "Date (Fecha)" },
      { nombre: "eval", tipo: "regex", patron: "(\\d+)\\s*(?:st|nd|rd|th)\\.?\\s*Evaluation" },
      { nombre: "curso", tipo: "de_campo", campo: "modulo", patron: "\\(([^)]+)\\)", si_no: "todo" },
      { nombre: "anio", tipo: "de_campo", campo: "gestion", patron: "(\\d{4})" },
      { nombre: "bimestre", tipo: "de_campo", campo: "gestion", patron: "\\d{4}\\s*/\\s*(\\S+)" },
    ],
  };
  const FIELD_TYPES = {
    derecha_de: "Texto a la derecha de una etiqueta",
    debajo_de: "Texto debajo de una etiqueta",
    zona: "Texto dentro de una zona de la página",
    regex: "Buscar un patrón (regex) en la página",
    de_campo: "Parte de otro campo (regex)",
    del_archivo: "Del nombre del archivo PDF",
    fijo: "Valor fijo",
  };
  const NAME_ORDERS = ["Apellidos, Nombres", "Nombres Apellidos", "Apellidos Nombres", "Sin dividir"];
  const NAME_FORMATS = ["Como está", "Tipo Título", "MAYÚSCULAS", "minúsculas"];
  const PERSON_VARS = new Set(["estudiante", "apellidos", "nombres", "docente"]);

  function normFormat(f) {
    return Object.assign({ detectar: [], campos: [], campo_estudiante: "estudiante",
      orden_nombre: "Apellidos, Nombres", plantilla: "", descripcion: "" }, f);
  }
  function normText(s) { return (s || "").replace(/\s+/g, " ").trim().toLowerCase(); }
  function detectFormat(text, formats) {
    const t = normText(text);
    let best = null, score = 0;
    for (const f of formats) {
      const keys = (f.detectar || []).map(normText).filter(Boolean);
      if (keys.length && keys.length > score && keys.every(k => t.includes(k))) { best = f; score = keys.length; }
    }
    return best;
  }
  function formatVarNames(formats) {
    const out = [];
    for (const f of formats) for (const c of f.campos || []) if (c.nombre && !out.includes(c.nombre)) out.push(c.nombre);
    return out;
  }

  // ------------------------------------------------------------------ nombres y plantillas
  function splitName(full, order) {
    full = clean(full);
    if (!full) return ["", ""];
    if (full.includes(",")) {
      const i = full.indexOf(",");
      const ap = clean(full.slice(0, i)), no = clean(full.slice(i + 1));
      return order === "Nombres Apellidos" ? [no, ap] : [ap, no];
    }
    const w = full.split(" ");
    if (order === "Nombres Apellidos") {
      const k = w.length >= 3 ? 2 : (w.length === 2 ? 1 : 0);
      return k ? [w.slice(w.length - k).join(" "), w.slice(0, w.length - k).join(" ")] : [full, ""];
    }
    if (order === "Apellidos Nombres") {
      const k = w.length >= 3 ? 2 : 1;
      return [w.slice(0, k).join(" "), w.slice(k).join(" ")];
    }
    return [full, ""];
  }

  function deriveVars(vals, srcName, pageNo, fmt) {
    const v = Object.assign({}, vals);
    fmt = fmt || {};
    const key = fmt.campo_estudiante || "estudiante";
    const est = v[key] || v.estudiante || "";
    v.estudiante = est;
    const [ap, no] = splitName(est, fmt.orden_nombre || "Apellidos, Nombres");
    if (!("apellidos" in v)) v.apellidos = ap;
    if (!("nombres" in v)) v.nombres = no;
    if (!fmt.nombre && !("curso" in v)) {
      const m = /\(([^)]+)\)/.exec(v.modulo || "");
      v.curso = m ? m[1].trim() : (v.modulo || "");
    }
    v.pagina = String(pageNo);
    v.pagina2 = String(pageNo).padStart(2, "0");
    v.archivo = stem(srcName);
    v.carpeta = "";
    v.formato = fmt.nombre || "";
    return v;
  }

  function pageVars(model, srcName, pageNo, formats, forced) {
    const fmt = forced || detectFormat(model.text, formats);
    const vals = fmt ? extractFields(model, fmt.campos || [], srcName).vals : {};
    return { vars: deriveVars(vals, srcName, pageNo, fmt), fmt: fmt };
  }

  function applyCase(text, fmt) {
    text = text || "";
    if (fmt === "Tipo Título") return text.split(" ").map(w => w.slice(0, 1).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
    if (fmt === "MAYÚSCULAS") return text.toUpperCase();
    if (fmt === "minúsculas") return text.toLowerCase();
    return text;
  }
  function sanitize(name) {
    name = (name || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "");
    name = name.replace(/\s+/g, " ").replace(/(\s*-\s*){2,}/g, " - ");
    name = name.replace(/^[\s.\-_]+|[\s.\-_]+$/g, "");
    return name.slice(0, 180);
  }
  function renderTemplate(template, v, fmt, raw) {
    const out = (template || "").replace(/\{(\w+)(?::(\d+))?\}/g, (m, key, n) => {
      let val = v[key] !== undefined && v[key] !== null ? String(v[key]) : "";
      if (PERSON_VARS.has(key)) val = applyCase(val, fmt);
      if (n) val = val.split(/\s+/).filter(Boolean).slice(0, parseInt(n, 10)).join(" ");
      return val;
    });
    return raw ? out.replace(/\s+/g, " ").trim() : sanitize(out);
  }

  /** pdfs: [{name, models:[pageModel]}] → items [{pdf, pages, vars, name, manual}] */
  function buildPlan(pdfs, cfg, formats) {
    const forced = cfg.formato ? formats.find(f => f.nombre === cfg.formato) : null;
    const items = [];
    pdfs.forEach((pdf, pi) => {
      pdf.models.forEach((model, i) => {
        const { vars: v, fmt } = pageVars(model, pdf.name, i + 1, formats, forced);
        const tpl = (fmt && fmt.plantilla) || cfg.plantilla;
        let name = fmt ? renderTemplate(tpl, v, cfg.formato_nombre) : "";
        if (!fmt) v._sin_formato = "1";
        if (!v.estudiante || !name) {
          name = name || `${stem(pdf.name)}_p${String(i + 1).padStart(2, "0")}`;
          v._sin_datos = "1";
        }
        const prev = items[items.length - 1];
        if (cfg.unir_paginas_consecutivas && prev && prev.pdf === pi && v.estudiante &&
            prev.vars.estudiante === v.estudiante) {
          prev.pages.push(i);
          return;
        }
        items.push({ pdf: pi, pages: [i], vars: v, name: name, manual: false });
      });
    });
    return items;
  }

  function uniqueName(name, taken) {
    let cand = name, k = 2;
    while (taken.has(cand.toLowerCase())) cand = `${name} (${k++})`;
    taken.add(cand.toLowerCase());
    return cand;
  }

  // ------------------------------------------------------------------ notas de la tarjeta (alertas)
  const ITEMS = [
    ["auditiva", "Comprensión Auditiva", ["auditiva"]],
    ["oral", "Expresión Oral", ["oral"]],
    ["lectura", "Lectura", ["lectura"]],
    ["escritura", "Escritura", ["escritura"]],
    ["participacion", "Participación", ["particip"]],
    ["asistencia", "Asistencia", ["asistencia"]],
    ["classroom", "Google Classroom", ["classroom"]],
    ["disciplina", "Disciplina", ["disciplina"]],
    ["plataforma", "Plataforma (Surpass LMS / My English Lab)", ["lms", "english lab", "plataforma"]],
    ["camara", "Uso de la cámara", ["camara"]],
    ["microfono", "Uso del micrófono", ["microfono"]],
  ];
  const ITEM_NAMES = Object.fromEntries(ITEMS.map(x => [x[0], x[1]]));
  const SKILL_FOR = "destreza";
  const SKILLS = [
    ["listening", "Comprensión Auditiva", ["listening", "auditiva"]],
    ["grammar", "Gramática", ["grammar", "gramatica"]],
    ["vocabulary", "Vocabulario", ["vocabulary", "vocabulario"]],
    ["reading", "Lectura", ["reading", "lectura"]],
    ["writing", "Escritura", ["writing", "escrita"]],
    ["speaking", "Expresión Oral", ["speaking", "oral"]],
  ];
  const SKILL_NAMES = Object.fromEntries(SKILLS.map(x => [x[0], x[1]]));
  const SKILL_ITEM = { listening: "auditiva", reading: "lectura", writing: "escritura", speaking: "oral" };
  const DATOS = {
    general: "Nota general (sobre 100)",
    speaking: "Speaking / Expresión Oral (sobre 100)",
    mini: "Mini-Progress Test, cualquier destreza (%)",
    overall: "Overall Performance, cualquier destreza (%)",
    promedio_mini: "Promedio de los Mini-Progress Test (%)",
    promedio_overall: "Promedio de los Overall Performance (%)",
  };
  SKILLS.filter(s => s[0] !== "speaking").forEach(s => { DATOS["mini." + s[0]] = `Mini-Progress Test de ${s[1]} (%)`; });
  SKILLS.filter(s => s[0] !== "speaking").forEach(s => { DATOS["overall." + s[0]] = `Overall Performance de ${s[1]} (%)`; });
  Object.assign(DATOS, { ausencias: "Ausencias (cantidad)", trabajo: "Trabajo en clases (Kids)", conducta: "Conducta (Kids)" });
  const TEXT_DATOS = new Set(["trabajo", "conducta"]);
  const CONDS = ["<", "<=", ">=", ">", "="];
  const LEVELS = ["Muy bien!", "Bien", "Satisfactorio", "Debe Mejorar"];
  const SHORT = { general: "Nota general", speaking: "Speaking", mini: "Algún Mini-Progress", overall: "Algún Overall",
    promedio_mini: "Promedio Mini-Progress", promedio_overall: "Promedio Overall", ausencias: "Ausencias",
    trabajo: "Trabajo en clases", conducta: "Conducta" };
  SKILLS.forEach(s => { SHORT["mini." + s[0]] = "Mini-Progress " + s[1]; SHORT["overall." + s[0]] = "Overall " + s[1]; });

  const DEFAULT_RULES = [
    { activa: true, dato: "general", cond: "<", valor: "80", marcar: [], texto: "Nota general: {nota}/100 (se aprueba con 80)." },
    { activa: true, dato: "speaking", cond: "<", valor: "80", marcar: ["oral"], texto: "Speaking: {nota}/100." },
    { activa: true, dato: "mini", cond: "<", valor: "70", marcar: [SKILL_FOR], texto: "Mini-Progress Test de {destreza}: {nota}/{max}." },
    { activa: true, dato: "overall", cond: "<", valor: "70", marcar: [SKILL_FOR], texto: "Overall Performance de {destreza}: {nota}/{max}." },
    { activa: true, dato: "ausencias", cond: ">=", valor: "3", marcar: ["asistencia"], texto: "Ausencias acumuladas: {nota}." },
    { activa: true, dato: "conducta", cond: "=", valor: "Debe Mejorar", marcar: ["disciplina"], texto: "Conducta: debe mejorar." },
    { activa: true, dato: "trabajo", cond: "=", valor: "Debe Mejorar", marcar: ["participacion"], texto: "Trabajo en clases: debe mejorar." },
  ];

  function numRight(rect, nums, xmax) {
    const cy = (rect.y0 + rect.y1) / 2;
    let best = null;
    for (const [v, r] of nums) {
      if (r.x0 >= rect.x1 - 2 && r.x0 < xmax && Math.abs((r.y0 + r.y1) / 2 - cy) <= 7) {
        const d = r.x0 - rect.x1;
        if (!best || d < best[0]) best = [d, v];
      }
    }
    return best ? best[1] : null;
  }

  function readGrades(model) {
    const lines = model.lines;
    const nums = lines.filter(l => /^\d{1,3}$/.test(l.str)).map(l => [parseInt(l.str, 10), l]);
    const g = { skills: {}, speaking: null, general: null, ausencias: null, trabajo: "", conducta: "", observaciones: "" };
    let current = null;
    for (const l of lines) {
      const t = l.str, f = fold(t);
      const m = /\((\d+)\)\s*$/.exec(t);
      if (m && !f.startsWith("a.") && !f.startsWith("b.")) {
        const mx = parseInt(m[1], 10);
        const sk = SKILLS.find(s => s[2].some(kw => f.includes(kw)));
        if (!sk) continue;
        if (mx >= 100 || sk[0] === "speaking") { g.speaking = numRight(l, nums, 300); current = null; }
        else { current = sk[0]; g.skills[current] = { max: mx, mini: null, overall: null }; }
      } else if (f.startsWith("a. mini") && current) {
        g.skills[current].mini = numRight(l, nums, 300);
      } else if (f.startsWith("b. overall") && current) {
        g.skills[current].overall = numRight(l, nums, 300);
      } else if (f.includes("general communicative") || f === "total") {
        g.general = numRight(l, nums, 300);
      } else if (f.startsWith("absences") || f.startsWith("ausencias")) {
        g.ausencias = numRight(l, nums, 100000);
      }
    }
    // Kids: X debajo de Muy bien / Bien / Satisfactorio / Debe Mejorar
    const cats = lines.filter(l => /^(trabajo en clase|conducta)/.test(fold(l.str)));
    const opts = lines.filter(l => LEVELS.includes(l.str.trim()));
    for (const x of lines) {
      if (x.str.trim().toUpperCase() !== "X") continue;
      const above = opts.filter(o => o.y1 <= x.y0 + 2 && x.y0 - o.y1 < 30);
      const cat = cats.filter(c => c.y1 <= x.y0 + 2);
      if (!above.length || !cat.length) continue;
      const cx = (x.x0 + x.x1) / 2;
      const level = above.reduce((a, b) => (Math.abs((a.x0 + a.x1) / 2 - cx) + Math.abs(a.y1 - x.y0) <=
        Math.abs((b.x0 + b.x1) / 2 - cx) + Math.abs(b.y1 - x.y0) ? a : b)).str.trim();
      const name = cat.reduce((a, b) => (a.y0 >= b.y0 ? a : b)).str;
      g[fold(name).startsWith("trabajo") ? "trabajo" : "conducta"] = level;
    }
    const top = lines.find(l => fold(l.str).startsWith("comments"));
    const bottom = lines.find(l => /^(absences|ausencias)/.test(fold(l.str)));
    if (top) {
      const obs = lines.filter(l => l.x0 >= 250 && l.y0 >= top.y1 - 1 && (!bottom || l.y1 <= bottom.y0 + 1)).map(l => l.str);
      g.observaciones = obs.join(" ").replace(/\s+/g, " ").trim();
    }
    return g;
  }
  function hasGrades(g) { return Object.keys(g.skills).length > 0 || g.general !== null || g.speaking !== null; }
  function lowestMini(g) {
    let best = null;
    for (const [k, d] of Object.entries(g.skills)) {
      if (d.mini === null) continue;
      const p = d.mini * 100 / d.max;
      if (!best || p < best[0]) best = [p, k, d];
    }
    return best;
  }

  function fmtNum(v) { return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10); }
  function cmp(a, c, b) {
    return { "<": a < b, "<=": a <= b, ">=": a >= b, ">": a > b, "=": Math.abs(a - b) < 1e-9 }[c];
  }
  function candidates(g, dato, ignoreZero) {
    const ok = v => v !== null && v !== undefined && !(ignoreZero && v === 0);
    const out = [];
    if (dato === "general") { if (ok(g.general)) out.push([g.general, 100, null]); }
    else if (dato === "speaking") { if (ok(g.speaking)) out.push([g.speaking, 100, "speaking"]); }
    else if (dato === "mini" || dato === "overall") {
      for (const [k, d] of Object.entries(g.skills)) if (ok(d[dato])) out.push([d[dato], d.max, k]);
    } else if (dato.startsWith("mini.") || dato.startsWith("overall.")) {
      const [kind, k] = dato.split(".");
      const d = g.skills[k];
      if (d && ok(d[kind])) out.push([d[kind], d.max, k]);
    } else if (dato === "promedio_mini" || dato === "promedio_overall") {
      const kind = dato.split("_")[1];
      const vals = Object.values(g.skills).filter(d => ok(d[kind])).map(d => d[kind] * 100 / d.max);
      if (vals.length) out.push([Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10, 100, null]);
    } else if (dato === "ausencias") { if (g.ausencias !== null) out.push([g.ausencias, null, null]); }
    return out;
  }

  function evaluate(g, rules, ignoreZero) {
    const items = new Set(), parts = [], reasons = [];
    for (const rule of rules) {
      if (rule.activa === false) continue;
      const dato = rule.dato, cond = rule.cond || "<", valor = String(rule.valor || "").trim();
      const hits = [];
      if (TEXT_DATOS.has(dato)) {
        if (g[dato] && fold(g[dato]).replace(/!$/, "") === fold(valor).replace(/!$/, "")) hits.push([g[dato], null, null]);
      } else {
        const limit = parseFloat(valor.replace(",", "."));
        if (isNaN(limit)) continue;
        for (const [nota, mx, sk] of candidates(g, dato, ignoreZero)) {
          const pct = mx ? nota * 100 / mx : nota;
          if (cmp(pct, cond, limit)) hits.push([nota, mx, sk]);
        }
      }
      for (const [nota, mx, sk] of hits) {
        for (const it of rule.marcar || []) {
          if (it === SKILL_FOR) { if (SKILL_ITEM[sk]) items.add(SKILL_ITEM[sk]); } else items.add(it);
        }
        const data = { nota: typeof nota === "number" ? fmtNum(nota) : nota, max: mx ? fmtNum(mx) : "",
          destreza: SKILL_NAMES[sk] || "", porcentaje: mx ? fmtNum(Math.round(nota * 100 / mx)) : "" };
        const phrase = (rule.texto || "").replace(/\{(\w+)\}/g, (m, k) => (k in data ? data[k] : m)).trim();
        if (phrase && !parts.includes(phrase)) parts.push(phrase);
        const short = SHORT[dato] || dato;
        reasons.push(`${short}${sk && (dato === "mini" || dato === "overall") ? " " + SKILL_NAMES[sk] : ""}: ` +
          `${typeof nota === "number" ? fmtNum(nota) : nota}${mx ? "/" + fmtNum(mx) : ""}`);
      }
    }
    return { items: items, parts: parts, reasons: reasons };
  }
  function describeRule(r) {
    const unit = /^(mini|overall|promedio)/.test(r.dato || "") ? "%" : "";
    return `${SHORT[r.dato] || r.dato} ${r.cond} ${r.valor}${unit}`;
  }

  // ------------------------------------------------------------------ formularios de alerta
  /** widgets: [{name, kind:'check'|'text'|'combo', rect:{x0,y0,x1,y1}, maxLen, options}], model: texto de la página */
  function labelLeft(spans, r) {
    const cy = (r.y0 + r.y1) / 2;
    const c = spans.filter(s => s.x0 < r.x0 - 1 && s.y0 - 8 <= cy && cy <= s.y1 + 8);
    return c.length ? c.reduce((a, b) => (a.x0 >= b.x0 ? a : b)).str : "";
  }
  function analyzeTemplate(fileName, widgets, model) {
    const low = fold(model.text), fname = fold(fileName);
    const t = { file: fileName, fields: {}, checks: {}, options: {}, maxlen: {}, checkLabels: {} };
    t.kids = low.includes("ninos") || fname.includes("kids");
    t.virtual = low.includes("virtual") || fname.includes("virtual");
    t.menor = t.kids || low.includes("hijo(a)") || fname.includes("under age");
    const texts = [];
    for (const w of widgets) {
      if (w.kind === "check") {
        const lab = labelLeft(model.spans, w.rect);
        const it = ITEMS.find(x => x[2].some(kw => fold(lab).includes(kw)));
        if (it && !t.checks[it[0]]) { t.checks[it[0]] = w.name; t.checkLabels[it[0]] = lab; }
      } else if (w.kind === "combo") {
        const up = w.name.toUpperCase();
        const k = up.includes("COURSE") ? "course" : up.includes("SCHEDULE") ? "schedule" : null;
        if (k) { t.fields[k] = w.name; t.options[k] = w.options || []; }
      } else if (w.kind === "text") texts.push(w);
    }
    for (const w of texts) {
      const up = w.name.toUpperCase();
      const k = up === "DATE" ? "date" : up.includes("TUTOR") ? "tutor" : up.includes("STUDENT") ? "student" : null;
      if (k) { t.fields[k] = w.name; t.maxlen[k] = w.maxLen || 0; }
    }
    const used = new Set(Object.values(t.fields));
    const rest = texts.filter(w => !used.has(w.name));
    if (rest.length) {
      const big = rest.reduce((a, b) => ((a.rect.x1 - a.rect.x0) * (a.rect.y1 - a.rect.y0) >=
        (b.rect.x1 - b.rect.x0) * (b.rect.y1 - b.rect.y0) ? a : b));
      t.fields.comments = big.name; t.maxlen.comments = big.maxLen || 0;
      rest.splice(rest.indexOf(big), 1);
    }
    for (const w of rest) {
      const lab = fold(labelLeft(model.spans, w.rect)), up = w.name.toUpperCase();
      let k = null;
      if (w.rect.x1 - w.rect.x0 < 70) k = "faltas";
      else if (lab.includes("docente") || up.includes("TEACHER'S NAME")) k = "docente";
      else if (lab.includes("contacto") || up.includes("CELL")) k = "contacto";
      else if (lab.includes("horario") || up.includes("HOURS")) k = "atencion";
      if (k && !t.fields[k]) { t.fields[k] = w.name; t.maxlen[k] = w.maxLen || 0; }
    }
    const prog = t.kids ? "Niños y adolescentes" : (t.menor ? "Adultos menores de edad" : "Adultos mayores de edad");
    t.title = `${prog} - ${t.virtual ? "Virtual" : "Presencial"}`;
    return t;
  }
  function matchOption(t, key, value) {
    const opts = (t.options[key] || []).filter(o => o.replace(/[.\s]/g, ""));
    if (!value) return "";
    if (key === "schedule") {
      const m = /(\d{1,2}:\d{2})\D+(\d{1,2}:\d{2})/.exec(value);
      if (m) value = `${m[1]} - ${m[2]}`;
      const target = value.replace(/\s/g, "");
      return opts.find(o => o.replace(/\s/g, "") === target) || value;
    }
    const a = alnum(value);
    const exact = opts.filter(o => alnum(o) === a);
    if (exact.length) return exact[0];
    const digits = s => s.replace(/\D/g, "");
    const ends = opts.filter(o => a && alnum(o).endsWith(a) && digits(alnum(o)) === digits(a));
    return ends.length === 1 ? ends[0] : value;
  }
  function fitName(nombres, apellidos, maxlen) {
    const n = nombres.split(/\s+/).filter(Boolean), a = apellidos.split(/\s+/).filter(Boolean);
    const opts = [n.concat(a), n.slice(0, 1).concat(a), n.slice(0, 1).concat(a.slice(0, 1))];
    for (const o of opts) { const s = o.join(" "); if (!maxlen || s.length <= maxlen) return s; }
    return opts[2].join(" ").slice(0, maxlen);
  }
  function isKidsCourse(v) {
    const text = ["curso", "modulo", "programa"].map(k => v[k] || "").join(" ").toUpperCase();
    return /(ING[BI]|CONS)\W?[KT]\d/.test(text) || text.includes("KIDS") || text.includes("TEENS");
  }

  // ------------------------------------------------------------------ coincidencia de nombres (Classroom)
  function normTokens(text) {
    return fold(text).split(/[^a-z0-9]+/).filter(t => t.length > 1);
  }
  function seqRatio(a, b) {           // equivalente a difflib.SequenceMatcher(None, a, b).ratio()
    function matches(a, b) {
      if (!a.length || !b.length) return 0;
      let best = 0, bi = 0, bj = 0;
      for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
        let k = 0;
        while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
        if (k > best) { best = k; bi = i; bj = j; }
      }
      if (!best) return 0;
      return best + matches(a.slice(0, bi), b.slice(0, bj)) + matches(a.slice(bi + best), b.slice(bj + best));
    }
    return a.length + b.length ? 2 * matches(a, b) / (a.length + b.length) : 1;
  }
  function tokEq(a, b) { return a === b || (a.length >= 4 && b.length >= 4 && seqRatio(a, b) >= 0.85); }
  function nameScore(pdfTokens, rosterTokens) {
    const pool = rosterTokens.slice();
    let common = 0;
    for (const t of pdfTokens) {
      const i = pool.findIndex(r => tokEq(t, r));
      if (i >= 0) { common++; pool.splice(i, 1); }
    }
    return [common, common / Math.max(1, Math.min(pdfTokens.length, rosterTokens.length))];
  }
  /** files: [[key, tokens]], students: [[userId, tokens]] → {key: [userId|null, 'alta'|'revisar'|'sin coincidencia']} */
  function matchStudents(files, students) {
    const pairs = [];
    for (const [fk, ft] of files) for (const [sid, st] of students) {
      const [c, r] = nameScore(ft, st);
      if (c) pairs.push([c, r, fk, sid]);
    }
    pairs.sort((x, y) => (y[0] - x[0]) || (y[1] - x[1]));
    const byFile = {};
    for (const [c, r, fk, sid] of pairs) (byFile[fk] = byFile[fk] || []).push([c, r, sid]);
    const usedF = new Set(), usedS = new Set(), result = {};
    for (const [c, r, fk, sid] of pairs) {
      if (usedF.has(fk) || usedS.has(sid)) continue;
      usedF.add(fk); usedS.add(sid);
      const tied = byFile[fk].filter(x => x[2] !== sid && x[0] === c && x[1] === r);
      result[fk] = [sid, c >= 2 && !tied.length ? "alta" : "revisar"];
    }
    for (const [fk] of files) if (!(fk in result)) result[fk] = [null, "sin coincidencia"];
    return result;
  }

  const api = {
    fold, alnum, clean, pageModel, buildModel, extractFields, zoneRect, CBA_FORMAT, FIELD_TYPES, NAME_ORDERS,
    NAME_FORMATS, normFormat, detectFormat, formatVarNames, splitName, deriveVars, pageVars, applyCase, sanitize,
    renderTemplate, buildPlan, uniqueName, stem, ITEMS, ITEM_NAMES, SKILL_FOR, SKILLS, SKILL_NAMES, DATOS,
    TEXT_DATOS, CONDS, LEVELS, DEFAULT_RULES, readGrades, hasGrades, lowestMini, evaluate, describeRule,
    analyzeTemplate, matchOption, fitName, isKidsCourse, normTokens, seqRatio, matchStudents, rightOf, findLabel,
  };
  root.RenameItCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
