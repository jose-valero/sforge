// Visor en vivo del Trace de Capa 1. Sin dependencias nuevas (node:http),
// sin build step. Funciona porque Trace ya abre SQLite en modo WAL
// (src/trace.ts) — un lector en otro proceso puede consultar mientras el
// pipeline sigue escribiendo, sin bloquear a ninguno de los dos.
//
// Esto es el primer tramo real de la capa de reporting que el Laboratorio F
// y el Laboratorio H ya habian senalado como necesaria ("legibilidad es EL
// problema a cierta escala") — no se construyo antes porque no habia nada
// real que mostrar todavia.

import { createServer, type Server } from "node:http";
import { Trace } from "../trace.js";

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>sforge — traza en vivo</title>
<style>
  body { font-family: ui-monospace, "SF Mono", Menlo, monospace; background:#0d1117; color:#c9d1d9; margin:0; padding:24px; }
  h1 { font-size:15px; color:#58a6ff; margin:0 0 4px; letter-spacing:.02em; }
  #meta { color:#6e7681; font-size:12px; margin-bottom:16px; }
  #status { color:#6e7681; font-size:12px; margin-bottom:12px; }
  .event { border-left:3px solid #30363d; padding:6px 10px; margin:4px 0; font-size:13px; background:#161b22; border-radius:0 4px 4px 0; }
  .phase_start { border-color:#58a6ff; }
  .phase_end { border-color:#3fb950; }
  .envelope { border-color:#d29922; }
  .gate_result { border-color:#a371f7; }
  .usage { border-color:#f85149; }
  .run_finish { border-color:#3fb950; font-weight:bold; }
  .kind { font-weight:600; color:#e6edf3; }
  .id { color:#6e7681; }
  .payload { color:#8b949e; white-space:pre-wrap; word-break:break-word; margin-top:2px; }
</style>
</head>
<body>
<h1>sforge — traza en vivo</h1>
<div id="meta"></div>
<div id="status">conectando…</div>
<div id="events"></div>
<script>
  const params = new URLSearchParams(location.search);
  const db = params.get("db");
  const runId = params.get("runId");
  document.getElementById("meta").textContent = "run: " + runId;
  let cursor = 0;
  const el = document.getElementById("events");
  const status = document.getElementById("status");

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  async function poll() {
    try {
      const res = await fetch("/events?db=" + encodeURIComponent(db) + "&runId=" + encodeURIComponent(runId) + "&cursor=" + cursor);
      const events = await res.json();
      for (const e of events) {
        cursor = e.id;
        const div = document.createElement("div");
        div.className = "event " + e.kind;
        div.innerHTML = '<span class="id">#' + e.id + "</span> <span class=\\"kind\\">" + e.kind + "</span>" +
          '<div class="payload">' + escapeHtml(e.payload) + "</div>";
        el.appendChild(div);
        div.scrollIntoView({ block: "nearest" });
      }
      status.textContent = "ultimo evento: #" + cursor + " · " + new Date().toLocaleTimeString();
    } catch (err) {
      status.textContent = "error: " + err;
    }
    setTimeout(poll, 700);
  }
  poll();
</script>
</body>
</html>`;

export function startTraceViewer(port = 4600): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/events") {
      const db = url.searchParams.get("db");
      const runId = url.searchParams.get("runId");
      const cursor = Number(url.searchParams.get("cursor") ?? 0);
      if (!db || !runId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "faltan los parametros db y/o runId" }));
        return;
      }
      try {
        const trace = new Trace(db);
        const events = trace.since(runId, cursor);
        trace.close();
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify(events));
      } catch (err) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([])); // el trace.db puede no existir aun en el primer instante
      }
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(PAGE);
  });

  server.listen(port);
  return server;
}
