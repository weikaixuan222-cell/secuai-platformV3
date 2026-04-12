import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSmokeRuntime } from "./smoke-runtime-helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function escapeWindowsArg(value) {
  if (!/[ \t"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function runCommand(label, args, extraEnv = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child =
      process.platform === "win32"
        ? spawn(
            process.env.ComSpec ?? "cmd.exe",
            ["/d", "/s", "/c", [npmCommand, ...args].map(escapeWindowsArg).join(" ")],
            {
              cwd: repoRoot,
              env: {
                ...process.env,
                ...extraEnv
              },
              stdio: ["ignore", "pipe", "pipe"]
            }
          )
        : spawn(npmCommand, args, {
            cwd: repoRoot,
            env: {
              ...process.env,
              ...extraEnv
            },
            stdio: ["ignore", "pipe", "pipe"]
          });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.once("error", (error) => {
      rejectCommand(
        new Error(`${label} failed to start: ${error.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`)
      );
    });

    child.once("exit", (code) => {
      if (code === 0) {
        resolveCommand({ stdout, stderr });
        return;
      }

      rejectCommand(
        new Error(`${label} failed with exit code ${code}.\nstdout:\n${stdout}\nstderr:\n${stderr}`)
      );
    });
  });
}

async function main() {
  const runtime = createSmokeRuntime();

  try {
    await runtime.prepareRuntime({ startAnalyzer: false });

    await runCommand("build site-middleware", ["run", "build", "--workspace", "@secuai/site-middleware"]);
    await runCommand(
      "site-middleware enforcement smoke",
      ["run", "smoke:e2e-enforcement", "--workspace", "@secuai/site-middleware"],
      {
        SECUAI_PLATFORM_URL: runtime.config.apiBaseUrl
      }
    );
    await runCommand(
      "site-middleware blocked entity lifecycle smoke",
      ["run", "smoke:blocked-entity-lifecycle", "--workspace", "@secuai/site-middleware"],
      {
        SECUAI_PLATFORM_URL: runtime.config.apiBaseUrl
      }
    );
    await runCommand(
      "site-middleware SQLi policy lifecycle smoke",
      ["run", "smoke:sql-injection-policy-lifecycle", "--workspace", "@secuai/site-middleware"],
      {
        SECUAI_PLATFORM_URL: runtime.config.apiBaseUrl
      }
    );
    await runCommand(
      "site-middleware XSS policy lifecycle smoke",
      ["run", "smoke:xss-policy-lifecycle", "--workspace", "@secuai/site-middleware"],
      {
        SECUAI_PLATFORM_URL: runtime.config.apiBaseUrl
      }
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          apiBaseUrl: runtime.config.apiBaseUrl,
          verifiedBy: [
            "npm run build --workspace @secuai/site-middleware",
            "npm run smoke:e2e-enforcement --workspace @secuai/site-middleware",
            "npm run smoke:blocked-entity-lifecycle --workspace @secuai/site-middleware",
            "npm run smoke:sql-injection-policy-lifecycle --workspace @secuai/site-middleware",
            "npm run smoke:xss-policy-lifecycle --workspace @secuai/site-middleware"
          ]
        },
        null,
        2
      )
    );
  } finally {
    await runtime.shutdown();
  }
}

await main();
