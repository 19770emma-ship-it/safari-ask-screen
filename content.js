// Content script: panel flotante estilo vidrio (Shadow DOM, aislado de los estilos de la pagina).
(() => {
  if (window.top !== window) return; // solo en el frame principal
  if (window.__x7f3q9) return; // bandera interna para no inyectarse dos veces
  window.__x7f3q9 = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const MAX_PAGE_CHARS = 60000;
  // Id aleatorio por carga de pagina: evita que un selector fijo en el DOM
  // identifique a simple vista que esta extension (y no otra) esta activa.
  const HOST_ID = "x-" + Math.random().toString(36).slice(2, 10);
  const MAX_HISTORY = 12; // mensajes previos enviados como contexto

  let host = null;
  let root = null;
  let panel = null;
  let history = []; // {role, text}
  let busy = false;
  let closeTimer = null;

  const ICONS = {
    close: '<svg viewBox="0 0 24 24"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
    reset: '<svg viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4.5 4.5v4h4"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M12 18.5V6M6.8 11.2L12 6l5.2 5.2"/></svg>',
    camera:
      '<svg viewBox="0 0 24 24"><path d="M4 9a2.5 2.5 0 0 1 2.5-2.5h1.1l1-1.5h6.8l1 1.5h1.1A2.5 2.5 0 0 1 20 9v7.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.8" r="3.2"/></svg>',
    spark:
      '<svg viewBox="0 0 24 24"><path d="M11 3.5l1.7 4.8 4.8 1.7-4.8 1.7L11 16.5l-1.7-4.8L4.5 10l4.8-1.7z"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/></svg>',
    minimize: '<svg viewBox="0 0 24 24"><path d="M6 10l6 6 6-6"/></svg>',
  };

  const css = `
    :host { all: initial; }
    * { box-sizing: border-box; }

    .panel {
      --bg: rgba(248, 248, 250, 0.78);
      --fg: #1d1d1f;
      --muted: rgba(60, 60, 67, 0.62);
      --line: rgba(60, 60, 67, 0.16);
      --field: rgba(120, 120, 128, 0.12);
      --bot: rgba(120, 120, 128, 0.14);
      --accent: #0a84ff;
      --accent2: #0066d6;
      --err-bg: rgba(255, 59, 48, 0.14);
      --err-fg: #c4271c;
      position: fixed; right: 20px; bottom: 20px;
      width: 392px; height: 560px;
      max-width: calc(100vw - 24px); max-height: calc(100vh - 24px);
      display: flex; flex-direction: column; overflow: hidden;
      color: var(--fg); background: var(--bg);
      -webkit-backdrop-filter: blur(30px) saturate(180%);
      backdrop-filter: blur(30px) saturate(180%);
      border: 0.5px solid var(--line); border-radius: 22px;
      box-shadow: 0 28px 70px rgba(0,0,0,.30), 0 3px 10px rgba(0,0,0,.12), inset 0 0.5px 0 rgba(255,255,255,.55);
      font: 14px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
      -webkit-font-smoothing: antialiased;
      z-index: 2147483647;
      transform-origin: bottom right;
      animation: pop-in .45s cubic-bezier(.2, .9, .25, 1.12) both;
    }
    .panel.closing { animation: pop-out .22s cubic-bezier(.4, 0, 1, 1) both; }
    @keyframes pop-in  { from { opacity: 0; transform: translateY(20px) scale(.94); } to { opacity: 1; transform: none; } }
    @keyframes pop-out { to { opacity: 0; transform: translateY(12px) scale(.96); } }

    svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; display: block; }

    /* Cabecera */
    header { display: flex; align-items: center; gap: 10px; padding: 12px 12px 10px 14px; cursor: grab; user-select: none; touch-action: none; }
    header:active { cursor: grabbing; }
    .orb { width: 32px; height: 32px; border-radius: 50%; flex: none; display: grid; place-items: center; color: #fff;
      background: linear-gradient(135deg, #64d2ff, #0a84ff 55%, #5e5ce6); box-shadow: 0 4px 12px rgba(10,132,255,.4); transition: transform .4s cubic-bezier(.2,.9,.25,1.3); }
    .orb svg { width: 17px; height: 17px; stroke-width: 1.7; }
    .panel.busy .orb { animation: orb-pulse 1.4s ease-in-out infinite; }
    .panel.busy .orb svg { animation: spin-slow 3s linear infinite; }
    @keyframes orb-pulse { 0%,100% { transform: scale(1); box-shadow: 0 4px 12px rgba(10,132,255,.4); } 50% { transform: scale(1.1); box-shadow: 0 6px 20px rgba(94,92,230,.6); } }
    @keyframes spin-slow { to { transform: rotate(360deg); } }
    .titles { flex: 1; min-width: 0; }
    .title { font-weight: 600; font-size: 14px; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .status { font-size: 12px; color: var(--muted); transition: opacity .2s; }

    .icon-btn { width: 30px; height: 30px; border-radius: 50%; border: 0; padding: 0; cursor: pointer; display: grid; place-items: center;
      color: var(--muted); background: transparent; transition: background .2s, color .2s, transform .25s cubic-bezier(.2,.9,.25,1.4); }
    .icon-btn:hover { background: var(--field); color: var(--fg); }
    .icon-btn:active { transform: scale(.86); }
    #close:hover svg { transform: rotate(90deg); }
    #close svg, #reset svg, #min svg { transition: transform .35s cubic-bezier(.2,.9,.25,1.3); }
    #reset.spin svg { transform: rotate(-360deg); }
    #min svg { transform: rotate(0deg); }
    .panel.minimized #min svg { transform: rotate(180deg); }

    /* Minimizar: colapsa todo menos la cabecera, sin cerrar la conversacion */
    .body { display: flex; flex-direction: column; flex: 1; min-height: 0;
      max-height: 600px; opacity: 1; transition: max-height .32s cubic-bezier(.2,.9,.25,1), opacity .22s ease; }
    .panel.minimized { height: auto !important; }
    .panel.minimized .body { max-height: 0; opacity: 0; pointer-events: none; }
    .panel.minimized header { cursor: pointer; }

    /* Mensajes */
    .msgs { flex: 1; overflow-y: auto; padding: 6px 14px 12px; display: flex; flex-direction: column; gap: 8px; scroll-behavior: smooth; overscroll-behavior: contain; }
    .msgs::-webkit-scrollbar { width: 8px; } .msgs::-webkit-scrollbar-thumb { background: var(--line); border-radius: 8px; }
    .msg { max-width: 88%; padding: 9px 13px; border-radius: 18px; word-wrap: break-word; user-select: text; animation: msg-in .42s cubic-bezier(.2, .9, .25, 1.15) both; }
    @keyframes msg-in { from { opacity: 0; transform: translateY(12px) scale(.95); } to { opacity: 1; transform: none; } }
    .msg.user { align-self: flex-end; color: #fff; border-bottom-right-radius: 6px; background: linear-gradient(180deg, var(--accent), var(--accent2)); white-space: pre-wrap; transform-origin: bottom right; }
    .msg.bot { align-self: flex-start; background: var(--bot); border-bottom-left-radius: 6px; transform-origin: bottom left; }
    .msg.err { align-self: flex-start; background: var(--err-bg); color: var(--err-fg); border-bottom-left-radius: 6px; white-space: pre-wrap; }
    .msg.bot p { margin: 0 0 6px; } .msg.bot p:last-child, .msg.bot ul:last-child, .msg.bot ol:last-child { margin-bottom: 0; }
    .msg.bot ul, .msg.bot ol { margin: 0 0 6px; padding-left: 20px; } .msg.bot li { margin: 2px 0; }
    .msg.bot code { font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; background: rgba(120,120,128,.2); padding: 1px 5px; border-radius: 6px; }
    .msg.bot pre { margin: 4px 0 6px; padding: 9px 11px; background: rgba(120,120,128,.18); border-radius: 12px; overflow-x: auto; }
    .msg.bot pre code { background: none; padding: 0; }

    .typing { display: flex; gap: 5px; align-items: center; padding: 13px 15px; }
    .typing i { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); animation: bounce 1.2s ease-in-out infinite; }
    .typing i:nth-child(2) { animation-delay: .15s; } .typing i:nth-child(3) { animation-delay: .3s; }
    @keyframes bounce { 0%,60%,100% { transform: translateY(0); opacity: .45; } 30% { transform: translateY(-5px); opacity: 1; } }

    /* Estado vacio */
    .empty { margin: auto; text-align: center; padding: 0 10px; display: flex; flex-direction: column; align-items: center; gap: 6px; animation: msg-in .6s cubic-bezier(.2,.9,.25,1.15) both; }
    .empty .big { width: 54px; height: 54px; border-radius: 50%; display: grid; place-items: center; color: #fff; margin-bottom: 4px;
      background: linear-gradient(135deg, #64d2ff, #0a84ff 55%, #5e5ce6); box-shadow: 0 10px 26px rgba(10,132,255,.4); animation: float 3.4s ease-in-out infinite; }
    .empty .big svg { width: 26px; height: 26px; stroke-width: 1.6; }
    @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    .empty h3 { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -.02em; }
    .empty p { margin: 0 0 8px; color: var(--muted); font-size: 13px; }
    .chips { display: flex; flex-direction: column; gap: 6px; width: 100%; }
    .chip { border: 0; cursor: pointer; font: inherit; font-size: 13px; color: var(--fg); background: var(--field); padding: 9px 12px; border-radius: 14px; text-align: left;
      transition: transform .25s cubic-bezier(.2,.9,.25,1.4), background .2s; }
    .chip:hover { background: rgba(10,132,255,.16); transform: translateX(3px); }
    .chip:active { transform: scale(.97); }

    /* Pie */
    footer { padding: 6px 12px 12px; display: flex; flex-direction: column; gap: 8px; }
    .toggle { display: inline-flex; align-items: center; gap: 8px; align-self: flex-start; cursor: pointer; font-size: 12px; color: var(--muted); user-select: none; }
    .toggle input { position: absolute; opacity: 0; pointer-events: none; }
    .track { width: 34px; height: 20px; border-radius: 12px; background: rgba(120,120,128,.32); position: relative; transition: background .3s; flex: none; }
    .thumb { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.3); transition: transform .35s cubic-bezier(.2,.9,.25,1.3), width .2s; }
    .toggle:active .thumb { width: 20px; }
    .toggle input:checked + .track { background: #34c759; }
    .toggle input:checked + .track .thumb { transform: translateX(14px); }
    .toggle:active input:checked + .track .thumb { transform: translateX(10px); }
    .toggle .cam svg { width: 15px; height: 15px; }
    .toggle input:checked ~ .cam { color: var(--accent); }
    .toggle .cam, .toggle span { transition: color .25s; }

    .composer { display: flex; align-items: flex-end; gap: 6px; padding: 5px 5px 5px 14px; border-radius: 22px; background: var(--field); border: 0.5px solid transparent; transition: border-color .25s, box-shadow .25s, background .25s; }
    .composer:focus-within { border-color: rgba(10,132,255,.55); box-shadow: 0 0 0 4px rgba(10,132,255,.16); background: transparent; }
    textarea { flex: 1; resize: none; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; padding: 6px 0; height: 32px; max-height: 120px; line-height: 20px; }
    textarea::placeholder { color: var(--muted); }
    .send { width: 32px; height: 32px; border-radius: 50%; border: 0; padding: 0; cursor: pointer; display: grid; place-items: center; flex: none; color: #fff;
      background: var(--accent); transform: scale(1); transition: transform .3s cubic-bezier(.2,.9,.25,1.5), opacity .25s, background .25s; }
    .send svg { width: 17px; height: 17px; stroke-width: 2.2; transition: transform .3s cubic-bezier(.2,.9,.25,1.4); }
    .send:hover:not(:disabled) svg { transform: translateY(-2px); }
    .send:active:not(:disabled) { transform: scale(.88); }
    .send:disabled { opacity: .35; transform: scale(.88); cursor: default; background: rgba(120,120,128,.6); }

    @media (prefers-color-scheme: dark) {
      .panel { --bg: rgba(30, 30, 32, 0.76); --fg: #f5f5f7; --muted: rgba(235, 235, 245, 0.6); --line: rgba(255,255,255,.14);
        --field: rgba(120, 120, 128, 0.24); --bot: rgba(120, 120, 128, 0.26); --err-bg: rgba(255, 69, 58, 0.22); --err-fg: #ff9a92;
        box-shadow: 0 28px 70px rgba(0,0,0,.6), 0 3px 10px rgba(0,0,0,.4), inset 0 0.5px 0 rgba(255,255,255,.12); }
    }
    @keyframes fade-in  { from { opacity: 0; } to { opacity: 1; } }
    @keyframes fade-out { to { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      /* Sin movimiento: nada se desplaza, escala ni gira. Solo fundidos suaves y cambios de color. */
      *, *::before, *::after { animation: none !important; transition-property: background-color, color, border-color, box-shadow, opacity !important; transition-duration: .15s !important; transition-timing-function: ease !important; }
      .panel { animation: fade-in .15s ease both !important; }
      .panel.closing { animation: fade-out .15s ease both !important; }
      .msg, .empty { animation: fade-in .2s ease both !important; }
      .msgs { scroll-behavior: auto; }
      .orb, .orb svg, .send, .send svg, .chip, button, button svg, #reset.spin svg { transform: none !important; }
      /* La flecha de #min no es decorativa: su rotacion indica expandido/colapsado,
         asi que se excluye de la regla anterior y se fuerza aqui con mayor especificidad. */
      #min svg { transform: rotate(0deg) !important; }
      .panel.minimized #min svg { transform: rotate(180deg) !important; }
      .typing i { opacity: .7; }
      .typing i:nth-child(1) { opacity: .4; } .typing i:nth-child(3) { opacity: 1; }
    }
  `;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function build() {
    host = document.createElement("div");
    host.id = HOST_ID;
    root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>${css}</style>
      <div class="panel" role="dialog" aria-label="Preg\u00fantale a mi pantalla">
        <header id="drag">
          <div class="orb">${ICONS.spark}</div>
          <div class="titles"><div class="title">Preg\u00fantale a mi pantalla</div><div class="status" id="status">Lista para leer esta p\u00e1gina</div></div>
          <button class="icon-btn" id="reset" title="Nueva conversaci\u00f3n" aria-label="Nueva conversaci\u00f3n">${ICONS.reset}</button>
          <button class="icon-btn" id="min" title="Minimizar" aria-label="Minimizar">${ICONS.minimize}</button>
          <button class="icon-btn" id="close" title="Cerrar (Esc)" aria-label="Cerrar">${ICONS.close}</button>
        </header>
        <div class="body" id="body">
          <div class="msgs" id="msgs"></div>
          <footer>
            <label class="toggle" title="Env\u00eda tambi\u00e9n una imagen de lo que ves">
              <input type="checkbox" id="shot" checked>
              <span class="track"><span class="thumb"></span></span>
              <span class="cam">${ICONS.camera}</span><span>Incluir captura</span>
            </label>
            <div class="composer">
              <textarea id="q" rows="1" placeholder="Pregunta sobre esta p\u00e1gina\u2026"></textarea>
              <button class="send" id="send" aria-label="Enviar" disabled>${ICONS.send}</button>
            </div>
          </footer>
        </div>
      </div>`;
    const $ = (id) => root.getElementById(id);
    panel = root.querySelector(".panel");

    // Que los atajos del sitio no interfieran mientras escribes en el panel; Esc cierra
    ["keydown", "keyup", "keypress"].forEach((t) =>
      root.addEventListener(t, (e) => {
        if (t === "keydown" && e.key === "Escape") {
          if (panel.classList.contains("minimized")) setMinimized(false); else hide();
        }
        e.stopPropagation();
      })
    );

    $("close").onclick = hide;
    $("min").onclick = (e) => { e.stopPropagation(); setMinimized(!panel.classList.contains("minimized")); };
    $("drag").addEventListener("click", () => { if (panel.classList.contains("minimized")) setMinimized(false); });
    $("reset").onclick = () => {
      const b = $("reset");
      b.classList.remove("spin"); void b.offsetWidth; b.classList.add("spin");
      history = [];
      renderEmpty();
    };
    $("send").onclick = send;
    const ta = $("q");
    const sync = () => {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
      $("send").disabled = busy || !ta.value.trim();
    };
    ta.addEventListener("input", sync);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    ta._sync = sync;

    enableDrag($("drag"));
    renderEmpty();
    document.documentElement.appendChild(host);
  }

  function setMinimized(on) {
    panel.classList.toggle("minimized", on);
    $("min").title = on ? "Restaurar" : "Minimizar";
    $("min").setAttribute("aria-label", on ? "Restaurar" : "Minimizar");
    if (!on) $("q").focus();
  }

  function enableDrag(handle) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      if (panel.classList.contains("minimized")) return; // clic en cabecera minimizada = expandir, no arrastrar
      const r = panel.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      panel.style.right = "auto"; panel.style.bottom = "auto";
      panel.style.left = r.left + "px"; panel.style.top = r.top + "px";
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const x = Math.min(Math.max(8, ev.clientX - dx), window.innerWidth - r.width - 8);
        const y = Math.min(Math.max(8, ev.clientY - dy), window.innerHeight - r.height - 8);
        panel.style.left = x + "px"; panel.style.top = y + "px";
      };
      const up = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  }

  const $ = (id) => root.getElementById(id);

  function setStatus(t) { $("status").textContent = t; }

  function renderEmpty() {
    const box = $("msgs");
    box.textContent = "";
    const wrap = el("div", "empty");
    const big = el("div", "big"); big.innerHTML = ICONS.spark;
    wrap.append(big, el("h3", null, "\u00bfQu\u00e9 quieres saber?"), el("p", null, "Leo esta p\u00e1gina y te respondo."));
    const chips = el("div", "chips");
    ["Resume esta p\u00e1gina", "\u00bfQu\u00e9 es lo m\u00e1s importante aqu\u00ed?", "Expl\u00edcame lo que estoy viendo"].forEach((t) => {
      const b = el("button", "chip", t);
      b.onclick = () => { $("q").value = t; $("q")._sync(); send(); };
      chips.append(b);
    });
    wrap.append(chips);
    box.append(wrap);
    setStatus("Lista para leer esta p\u00e1gina");
  }

  // Mini-markdown seguro: se construye con nodos DOM, nunca con innerHTML.
  function inline(parent, text) {
    text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/).forEach((part) => {
      if (!part) return;
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) parent.append(el("strong", null, part.slice(2, -2)));
      else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) parent.append(el("code", null, part.slice(1, -1)));
      else if (part.startsWith("*") && part.endsWith("*") && part.length > 2) parent.append(el("em", null, part.slice(1, -1)));
      else parent.append(document.createTextNode(part));
    });
  }

  function renderMarkdown(target, text) {
    target.textContent = "";
    let list = null, code = null;
    for (const line of text.replace(/\r/g, "").split("\n")) {
      if (line.trim().startsWith("```")) {
        if (code) { code = null; } else { const pre = el("pre"); code = el("code"); pre.append(code); target.append(pre); list = null; }
        continue;
      }
      if (code) { code.textContent += (code.textContent ? "\n" : "") + line; continue; }
      const ul = /^\s*[*\-\u2022]\s+(.*)$/.exec(line);
      const ol = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
      if (ul || ol) {
        const kind = ul ? "ul" : "ol";
        if (!list || list.tagName.toLowerCase() !== kind) { list = el(kind); target.append(list); }
        const li = el("li"); inline(li, ul ? ul[1] : ol[2]); list.append(li);
        continue;
      }
      list = null;
      if (!line.trim()) continue;
      const h = /^#{1,6}\s+(.*)$/.exec(line);
      const p = el("p");
      if (h) { const s = el("strong"); inline(s, h[1]); p.append(s); } else inline(p, line);
      target.append(p);
    }
  }

  function addMsg(kind, text) {
    const box = $("msgs");
    const empty = box.querySelector(".empty");
    if (empty) empty.remove();
    const m = el("div", "msg " + kind);
    if (kind === "bot") renderMarkdown(m, text); else m.textContent = text;
    box.append(m);
    box.scrollTop = box.scrollHeight;
    return m;
  }

  function addTyping() {
    const empty = $("msgs").querySelector(".empty");
    if (empty) empty.remove();
    const m = el("div", "msg bot typing");
    m.append(el("i"), el("i"), el("i"));
    $("msgs").append(m);
    $("msgs").scrollTop = $("msgs").scrollHeight;
    return m;
  }

  function isOpen() { return host && host.style.display !== "none" && !panel.classList.contains("closing"); }

  function show() {
    if (!host) build();
    clearTimeout(closeTimer);
    host.style.display = "";
    panel.classList.remove("closing");
    if (panel.classList.contains("minimized")) setMinimized(false);
    $("q").focus();
  }
  function hide() {
    if (!host || !isOpen()) return;
    panel.classList.add("closing");
    const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    closeTimer = setTimeout(() => { host.style.display = "none"; panel.classList.remove("closing"); }, calm ? 150 : 220);
  }
  function toggle() { isOpen() ? hide() : show(); }

  function readPage() {
    return {
      url: location.href,
      title: document.title,
      text: (document.body?.innerText || "").slice(0, MAX_PAGE_CHARS),
      selection: String(window.getSelection() || "").slice(0, 5000),
    };
  }

  const nextFrames = () =>
    new Promise((r) => requestAnimationFrame(() => setTimeout(r, 20)));

  async function send() {
    if (busy) return;
    const ta = $("q");
    const q = ta.value.trim();
    if (!q) return;
    busy = true;
    panel.classList.add("busy");
    let failed = false;
    let thinking = null;
    try {
      // La captura va PRIMERO (con el panel oculto el menor tiempo posible) y
      // solo despues se muestran el mensaje y los puntos, para que no haya un
      // parpadeo con el chat a medias.
      let screenshot = null;
      if ($("shot").checked) {
        host.style.visibility = "hidden";
        await nextFrames();
        let cap;
        try { cap = await api.runtime.sendMessage({ type: "capture" }); }
        finally { host.style.visibility = "visible"; }
        if (cap?.error) throw new Error(cap.error);
        screenshot = cap?.dataUrl || null;
      }
      ta.value = ""; ta._sync();
      addMsg("user", q);
      thinking = addTyping();
      setStatus("Pensando\u2026");

      const res = await api.runtime.sendMessage({
        type: "ask",
        question: q,
        history: history.slice(-MAX_HISTORY),
        page: readPage(),
        screenshot,
      });
      if (!res || res.error) throw new Error(res?.error || "Sin respuesta de la extensi\u00f3n.");

      thinking.classList.remove("typing");
      renderMarkdown(thinking, res.text);
      history.push({ role: "user", text: q }, { role: "assistant", text: res.text });
    } catch (e) {
      failed = true;
      host.style.visibility = "visible";
      if (!thinking) { addMsg("user", q); ta.value = ""; ta._sync(); thinking = addTyping(); }
      thinking.classList.remove("typing");
      thinking.className = "msg err";
      thinking.textContent = "Error: " + (e?.message || e);
    } finally {
      busy = false;
      panel.classList.remove("busy");
      setStatus(failed ? "Algo sali\u00f3 mal. Int\u00e9ntalo de nuevo." : "Lista");
      ta._sync();
      ta.focus();
      $("msgs").scrollTop = $("msgs").scrollHeight;
    }
  }

  api.runtime.onMessage.addListener((msg) => { if (msg?.type === "toggle") toggle(); });

  // Atajo: Opcion+Shift+A
  window.addEventListener("keydown", (e) => {
    if (e.altKey && e.shiftKey && e.code === "KeyA") { e.preventDefault(); toggle(); }
  }, true);
})();
