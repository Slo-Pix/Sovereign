import { readConfig, runScheduled } from "./runtime.js";
import { readOrchestratorConfig, runOrchestrator } from "./orchestrator.js";

try {
  if (process.env.AGENT_ORCHESTRATOR === "true") {
    await runOrchestrator(readOrchestratorConfig(), process.env.AGENT_ORCHESTRATOR_ONCE === "true");
  } else {
    await runScheduled(readConfig());
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown runtime error";
  console.error(JSON.stringify({ error: "Agent runtime configuration or execution failed", message }));
  process.exitCode = 1;
}
