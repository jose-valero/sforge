// Un solo camino de datos: los agentes/fases escriben, cualquier lector hace
// poll. Sin ingest endpoint, sin websocket. node:sqlite es nativo de Node 22+
// (sin dependencias binarias que compilar) — por eso lo elegimos sobre
// better-sqlite3 para esta capa: orbit-core debe instalarse en cualquier
// maquina sin fricciones de compilacion.

import { DatabaseSync, type StatementSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export interface TraceEvent {
  id: number;
  runId: string;
  phaseId: string | null;
  parentId: string | null;
  kind: string;
  payload: string;
  at: string;
}

export class Trace {
  private db: DatabaseSync;
  private insertStmt: StatementSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        phase_id TEXT,
        parent_id TEXT,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        at TEXT NOT NULL
      );
    `);
    this.insertStmt = this.db.prepare(
      "INSERT INTO events (run_id, phase_id, parent_id, kind, payload, at) VALUES (?, ?, ?, ?, ?, ?)",
    );
  }

  log(evt: {
    runId: string;
    phaseId: string | null;
    parentId: string | null;
    kind: string;
    payload: unknown;
  }): void {
    this.insertStmt.run(
      evt.runId,
      evt.phaseId,
      evt.parentId,
      evt.kind,
      JSON.stringify(evt.payload),
      new Date().toISOString(),
    );
  }

  // La vista "en vivo" y el historial completo son la misma consulta a
  // distinta cadencia: un cursor por rowid, nada mas.
  since(runId: string, cursor = 0): TraceEvent[] {
    const stmt = this.db.prepare(
      "SELECT * FROM events WHERE run_id = ? AND id > ? ORDER BY id LIMIT 500",
    );
    const rows = stmt.all(runId, cursor) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r["id"] as number,
      runId: r["run_id"] as string,
      phaseId: r["phase_id"] as string | null,
      parentId: r["parent_id"] as string | null,
      kind: r["kind"] as string,
      payload: r["payload"] as string,
      at: r["at"] as string,
    }));
  }

  close(): void {
    this.db.close();
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}
