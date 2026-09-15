import { loadConfig } from "@secthing/platform";
import { buildServer } from "./server.js";

const config = loadConfig();
const app = buildServer(config);
try {
  await app.listen({ host: "0.0.0.0", port: config.backendPort });
} catch (error) {
  app.log.error(error, "backend failed to start");
  process.exit(1);
}

