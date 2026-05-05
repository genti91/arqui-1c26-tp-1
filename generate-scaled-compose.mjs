import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "./perf/node_modules/js-yaml/index.js";

const DEFAULT_NGINX_COUNT = 1;
const FIRST_NGINX_PORT = 5555;
const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BASE_COMPOSE_PATH = path.join(ROOT_DIR, "docker-compose.yml");
const SCALED_COMPOSE_PATH = path.join(ROOT_DIR, "docker-compose-scaled.yml");

const nginxCount = parseNginxCount(process.argv.slice(2));

generateScaledCompose(nginxCount);

console.log(`Generado docker-compose-scaled.yml para nginx=${nginxCount}.`);

function parseNginxCount(args) {
  const nginxArg = args.find((arg) => arg.startsWith("nginx="));
  const rawValue = nginxArg ? nginxArg.slice("nginx=".length) : String(DEFAULT_NGINX_COUNT);
  const parsedValue = Number(rawValue);

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    throw new Error("El argumento nginx debe ser un entero positivo. Ejemplo: nginx=5");
  }

  return parsedValue;
}

function generateScaledCompose(count) {
  const baseCompose = readYaml(BASE_COMPOSE_PATH);
  const nginxService = baseCompose.services.nginx;

  if (!nginxService) {
    throw new Error("docker-compose.yml no define el servicio nginx.");
  }

  const scaledCompose = {
    ...baseCompose,
    services: { ...baseCompose.services },
  };

  delete scaledCompose.services.nginx;

  for (let index = 1; index <= count; index += 1) {
    scaledCompose.services[`nginx-${index}`] = {
      ...nginxService,
      ports: [`${FIRST_NGINX_PORT + index - 1}:80`],
    };
  }

  writeYaml(SCALED_COMPOSE_PATH, scaledCompose);
}

function readYaml(filePath) {
  return yaml.safeLoad(fs.readFileSync(filePath, "utf8"));
}

function writeYaml(filePath, content) {
  fs.writeFileSync(filePath, yaml.safeDump(content, { lineWidth: -1, noRefs: true }), "utf8");
}
