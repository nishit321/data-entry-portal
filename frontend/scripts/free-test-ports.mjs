/**
 * Free the two ports this suite's servers bind to, before Playwright tries to bind them.
 *
 * `reuseExistingServer` is off on purpose: the backend rebuilds its database as it starts, so a
 * reused one would be running against whatever the last suite left behind. The cost of that
 * choice is that an aborted run leaves both servers alive, and every run afterwards dies on
 * EADDRINUSE with a message that points at the port rather than at the cause. That happened four
 * times in a row before this script existed.
 *
 * Only 4100 and 4173 are touched. They belong to this suite alone; the development servers run
 * elsewhere, and nothing but a Playwright web server should ever be listening here.
 *
 * Run it by hand (`npm run test:browser:free-ports`), never as part of `test:browser`. Wiring it
 * in front of the suite looked tidy and was wrong: a second person, or a second session, running
 * the browser tests at the same time has its servers on exactly these ports, and an automatic
 * sweep would kill a colleague's run halfway through and report it as a flake. Check that no run
 * is in flight, then free the ports.
 */
import { execFileSync } from 'node:child_process';

const PORTS = [4100, 4173];

function listenersOn(port) {
  let out = '';
  try {
    out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
  } catch {
    return [];
  }
  const pids = new Set();
  for (const line of out.split('\n')) {
    if (!line.includes('LISTENING')) continue;
    // The local address is the second column; match the port exactly, not as a substring.
    const [, local, , , pid] = line.trim().split(/\s+/);
    if (!local || !pid) continue;
    if (local.endsWith(`:${port}`)) pids.add(pid);
  }
  return [...pids];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let freed = 0;
for (const port of PORTS) {
  for (const pid of listenersOn(port)) {
    try {
      execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' });
      console.log(`free-test-ports: stopped the process holding ${port} (pid ${pid}).`);
      freed += 1;
    } catch {
      console.warn(`free-test-ports: could not stop pid ${pid} on ${port}. Stop it by hand.`);
    }
  }
}

// Windows does not hand the port back the moment the process dies, and `vite preview` runs with
// `--strictPort`, so it fails on the first attempt rather than waiting. Killing without this wait
// simply moved the EADDRINUSE a second later.
if (freed > 0) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (PORTS.every((port) => listenersOn(port).length === 0)) break;
    await sleep(250);
  }
  const stuck = PORTS.filter((port) => listenersOn(port).length > 0);
  if (stuck.length > 0) {
    console.error(`free-test-ports: ${stuck.join(' and ')} would not release. Stop them by hand.`);
    process.exit(1);
  }
  // Even with no listener left, the socket sits in TIME_WAIT for a moment.
  await sleep(1000);
}

if (freed === 0) console.log('free-test-ports: nothing was holding 4100 or 4173.');
