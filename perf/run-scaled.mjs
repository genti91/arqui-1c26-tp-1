import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const scenarioName = process.argv[2];
const environmentName = process.argv[3] || "api";
const extraArgs = process.argv.slice(4);
const nginxCount = parseNginxCount(extraArgs);
const scenarioFile = nginxCount > 1 ? `${scenarioName}-scaled.yaml` : `${scenarioName}.yaml`;
const perfDir = path.dirname(fileURLToPath(import.meta.url));

if (nginxCount > 1) {
  runCommand(process.execPath, [path.join(perfDir, "generate-scaled-scenarios.mjs"), `nginx=${nginxCount}`]);
}

runCommand(process.execPath, [
  path.join(perfDir, "node_modules", "artillery", "bin", "run"),
  "run",
  scenarioFile,
  "-e",
  environmentName,
]);

function parseNginxCount(args) {
  const nginxArg = args.find((arg) => arg.startsWith("nginx="));

  if (!nginxArg) {
    return 1;
  }

  const parsedValue = Number(nginxArg.slice("nginx=".length));

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    throw new Error("El argumento nginx debe ser un entero positivo. Ejemplo: nginx=5");
  }

  return parsedValue;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: perfDir,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
