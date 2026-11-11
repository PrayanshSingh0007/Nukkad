// Starts the Nukkad server and the web dev server together.
//   npm run dev        → https (self-signed) so the mic and Share button work on a phone
//   npm run dev:http   → plain http (no certificate warning; no mic)
import { spawn } from 'node:child_process';

const useHttp = process.argv.includes('--http');
// The Nukkad server's port in development. (We do not reuse a PORT variable that
// the surrounding tool may have set for the web page.)
const serverPort = process.env.NUKKAD_SERVER_PORT || '8787';
let stopping = false;

function run(name, args, extraEnv = {}) {
  const child = spawn('npm', args, {
    env: { ...process.env, FORCE_COLOR: '1', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  const tag = `[${name}] `;
  const forward = (stream, out) => {
    let rest = '';
    stream.on('data', (data) => {
      const lines = (rest + data).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) out.write(`${tag}${line}\n`);
    });
  };
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (!stopping && code) {
      console.error(`${tag}stopped with code ${code}`);
      stop(1);
    }
  });
  return child;
}

const children = [
  run('server', ['run', 'dev', '-w', '@nukkad/server'], { PORT: serverPort }),
  run('web', ['run', 'dev', '-w', '@nukkad/web'], { NUKKAD_SERVER_PORT: serverPort, NUKKAD_HTTP: useHttp ? '1' : '' }),
];

function stop(code = 0) {
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
