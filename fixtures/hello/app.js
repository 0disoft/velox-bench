document.addEventListener("DOMContentLoaded", () => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelector("#status").textContent = "ready";
      if (typeof globalThis.__veloxReady === "function") {
        globalThis.__veloxReady("dom-2raf");
      }
    });
  });
});
