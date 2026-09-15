import { assessWorkerReadiness, loadConfig } from "@secthing/platform";

const config = loadConfig();
const readiness = await assessWorkerReadiness(config);
if (readiness.status !== "ready") {
  console.error(JSON.stringify({ event: "worker.not_ready", ...readiness }));
  process.exit(1);
}

console.info(JSON.stringify({ event: "worker.ready", checks: readiness.checks }));
console.info(JSON.stringify({ event: "worker.idle", detail: "No work stages are enabled in Phase 1." }));

// Phase 2 replaces this timer with durable PostgreSQL work-item polling.
const idleLoop = setInterval(() => undefined, 60_000);
const stop = () => {
  clearInterval(idleLoop);
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
