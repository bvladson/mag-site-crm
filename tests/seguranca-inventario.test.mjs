// Portão do inventário de acesso (módulo 1 — segurança): toda função de servidor tem perfil exigido conhecido, toda
// função pública tem justificativa, toda rota de API tem proteção conferida e o documento está em dia com o código.
// Função ou rota nova sem classificação faz este teste falhar. node --test tests/seguranca-inventario.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("inventário de acesso completo e em dia com o código", () => {
  let output = "";
  let code = 0;
  try {
    output = execFileSync(process.execPath, ["docs/seguranca/gerar-inventario.mjs", "--check"], { cwd: root, encoding: "utf8" });
  } catch (error) {
    code = error.status ?? 1;
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  assert.equal(code, 0, output);
  assert.match(output, /funções: \d+ \| públicas: \d+ \| rotas: \d+/);
});
