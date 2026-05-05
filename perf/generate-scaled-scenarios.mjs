import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const DEFAULT_NGINX_COUNT = 1;
const FIRST_NGINX_PORT = 5555;
const PERF_DIR = path.dirname(fileURLToPath(import.meta.url));

const nginxCount = parseNginxCount(process.argv.slice(2));

if (nginxCount === DEFAULT_NGINX_COUNT) {
  console.log("nginx=1: no se generan escenarios scaled.");
  process.exit(0);
}

generateScaledScenarios(nginxCount);

console.log(`Generados escenarios scaled para nginx=${nginxCount}.`);

function parseNginxCount(args) {
  const nginxArg = args.find((arg) => arg.startsWith("nginx="));
  const rawValue = nginxArg ? nginxArg.slice("nginx=".length) : String(DEFAULT_NGINX_COUNT);
  const parsedValue = Number(rawValue);

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    throw new Error("El argumento nginx debe ser un entero positivo. Ejemplo: nginx=5");
  }

  return parsedValue;
}

function generateScaledScenarios(count) {
  const scenarioFiles = fs
    .readdirSync(PERF_DIR)
    .filter((fileName) => fileName.endsWith(".yaml"))
    .filter((fileName) => !fileName.endsWith("-scaled.yaml"));

  for (const fileName of scenarioFiles) {
    const sourcePath = path.join(PERF_DIR, fileName);
    const targetPath = path.join(PERF_DIR, fileName.replace(".yaml", "-scaled.yaml"));
    const scenario = readYaml(sourcePath);

    scenario.scenarios = duplicateScenariosByNginxPort(scenario.scenarios, count);

    writeYaml(targetPath, scenario);
  }
}

function duplicateScenariosByNginxPort(scenarios, count) {
  if (!Array.isArray(scenarios)) {
    throw new Error("El escenario de Artillery no contiene una lista scenarios valida.");
  }

  const duplicatedScenarios = [];

  for (let index = 1; index <= count; index += 1) {
    const port = FIRST_NGINX_PORT + index - 1;

    for (const scenario of scenarios) {
      duplicatedScenarios.push({
        ...scenario,
        name: `${scenario.name} nginx-${index}`,
        flow: addAbsoluteNginxUrl(scenario.flow, port),
      });
    }
  }

  return duplicatedScenarios;
}

function addAbsoluteNginxUrl(flow, port) {
  if (!Array.isArray(flow)) {
    throw new Error("Un escenario de Artillery no contiene una lista flow valida.");
  }

  return flow.map((step) => {
    const methodName = Object.keys(step)[0];
    const request = step[methodName];

    if (!request || typeof request.url !== "string") {
      return step;
    }

    const nextRequest = {
      ...request,
      url: makeAbsoluteUrl(request.url, port),
    };

    return {
      ...step,
      [methodName]: nextRequest,
    };
  });
}

function makeAbsoluteUrl(url, port) {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  const normalizedPath = url.startsWith("/") ? url : `/${url}`;
  return `http://localhost:${port}${normalizedPath}`;
}

function readYaml(filePath) {
  return yaml.safeLoad(fs.readFileSync(filePath, "utf8"));
}

function writeYaml(filePath, content) {
  fs.writeFileSync(filePath, yaml.safeDump(content, { lineWidth: -1, noRefs: true }), "utf8");
}
