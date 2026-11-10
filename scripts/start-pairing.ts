#!/usr/bin/env bun

export {};

const server = Bun.spawn(["bun", "run", "start"], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

const stop = (signal: "SIGINT" | "SIGTERM") => {
  server.kill(signal);
};

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

const baseUrl = (process.env.API_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
let ready = false;

for (let attempt = 1; attempt <= 30; attempt += 1) {
  await Bun.sleep(1000);
  try {
    const response = await fetch(`${baseUrl}/status`);
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    // The server is still starting.
  }
}

if (!ready) {
  console.error("The API server did not become ready within 30 seconds.");
  server.kill("SIGTERM");
  process.exit(1);
}

const pairing = Bun.spawn(["bun", "run", "pairing"], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

const pairingExitCode = await pairing.exited;
if (pairingExitCode !== 0) {
  console.error(`Pairing command exited with code ${pairingExitCode}.`);
  server.kill("SIGTERM");
  process.exit(pairingExitCode);
}

console.log("Pairing request completed. API server is still running.");
await server.exited;
