if (typeof globalThis.Neutralino?.init === "function") {
  globalThis.Neutralino.init();
}

document.addEventListener("DOMContentLoaded", () => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelector("#status").textContent = "ready";
      if (typeof globalThis.__actutumReady === "function") {
        globalThis.__actutumReady("dom-2raf");
      } else if (typeof globalThis.go?.main?.Bench?.Ready === "function") {
        globalThis.go.main.Bench.Ready("dom-2raf");
      } else if (typeof globalThis.Neutralino?.window?.setTitle === "function") {
        globalThis.Neutralino.window.setTitle("Actutum Bench Ready");
      }
    });
  });
});
