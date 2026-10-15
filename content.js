// Content script: panel flotante (Shadow DOM, aislado de los estilos de la página).
(() => {
  if (window.top !== window) return; // solo en el frame principal
  if (window.__askScreenLoaded) return;
  window.__askScreenLoaded = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const MAX_PAGE_CHARS = 60000;
  const MAX_HISTORY = 12; // mensajes previos enviados como contexto

  let host = null;
  let root = null;
  let history = []; // {role, text}
  let busy = false;

  const css = `
    :host { all: initial; }
    .panel { position: fixed; right: 16px; bottom: 16px; width: 380px; height: 520px;
      max-height: calc(100vh - 32px); display: flex; flex-direction: column;
      background: #fff; color: #1f1f1f; border: 1px solid #d0d0d0; border-radius: 14px;
      box-shadow: 0 10px 40px rgba(0,0,0,.28); font: 14px/1.45 -apple-system, system-ui, sans-serif;
      z-index: 2147483647; overflow: hidden; }
    header { border-color: #3a3a3c; } footer { border-color: #3a3a3c; }
    }
    header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #e5e5e5; }
    header strong { flex: 1; font-size: 14px; }
    button { font: inherit; cursor: pointer; border: 0; border-radius: 8px; padding: 6px 10px; }
    .ghost { background: transparent; color: inherit; opacity: .7; } .ghost:hover { opacity: 1; }
    .msgs { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .msg { padding: 8px 11px; border-radius: 12px; max-width: 92%; white-space: pre-wrap; word-wrap: break-word; user-select: text; }
    .msg.user { align-self: flex-end; background: #d97757; color: #fff; }
    .msg.bot { align-self: flex-start; background: #f1f1f1; color: #1f1f1f; }
    .msg.err { align-self: flex-start; background: #fde7e7; color: #8a1c1c; }
    .hint { opacity: .6; font-size: 13px; text-align: center; margin: auto 8px; }
    footer { border-top: 1px solid #e5e5e5; padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 6px; }
    label { font-size: 12px; opacity: .8; display: flex; align-items: center; gap: 6px; }
    .row { display: flex; gap: 6px; align-items: flex-end; }
    textarea { flex: 1; resize: none; height: 54px; padding: 8px; border: 1px solid #ccc; border-radius: 8px; font: inherit; }
    .send { background: #d97757; color: #fff; height: 36px; } .send:disabled { opacity: .5; cursor: default; }
    @media (prefers-color-scheme: dark) {
      .panel { background: #1e1e20; color: #ececec; border-color: #3a3a3c; }
      .msg.bot { background: #2c2c2e; color: #ececec; }
      .msg.err { background: #4a1f1f; color: #ffb4b4; }
      textarea { background: #2c2c2e; color: #ececec; border-color: #48484a; }
      header, footer { border-color: #3a3a3c; }
    }
  `;

  function build() {
    host = document.createElement("div");
    host.id = "ask-screen-host";
    root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>${css}</style>
      <div class="panel" role="dialog" aria-label="Pregúntale a mi pantalla">
        <header>
          <strong>Pregúntale a mi pantalla</strong>
          <button class="ghost" id="clear" title="Nueva conversación">Limpiar</button>
          <button class="ghost" id="close" title="Cerrar (Opción+Shift+A)">✕</button>
        </header>
        <div class="msgs" id="msgs"><div class="hint" id="hint">Pregunta lo que quieras sobre esta página.<br>Opción+Shift+A abre/cierra el panel.</div></div>
        <footer>
          <label><input type="checkbox" id="shot" checked> Incluir captura de la pestaña</label>
          <div class="row">
            <textarea id="q" placeholder="Escribe tu duda… (Enter envía, Shift+Enter salto de línea)"></textarea>
            <button class="send" id="send">Enviar</button>
          </div>
        </footer>
      </div>`;
    const $ = (id) => root.getElementById(id);

    // Que los atajos del sitio no interfieran mientras escribes en el panel
    ["keydown", "keyup", "keypress"].forEach((t) =>
      root.addEventListener(t, (e) => e.stopPropagation())
    );

    $("close").onclick = hide;
    $("clear").onclick = () => { history = []; $("msgs").innerHTML = ""; $("msgs").append(hintEl()); };
    $("send").onclick = send;
    $("q").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    document.documentElement.appendChild(host);
  }

  const hintEl = () => {
    const d = document.createElement("div");
    d.className = "hint"; d.id = "hint";
    d.innerHTML = "Pregunta lo que quieras sobre esta página.<br>Opción+Shift+A abre/cierra el panel.";
    return d;
  };

  const $ = (id) => root.getElementById(id);

  function addMsg(kind, text) {
    const hint = root.getElementById("hint");
    if (hint) hint.remove();
    const m = document.createElement("div");
    m.className = "msg " + kind;
    m.textContent = text; // textContent: nunca interpretamos HTML de la IA
    const box = $("msgs");
    box.appendChild(m);
    box.scrollTop = box.scrollHeight;
    return m;
  }

  function show() { if (!host) build(); host.style.display = ""; $("q").focus(); }
  function hide() { if (host) host.style.display = "none"; }
  function toggle() { (!host || host.style.display === "none") ? show() : hide(); }

  function readPage() {
    return {
      url: location.href,
      title: document.title,
      text: (document.body?.innerText || "").slice(0, MAX_PAGE_CHARS),
      selection: String(window.getSelection() || "").slice(0, 5000),
    };
  }

  const nextFrames = () =>
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))));

  async function send() {
    if (busy) return;
    const q = $("q").value.trim();
    if (!q) return;
    busy = true;
    $("send").disabled = true;
    $("q").value = "";
    addMsg("user", q);
    const thinking = addMsg("bot", "Leyendo la pantalla…");

    try {
      let screenshot = null;
      if ($("shot").checked) {
        // Ocultamos el panel un instante para que no salga en la captura
        host.style.visibility = "hidden";
        await nextFrames();
        const cap = await api.runtime.sendMessage({ type: "capture" });
        host.style.visibility = "visible";
        if (cap?.error) throw new Error(cap.error);
        screenshot = cap?.dataUrl || null;
      }
      thinking.textContent = "Pensando…";

      const res = await api.runtime.sendMessage({
        type: "ask",
        question: q,
        history: history.slice(-MAX_HISTORY),
        page: readPage(),
        screenshot,
      });
      if (!res || res.error) throw new Error(res?.error || "Sin respuesta de la extensión.");

      thinking.textContent = res.text;
      history.push({ role: "user", text: q }, { role: "assistant", text: res.text });
    } catch (e) {
      host.style.visibility = "visible";
      thinking.className = "msg err";
      thinking.textContent = "Error: " + (e?.message || e);
    } finally {
      busy = false;
      $("send").disabled = false;
      $("q").focus();
      $("msgs").scrollTop = $("msgs").scrollHeight;
    }
  }

  api.runtime.onMessage.addListener((msg) => { if (msg?.type === "toggle") toggle(); });

  // Atajo: Opción+Shift+A
  window.addEventListener("keydown", (e) => {
    if (e.altKey && e.shiftKey && e.code === "KeyA") { e.preventDefault(); toggle(); }
  }, true);
})();
