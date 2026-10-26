// Adaptador real de Capa 0: invoca el CLI de `claude` en modo headless
// (`-p --output-format json`) como subproceso. Contrato de CLI verificado
// contra `claude --help` y una llamada real (version 2.1.286) antes de
// escribir esto — no adivinado.
//
// IMPORTANTE: este adaptador no hereda la autenticacion de la sesion que lo
// invoca. Un subproceso nuevo de `claude` necesita su propio login
// (`claude auth login`) o `ANTHROPIC_API_KEY` en el entorno — confirmado
// con `claude doctor` ("not signed in to claude.ai", sin API key) en esta
// misma maquina. Sin uno de los dos, callAgent() lanza con un mensaje claro
// en vez de fallar de forma críptica.

import { spawn } from "node:child_process";
import type { AgentCallParams, AgentCallResult, Substrate } from "../substrate.js";

export type PermissionMode = "acceptEdits" | "auto" | "bypassPermissions" | "manual" | "dontAsk" | "plan";

export interface ClaudeCodeOptions {
  cwd: string;
  /** Alias ('opus', 'sonnet', 'fable', 'haiku'...) o nombre completo. */
  model?: string;
  /** Modelos de respaldo si el principal esta saturado — nativo del CLI (`--fallback-model`). */
  fallbackModels?: string[];
  permissionMode?: PermissionMode;
  /** "host" (default) deja que prompts de permiso lleguen a un humano; "none" los deniega
   *  automaticamente — el default aqui es "none" porque un subproceso headless no tiene humano
   *  esperando, y quedarse colgado es peor que fallar rapido. */
  permissionPrompts?: "host" | "none";
  allowedTools?: string[];
  disallowedTools?: string[];
  maxBudgetUsd?: number;
  /** Ruta al binario, por si no esta en PATH. Default: "claude". */
  binary?: string;
  /** Timeout en ms por llamada. Default: 10 minutos. */
  timeoutMs?: number;
}

// Forma real del JSON que devuelve `claude -p --output-format json`,
// verificada empiricamente (campos confirmados en una respuesta real,
// aunque fuera un error de autenticacion — el shape de "result" es el
// mismo en exito y en fallo, solo cambia is_error y el contenido).
interface ClaudeCliResult {
  type: "result";
  subtype: string;
  is_error: boolean;
  session_id: string;
  result: string;
  total_cost_usd: number;
  duration_ms: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export class ClaudeCodeAuthError extends Error {}

export function claudeCodeSubstrate(opts: ClaudeCodeOptions): Substrate {
  return {
    name: "claude-code",
    async callAgent(params: AgentCallParams): Promise<AgentCallResult> {
      const args = ["-p", params.prompt, "--output-format", "json"];
      if (params.sessionId) args.push("--resume", params.sessionId);

      const model = params.model ?? opts.model;
      if (model) args.push("--model", model);
      if (opts.fallbackModels?.length) args.push("--fallback-model", opts.fallbackModels.join(","));
      if (opts.permissionMode) args.push("--permission-mode", opts.permissionMode);
      args.push("--permission-prompts", opts.permissionPrompts ?? "none");
      if (opts.allowedTools?.length) args.push("--allowedTools", opts.allowedTools.join(","));
      if (opts.disallowedTools?.length) args.push("--disallowedTools", opts.disallowedTools.join(","));
      if (opts.maxBudgetUsd) args.push("--max-budget-usd", String(opts.maxBudgetUsd));

      const raw = await runClaudeCli(opts.binary ?? "claude", args, opts.cwd, opts.timeoutMs ?? 10 * 60_000);

      let parsed: ClaudeCliResult;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`salida de "claude" no fue JSON valido: ${raw.slice(0, 500)}`);
      }

      if (parsed.is_error) {
        if (/authenticate|oauth|api.?key/i.test(parsed.result)) {
          throw new ClaudeCodeAuthError(
            `claude CLI sin credenciales propias: ${parsed.result}. ` +
              `Corre "claude auth login" o define ANTHROPIC_API_KEY para este sustrato.`,
          );
        }
        throw new Error(`claude CLI devolvio error: ${parsed.result}`);
      }

      return {
        sessionId: parsed.session_id,
        raw: parsed.result,
        usage: {
          tokensIn: parsed.usage?.input_tokens,
          tokensOut: parsed.usage?.output_tokens,
          costUsd: parsed.total_cost_usd,
        },
      };
    },
  };
}

function runClaudeCli(bin: string, args: string[], cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`claude CLI no respondio en ${timeoutMs}ms, matado`));
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`claude CLI salio con codigo ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(stdout);
    });
  });
}
