document.addEventListener("DOMContentLoaded", () => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelector("#status").textContent = "ready";
    });
  });
});

