const api = globalThis.browser ?? globalThis.chrome;
const DEFAULTS = { geminiKey: "", model: "gemini-3.5-flash-lite", blocked: "" };
const $ = (id) => document.getElementById(id);

api.storage.local.get(DEFAULTS).then((s) => {
  $("apiKey").value = s.geminiKey;
  $("model").value = s.model;
  $("blocked").value = s.blocked;
});

$("save").addEventListener("click", async () => {
  await api.storage.local.set({
    geminiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || DEFAULTS.model,
    blocked: $("blocked").value,
  });
  $("status").textContent = "Guardado ✓";
  setTimeout(() => ($("status").textContent = ""), 2000);
});
