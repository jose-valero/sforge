export * from "./types.js";
export * from "./envelope.js";
export * from "./gate.js";
export * from "./permissions.js";
export * from "./trace.js";
export * from "./substrate.js";
export * from "./phase.js";
export * from "./run.js";

// Capa 0 — adaptadores de sustrato
export * from "./substrates/router.js";
export * from "./substrates/claude-code.js";
export * from "./substrates/handoff.js";

// Capa 2 — aislamiento
export * from "./isolation/worktree.js";

// Capa 3 — catalogo de capacidades
export * from "./catalog/types.js";
export * from "./catalog/parse.js";
export * from "./catalog/manifest.js";
export * from "./catalog/evals.js";

// Observabilidad — visor en vivo del Trace
export * from "./observability/trace-server.js";
