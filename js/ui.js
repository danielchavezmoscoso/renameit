/* RenameIt web - utilidades de interfaz compartidas por todas las vistas. */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
      else if (v === true) e.setAttribute(k, "");
      else e.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : String(c));
    return e;
  }

  const store = {
    get(k, def) {
      try { const v = localStorage.getItem("renameit." + k); return v === null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    set(k, v) { try { localStorage.setItem("renameit." + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
  };

  // IndexedDB para guardar archivos grandes (formularios de alerta)
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("renameit", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("files");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(key) {
    try {
      const db = await idb();
      return await new Promise((res, rej) => {
        const q = db.transaction("files").objectStore("files").get(key);
        q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
      });
    } catch (e) { return undefined; }
  }
  async function idbSet(key, val) {
    try {
      const db = await idb();
      await new Promise((res, rej) => {
        const tx = db.transaction("files", "readwrite");
        tx.objectStore("files").put(val, key);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
      return true;
    } catch (e) { return false; }
  }

  const listeners = {};
  const bus = {
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    emit(ev, data) { (listeners[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); },
  };

  function modal(opts) {
    const back = el("div", { class: "modal-back" });
    const box = el("div", { class: "modal" + (opts.wide ? " wide" : ""), role: "dialog", "aria-modal": "true" });
    if (opts.title) box.append(el("h2", { text: opts.title }));
    if (opts.body) box.append(opts.body);
    const close = () => { back.remove(); document.removeEventListener("keydown", onKey); if (opts.onClose) opts.onClose(); };
    const acts = el("div", { class: "actions" });
    for (const a of opts.actions || []) {
      const b = el("button", { class: "btn " + (a.cls || ""), text: a.text });
      b.addEventListener("click", async () => {
        if (a.onClick) { const keep = await a.onClick(); if (keep === false) return; }
        close();
      });
      acts.append(b);
    }
    if ((opts.actions || []).length) box.append(acts);
    back.append(box);
    const onKey = e => { if (e.key === "Escape" && opts.escape !== false) close(); };
    document.addEventListener("keydown", onKey);
    back.addEventListener("mousedown", e => { if (e.target === back && opts.escape !== false) close(); });
    document.body.append(back);
    const first = box.querySelector("input, select, textarea, button.primary");
    if (first) setTimeout(() => first.focus(), 30);
    return { close, box };
  }
  function confirmBox(title, text, okText) {
    return new Promise(res => {
      let ok = false;
      modal({ title, body: el("p", { text, style: { whiteSpace: "pre-line" } }), onClose: () => res(ok),
        actions: [{ text: "Cancelar" }, { text: okText || "Continuar", cls: "primary", onClick: () => { ok = true; } }] });
    });
  }
  function alertBox(title, text) {
    return new Promise(res => modal({ title, body: el("p", { text, style: { whiteSpace: "pre-line" } }), onClose: res,
      actions: [{ text: "Entendido", cls: "primary" }] }));
  }

  let toastTimer = null;
  function toast(msg) {
    let t = $(".toast");
    if (!t) { t = el("div", { class: "toast" }); document.body.append(t); }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  function download(name, blob) {
    const a = el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  const canPickFolder = typeof window.showDirectoryPicker === "function";

  /** files: [{name, bytes}] → guarda como .zip o en una carpeta elegida. Devuelve un texto para mostrar. */
  async function saveFiles(files, mode, zipName, subfolder) {
    if (mode === "folder" && canPickFolder) {
      let dir;
      try { dir = await window.showDirectoryPicker({ id: "renameit", mode: "readwrite" }); }
      catch (e) { return null; }
      if (subfolder) dir = await dir.getDirectoryHandle(subfolder, { create: true });
      for (const f of files) {
        const h = await dir.getFileHandle(f.name, { create: true });
        const w = await h.createWritable();
        await w.write(f.bytes); await w.close();
      }
      return `Se guardaron en la carpeta «${subfolder ? dir.name : dir.name}».`;
    }
    const zip = new JSZip();
    for (const f of files) zip.file(f.name, f.bytes);
    const blob = await zip.generateAsync({ type: "blob" });
    download(zipName, blob);
    return `Se descargó «${zipName}» (revisa tu carpeta de Descargas).`;
  }

  async function readFile(file) { return new Uint8Array(await file.arrayBuffer()); }
  function pickFiles(input) {
    return new Promise(res => {
      input.value = "";
      input.onchange = () => res(Array.from(input.files || []));
      input.click();
    });
  }
  function setSteps(container, steps, current) {
    container.innerHTML = "";
    steps.forEach((s, i) => {
      if (i) container.append(el("span", { class: "sep", text: "›" }));
      const cls = i < current ? "step done" : i === current ? "step current" : "step";
      container.append(el("span", { class: cls }, el("span", { class: "dot", text: i < current ? "✓" : String(i + 1) }), s));
    });
  }
  function esc(s) { return String(s === undefined || s === null ? "" : s); }

  window.UI = { $, $$, el, store, idbGet, idbSet, bus, modal, confirmBox, alertBox, toast, download, saveFiles,
    canPickFolder, readFile, pickFiles, setSteps, esc };
})();
