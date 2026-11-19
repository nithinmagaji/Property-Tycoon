if (location.protocol === "file:") {
  const bar = document.createElement("div");
  bar.setAttribute("role", "alert");
  bar.style.cssText =
    "background:#f3c65e;color:#172337;padding:10px 14px;text-align:center;font-weight:800;font-size:13px";
  bar.innerHTML =
    "Open via a local server: run <code>npm start</code>, then visit <code>http://localhost:3000</code>";
  document.body.prepend(bar);
}

window.addEventListener("error", (e) => {
  const t = document.getElementById("toast");
  if (t) {
    t.textContent = "Script error — refresh the page or run npm start (see README).";
    t.classList.add("show");
  }
  console.error(e.error || e.message);
});
