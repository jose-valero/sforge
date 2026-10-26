import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { EnvelopeBase, defineEnvelope, EnvelopeParseError, parseEnvelope } from "./envelope.js";

describe("EnvelopeBase", () => {
  test("acepta status success y fail con summary", () => {
    assert.deepEqual(EnvelopeBase.parse({ status: "success", summary: "ok" }), {
      status: "success",
      summary: "ok",
    });
    assert.equal(EnvelopeBase.parse({ status: "fail", summary: "mal" }).status, "fail");
  });

  test("rechaza status fuera del enum", () => {
    assert.equal(EnvelopeBase.safeParse({ status: "done", summary: "x" }).success, false);
  });

  test("rechaza summary vacio con el mensaje declarado", () => {
    const r = EnvelopeBase.safeParse({ status: "success", summary: "" });
    assert.equal(r.success, false);
    if (!r.success) assert.equal(r.error.issues[0]!.message, "summary no puede estar vacio");
  });

  test("rechaza campos faltantes y tipos incorrectos", () => {
    assert.equal(EnvelopeBase.safeParse({ status: "success" }).success, false);
    assert.equal(EnvelopeBase.safeParse({ summary: "x" }).success, false);
    assert.equal(EnvelopeBase.safeParse({ status: "success", summary: 42 }).success, false);
    assert.equal(EnvelopeBase.safeParse(null).success, false);
  });
});

describe("defineEnvelope", () => {
  const Schema = defineEnvelope({ files: z.array(z.string()), count: z.number().int() });

  test("conserva campos base y agrega los propios", () => {
    const v = Schema.parse({ status: "success", summary: "ok", files: ["a"], count: 1 });
    assert.deepEqual(v, { status: "success", summary: "ok", files: ["a"], count: 1 });
  });

  test("exige los campos extra", () => {
    assert.equal(Schema.safeParse({ status: "success", summary: "ok" }).success, false);
  });

  test("sigue validando los campos base", () => {
    const r = Schema.safeParse({ status: "nope", summary: "", files: [], count: 1 });
    assert.equal(r.success, false);
    if (!r.success) assert.equal(r.error.issues.length, 2);
  });

  test("valida tipos de los campos extra", () => {
    assert.equal(
      Schema.safeParse({ status: "success", summary: "ok", files: [], count: 1.5 }).success,
      false,
    );
  });

  test("sin shape extra equivale a EnvelopeBase", () => {
    assert.equal(defineEnvelope({}).safeParse({ status: "fail", summary: "x" }).success, true);
  });
});

describe("parseEnvelope", () => {
  test("devuelve el dato tipado con JSON valido", () => {
    const raw = JSON.stringify({ status: "success", summary: "listo" });
    assert.deepEqual(parseEnvelope(EnvelopeBase, raw), { status: "success", summary: "listo" });
  });

  test("funciona con schemas de defineEnvelope", () => {
    const S = defineEnvelope({ n: z.number() });
    assert.equal(parseEnvelope(S, '{"status":"fail","summary":"s","n":3}').n, 3);
  });

  test("JSON invalido lanza EnvelopeParseError con raw y path vacio", () => {
    const raw = "esto no es json";
    assert.throws(
      () => parseEnvelope(EnvelopeBase, raw),
      (e: unknown) => {
        assert.ok(e instanceof EnvelopeParseError);
        assert.equal(e.raw, raw);
        assert.deepEqual(e.issues, [{ path: "", message: "la respuesta no es JSON valido" }]);
        return true;
      },
    );
  });

  test("string vacio y JSON con texto alrededor tambien fallan", () => {
    assert.throws(() => parseEnvelope(EnvelopeBase, ""), EnvelopeParseError);
    assert.throws(
      () => parseEnvelope(EnvelopeBase, 'aqui va: {"status":"success","summary":"x"}'),
      EnvelopeParseError,
    );
  });

  test("schema incumplido reporta issues con path con puntos", () => {
    const S = defineEnvelope({ data: z.object({ id: z.number() }) });
    const raw = '{"status":"success","summary":"x","data":{"id":"a"}}';
    assert.throws(
      () => parseEnvelope(S, raw),
      (e: unknown) => {
        assert.ok(e instanceof EnvelopeParseError);
        assert.equal(e.raw, raw);
        assert.equal(e.issues.length, 1);
        assert.equal(e.issues[0]!.path, "data.id");
        return true;
      },
    );
  });

  test("acumula todas las issues", () => {
    try {
      parseEnvelope(EnvelopeBase, '{"status":"x","summary":""}');
      assert.fail("debio lanzar");
    } catch (e) {
      assert.ok(e instanceof EnvelopeParseError);
      assert.deepEqual(e.issues.map((i) => i.path).sort(), ["status", "summary"]);
    }
  });

  test("JSON valido pero no objeto (null, array) falla", () => {
    assert.throws(() => parseEnvelope(EnvelopeBase, "null"), EnvelopeParseError);
    assert.throws(() => parseEnvelope(EnvelopeBase, "[]"), EnvelopeParseError);
  });
});

describe("EnvelopeParseError", () => {
  test("es un Error con mensaje fijo y expone issues/raw", () => {
    const e = new EnvelopeParseError([{ path: "a", message: "m" }], "raw");
    assert.ok(e instanceof Error);
    assert.equal(e.message, "el envelope no cumple el schema declarado");
    assert.equal(e.raw, "raw");
    assert.deepEqual(e.issues, [{ path: "a", message: "m" }]);
  });

  test("feedback() lista una linea por issue", () => {
    const e = new EnvelopeParseError(
      [
        { path: "status", message: "invalido" },
        { path: "data.id", message: "esperaba number" },
      ],
      "",
    );
    assert.equal(e.feedback(), "- status: invalido\n- data.id: esperaba number");
  });

  test("feedback() usa (root) si el path esta vacio", () => {
    const e = new EnvelopeParseError([{ path: "", message: "no json" }], "x");
    assert.equal(e.feedback(), "- (root): no json");
  });

  test("feedback() sin issues devuelve cadena vacia", () => {
    assert.equal(new EnvelopeParseError([], "").feedback(), "");
  });
});
