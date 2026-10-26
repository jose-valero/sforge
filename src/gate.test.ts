// Corre con: node --experimental-strip-types --test src/gate.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-ignore -- el import con extension .ts es necesario para strip-types nativo
import { envelopeSucceeded, filesExist, filesNonEmpty, testsPass, runGates, type Gate } from "./gate.js";

function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), "gate-test-"));
  const full = join(dir, "full.txt");
  const empty = join(dir, "empty.txt");
  writeFileSync(full, "contenido");
  writeFileSync(empty, "");
  return { dir, full, empty, missing: join(dir, "missing.txt") };
}

test("envelopeSucceeded: pasa con status success", () => {
  const r = envelopeSucceeded({ status: "success" }) as any;
  assert.equal(r.gate, "envelope_status");
  assert.equal(r.passed, true);
  assert.deepEqual(r.checks, [{ item: "status", ok: true, note: "success" }]);
});

test("envelopeSucceeded: falla con status distinto de success", () => {
  const r = envelopeSucceeded({ status: "failed" }) as any;
  assert.equal(r.passed, false);
  assert.equal(r.checks[0].ok, false);
  assert.equal(r.checks[0].note, "failed");
});

test("filesExist: pasa si todos existen", () => {
  const f = fixtureDir();
  try {
    const r = filesExist([f.full, f.empty])(undefined) as any;
    assert.equal(r.gate, "files_exist");
    assert.equal(r.passed, true);
    assert.equal(r.checks.length, 2);
  } finally {
    rmSync(f.dir, { recursive: true });
  }
});

test("filesExist: falla si falta alguno y lo marca", () => {
  const f = fixtureDir();
  try {
    const r = filesExist([f.full, f.missing])(undefined) as any;
    assert.equal(r.passed, false);
    assert.deepEqual(r.checks.map((c: any) => c.ok), [true, false]);
    assert.equal(r.checks[1].item, f.missing);
  } finally {
    rmSync(f.dir, { recursive: true });
  }
});

test("filesExist: lista vacia pasa (vacuamente)", () => {
  assert.equal((filesExist([])(undefined) as any).passed, true);
});

test("filesNonEmpty: pasa con archivos con contenido", () => {
  const f = fixtureDir();
  try {
    const r = filesNonEmpty([f.full])(undefined) as any;
    assert.equal(r.gate, "files_non_empty");
    assert.equal(r.passed, true);
    assert.equal(r.checks[0].note, undefined);
  } finally {
    rmSync(f.dir, { recursive: true });
  }
});

test("filesNonEmpty: falla con archivo vacio e inexistente", () => {
  const f = fixtureDir();
  try {
    const r = filesNonEmpty([f.full, f.empty, f.missing])(undefined) as any;
    assert.equal(r.passed, false);
    assert.deepEqual(r.checks.map((c: any) => c.ok), [true, false, false]);
    assert.equal(r.checks[1].note, "no existe o esta vacio");
    assert.equal(r.checks[2].note, "no existe o esta vacio");
  } finally {
    rmSync(f.dir, { recursive: true });
  }
});

test("testsPass: pasa con exit code 0", async () => {
  const r = await testsPass([process.execPath, "-e", "process.exit(0)"])(undefined);
  assert.equal(r.gate, "tests_pass");
  assert.equal(r.passed, true);
  assert.equal(r.checks[0]!.ok, true);
});

test("testsPass: falla con exit code distinto de 0 e informa el codigo", async () => {
  const r = await testsPass([process.execPath, "-e", "process.exit(3)"])(undefined);
  assert.equal(r.passed, false);
  assert.equal(r.checks[0]!.ok, false);
  assert.equal(r.checks[0]!.note, "exit 3");
});

test("testsPass: no juzga por stdout aunque diga 'error'", async () => {
  const r = await testsPass([process.execPath, "-e", "console.log('error error')"])(undefined);
  assert.equal(r.passed, true);
});

test("testsPass: falla si el binario no existe", async () => {
  const r = await testsPass(["binario-inexistente-xyz"])(undefined);
  assert.equal(r.passed, false);
  assert.equal(r.checks[0]!.note, "exit ENOENT");
});

test("testsPass: cmd vacio falla", async () => {
  const r = await testsPass([])(undefined);
  assert.equal(r.passed, false);
  assert.equal(r.checks[0]!.note, "exit ?");
});

test("testsPass: respeta cwd", async () => {
  const f = fixtureDir();
  try {
    const script = `process.exit(process.cwd() === require('fs').realpathSync(${JSON.stringify(f.dir)}) ? 0 : 1)`;
    const r = await testsPass([process.execPath, "-e", script], { cwd: f.dir })(undefined);
    assert.equal(r.passed, true);
  } finally {
    rmSync(f.dir, { recursive: true });
  }
});

test("runGates: ejecuta en orden y devuelve un reporte por gate, incluyendo fallos", async () => {
  const order: string[] = [];
  const mk = (name: string, passed: boolean): Gate<{ n: number }> => async (env) => {
    order.push(`${name}:${env.n}`);
    return { gate: name, passed, checks: [] };
  };
  const reports = await runGates({ n: 7 }, [mk("a", true), mk("b", false), mk("c", true)]);
  assert.deepEqual(order, ["a:7", "b:7", "c:7"]);
  assert.deepEqual(reports.map((r) => [r.gate, r.passed]), [["a", true], ["b", false], ["c", true]]);
});

test("runGates: lista vacia devuelve []", async () => {
  assert.deepEqual(await runGates({}, []), []);
});

test("runGates: integra gates reales; envelope fallido produce reporte fallido", async () => {
  const f = fixtureDir();
  try {
    const reports = await runGates({ status: "failed" }, [envelopeSucceeded, filesExist([f.full]), filesNonEmpty([f.empty])]);
    assert.deepEqual(reports.map((r) => r.passed), [false, true, false]);
  } finally {
    rmSync(f.dir, { recursive: true });
  }
});
