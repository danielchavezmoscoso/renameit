/* RenameIt web - Google Classroom y Drive desde el navegador (Google Identity Services + API REST). */
(function () {
  "use strict";
  const SCOPES = [
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.rosters.readonly",
    "https://www.googleapis.com/auth/classroom.profile.emails",
    "https://www.googleapis.com/auth/classroom.courseworkmaterials",
    "https://www.googleapis.com/auth/classroom.topics",
    "https://www.googleapis.com/auth/drive.file",
  ];
  const CL = "https://classroom.googleapis.com/v1";
  const DR = "https://www.googleapis.com/drive/v3";
  let token = null, expires = 0, client = null, clientId = "", account = "";

  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => res();
      s.onerror = () => rej(new Error("No se pudo cargar el inicio de sesión de Google (¿sin internet?)."));
      document.head.append(s);
    });
  }

  async function signIn(id) {
    if (!id) throw new Error("Falta el ID de cliente de Google (Configuración).");
    await loadGis();
    if (!client || clientId !== id) {
      clientId = id;
      client = google.accounts.oauth2.initTokenClient({ client_id: id, scope: SCOPES.join(" "), callback: () => {} });
    }
    const resp = await new Promise((res, rej) => {
      client.callback = r => (r.error ? rej(new Error(r.error_description || r.error)) : res(r));
      client.error_callback = e => rej(new Error(e.type === "popup_closed" ? "Se cerró la ventana de Google." :
        e.type === "popup_failed_to_open" ? "El navegador bloqueó la ventana de Google: permite las ventanas emergentes." : (e.message || e.type)));
      client.requestAccessToken({ prompt: token ? "" : "select_account" });
    });
    if (!google.accounts.oauth2.hasGrantedAllScopes(resp, ...SCOPES)) {
      throw new Error("Faltan permisos: vuelve a iniciar sesión y marca todas las casillas que pide Google.");
    }
    token = resp.access_token;
    expires = Date.now() + (resp.expires_in - 60) * 1000;
    const me = await api("GET", `${CL}/userProfiles/me`);
    account = `${(me.name && me.name.fullName) || ""} <${me.emailAddress || ""}>`;
    return account;
  }
  function signOut() {
    if (token && window.google && google.accounts) google.accounts.oauth2.revoke(token, () => {});
    token = null; account = ""; expires = 0;
  }
  async function ensureToken() {
    if (token && Date.now() < expires) return;
    if (!client) throw new Error("Inicia sesión con Google.");
    await signIn(clientId);    // la sesión dura una hora: se renueva sin volver a preguntar
  }

  async function api(method, url, body, raw) {
    if (method !== "GET" || !url.includes("userProfiles")) await ensureToken();
    const headers = { Authorization: "Bearer " + token };
    let payload;
    if (raw) { payload = raw.body; headers["Content-Type"] = raw.type; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers["Content-Type"] = "application/json"; }
    const r = await fetch(url, { method: method, headers: headers, body: payload });
    const text = await r.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
    if (!r.ok) {
      const msg = (data.error && (data.error.message || data.error.status)) || `${r.status} ${r.statusText}`;
      throw new Error(msg);
    }
    return data;
  }
  async function all(url, key) {
    const out = [];
    let page = "";
    for (;;) {
      const sep = url.includes("?") ? "&" : "?";
      const d = await api("GET", url + (page ? `${sep}pageToken=${encodeURIComponent(page)}` : ""));
      out.push(...(d[key] || []));
      page = d.nextPageToken;
      if (!page) return out;
    }
  }
  const courses = async () => (await all(`${CL}/courses?teacherId=me&courseStates=ACTIVE&pageSize=100`, "courses"))
    .sort((a, b) => ((a.name || "") + (a.section || "")).localeCompare((b.name || "") + (b.section || "")));
  const students = id => all(`${CL}/courses/${id}/students?pageSize=100`, "students");
  const topics = id => all(`${CL}/courses/${id}/topics?pageSize=100`, "topic");
  const createTopic = (id, name) => api("POST", `${CL}/courses/${id}/topics`, { name: name });

  async function ensureFolder(name, parent) {
    const safe = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    let q = `name = '${safe}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    if (parent) q += ` and '${parent}' in parents`;
    const found = await api("GET", `${DR}/files?q=${encodeURIComponent(q)}&spaces=drive&fields=files(id)&pageSize=1`);
    if (found.files && found.files.length) return found.files[0].id;
    const meta = { name: name, mimeType: "application/vnd.google-apps.folder" };
    if (parent) meta.parents = [parent];
    return (await api("POST", `${DR}/files?fields=id`, meta)).id;
  }
  async function uploadPdf(name, bytes, folderId) {
    const boundary = "renameit" + Math.random().toString(16).slice(2);
    const meta = JSON.stringify({ name: name, parents: [folderId] });
    const blob = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`, bytes, `\r\n--${boundary}--`]);
    const d = await api("POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", undefined,
      { body: blob, type: `multipart/related; boundary=${boundary}` });
    return d.id;
  }
  function createMaterial(courseId, studentId, title, description, fileId, topicId, draft) {
    const body = {
      title: title,
      materials: [{ driveFile: { driveFile: { id: fileId }, shareMode: "VIEW" } }],
      state: draft ? "DRAFT" : "PUBLISHED",
      assigneeMode: "INDIVIDUAL_STUDENTS",
      individualStudentsOptions: { studentIds: [studentId] },
    };
    if (description) body.description = description;
    if (topicId) body.topicId = topicId;
    return api("POST", `${CL}/courses/${courseId}/courseWorkMaterials`, body);
  }

  window.GoogleCR = { signIn, signOut, courses, students, topics, createTopic, ensureFolder, uploadPdf, createMaterial,
    get account() { return account; }, get signedIn() { return !!token; } };
})();
