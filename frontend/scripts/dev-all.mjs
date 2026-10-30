/**
 * Start the React (Vite) dev server and the Next.js Bare Acts dev server
 * together. Vite proxies /acts to Next, so everything is reachable on the
 * Vite port alone:
 *
 *   npm run dev:all        ->  http://localhost:5173        React
 *                              http://localhost:5173/acts   Next.js (proxied from :3000)
 *
 * Ctrl+C stops both.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const NEXT_PORT = 3000;

/**
 * The Vite proxy only looks at :3000. If something else already listens there,
 * Next dev would silently move to :3001 and /acts would show the wrong thing,
 * so stop early with the command that frees the port.
 */
async function assertPortFree(port) {
  const { createServer } = await import("node:net");
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(port, () => probe.close(resolve));
  }).catch(() => {
    console.error(`[dev:all] Port ${port} is already in use, so Next dev cannot start there and /acts would break.`);
    console.error(`[dev:all] Stop whatever is using it, then run again. On Windows (PowerShell):`);
    console.error(`[dev:all]   Get-NetTCPConnection -LocalPort ${port} -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }`);
    process.exit(1);
  });
}

await assertPortFree(NEXT_PORT);

function run(name, cwd, args) {
  const child = spawn(npm, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  child.on("exit", (code) => {
    if (code && code !== 0) console.error(`[dev:all] ${name} exited with code ${code}`);
  });
  return child;
}

const next = run("next", path.join(root, "acts"), ["run", "dev"]);
const vite = run("vite", root, ["run", "dev"]);

function stop() {
  next.kill();
  vite.kill();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
