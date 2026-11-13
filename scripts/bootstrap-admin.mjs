/**
 * Cria o PRIMEIRO administrador do painel (recusa se já existir algum usuário).
 * Interativo (terminal):  docker compose run --rm -it web node scripts/bootstrap-admin.mjs
 * Não interativo:         echo '{"email":"...","password":"..."}' | docker compose run --rm -T web node scripts/bootstrap-admin.mjs
 * A senha nunca é exibida nem gravada fora do hash scrypt.
 */
import { createInterface } from 'node:readline';
import { createUser } from '../src/lib/local-auth-core.server.ts';
import { closeDb } from '../src/lib/local-db.server.ts';

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (text) => { if (!muted) rl.output.write(text); };
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
    muted = hidden;
  });
}

async function readJson() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 4096) throw new Error('Entrada inválida');
  }
  const { email, password } = JSON.parse(input);
  if (typeof email !== 'string' || typeof password !== 'string') throw new Error('Informe email e password por JSON na entrada padrão');
  return { email, password };
}

try {
  let credentials;
  if (process.stdin.isTTY) {
    const email = (await ask('E-mail do administrador: ')).trim();
    const password = await ask('Senha (12+ caracteres, maiúsculas, minúsculas e números): ', true);
    if (password !== await ask('Repita a senha: ', true)) throw new Error('As senhas não conferem');
    credentials = { email, password };
  } else {
    credentials = await readJson();
  }
  await createUser(credentials.email, credentials.password, ['admin'], null, true);
  console.log('Administrador inicial criado. Entre em /interno/login.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Não foi possível criar o administrador');
  process.exitCode = 1;
} finally {
  closeDb();
}
