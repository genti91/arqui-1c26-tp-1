import http from "node:http";

const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";
const CHECK_INTERVAL_MS = readPositiveIntegerEnv("HEALTHCHECK_INTERVAL_MS", 5000);
const CHECK_TIMEOUT_MS = readPositiveIntegerEnv("HEALTHCHECK_TIMEOUT_MS", 2000);
const FAILURE_THRESHOLD = readPositiveIntegerEnv("HEALTHCHECK_FAILURE_THRESHOLD", 2);
const RESTART_COOLDOWN_MS = readPositiveIntegerEnv("HEALTHCHECK_RESTART_COOLDOWN_MS", 30000);
const STARTUP_GRACE_MS = readNonNegativeIntegerEnv("HEALTHCHECK_STARTUP_GRACE_MS", 15000);

const SERVICE_HEALTHCHECKS = {
  api: { port: 3000 },
  nginx: { port: 80 },
};

const failureCounts = new Map();
const lastRestartAt = new Map();

let composeProjectName = process.env.HEALTHCHECK_PROJECT_NAME || null;
let checkRunning = false;

console.log(
  `Healthchecker iniciado. interval=${CHECK_INTERVAL_MS}ms timeout=${CHECK_TIMEOUT_MS}ms threshold=${FAILURE_THRESHOLD}`
);

setTimeout(() => {
  runChecks();
  setInterval(runChecks, CHECK_INTERVAL_MS);
}, STARTUP_GRACE_MS);

async function runChecks() {
  if (checkRunning) {
    return;
  }

  checkRunning = true;

  try {
    const containers = await listProjectContainers();
    const apiContainers = containers.filter((container) => getServiceKind(container) === "api");
    const nginxContainers = containers.filter((container) => getServiceKind(container) === "nginx");
    const restartedApis = await checkContainers(apiContainers);

    if (restartedApis > 0) {
      console.log("Se omite chequeo de nginx en este ciclo porque se reinicio una API.");
      return;
    }

    await checkContainers(nginxContainers);
  } catch (error) {
    console.error("Error en ciclo de healthcheck:", error.message);
  } finally {
    checkRunning = false;
  }
}

async function listProjectContainers() {
  if (composeProjectName == null) {
    composeProjectName = await getOwnComposeProjectName();
    console.log(`Monitoreando proyecto Docker Compose: ${composeProjectName}`);
  }

  const containers = await dockerRequest("GET", "/containers/json?all=true");

  return containers.filter((container) => {
    return container.Labels?.["com.docker.compose.project"] === composeProjectName;
  });
}

async function getOwnComposeProjectName() {
  const hostname = process.env.HOSTNAME;

  if (!hostname) {
    throw new Error("No se pudo detectar el container actual: falta HOSTNAME.");
  }

  const container = await dockerRequest("GET", `/containers/${encodeURIComponent(hostname)}/json`);
  const projectName = container.Config?.Labels?.["com.docker.compose.project"];

  if (!projectName) {
    throw new Error("No se pudo detectar el proyecto Compose desde las labels del container actual.");
  }

  return projectName;
}

function getServiceKind(container) {
  const serviceName = container.Labels?.["com.docker.compose.service"];

  if (serviceName === "api") {
    return "api";
  }

  if (serviceName === "nginx" || /^nginx-\d+$/.test(serviceName || "")) {
    return "nginx";
  }

  return null;
}

async function checkContainers(containers) {
  let restartCount = 0;

  for (const container of containers) {
    const serviceKind = getServiceKind(container);
    const restarted = await checkContainer(container, SERVICE_HEALTHCHECKS[serviceKind]);

    if (restarted) {
      restartCount += 1;
    }
  }

  return restartCount;
}

async function checkContainer(container, healthcheckConfig) {
  const containerName = formatContainerName(container);
  const containerId = container.Id;

  if (!healthcheckConfig) {
    return false;
  }

  if (container.State !== "running") {
    return recordFailureAndMaybeRestart(containerId, containerName, `estado=${container.State}`);
  }

  const containerDetails = await dockerRequest("GET", `/containers/${encodeURIComponent(containerId)}/json`);
  const containerIp = getContainerIp(containerDetails);

  if (!containerIp) {
    return recordFailureAndMaybeRestart(containerId, containerName, "sin IP interna");
  }

  try {
    const response = await fetchWithTimeout(
      `http://${containerIp}:${healthcheckConfig.port}/healthcheck`,
      CHECK_TIMEOUT_MS
    );

    if (response.status === 200) {
      clearFailure(containerId, containerName);
      return false;
    }

    return recordFailureAndMaybeRestart(containerId, containerName, `HTTP ${response.status}`);
  } catch (error) {
    return recordFailureAndMaybeRestart(containerId, containerName, error.message);
  }
}

function getContainerIp(containerDetails) {
  const networks = containerDetails.NetworkSettings?.Networks || {};

  for (const network of Object.values(networks)) {
    if (network.IPAddress) {
      return network.IPAddress;
    }
  }

  return null;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function recordFailureAndMaybeRestart(containerId, containerName, reason) {
  const nextFailureCount = (failureCounts.get(containerId) || 0) + 1;
  failureCounts.set(containerId, nextFailureCount);

  console.log(
    `${containerName} fallo healthcheck (${reason}). fallas=${nextFailureCount}/${FAILURE_THRESHOLD}`
  );

  if (nextFailureCount < FAILURE_THRESHOLD) {
    return false;
  }

  const now = Date.now();
  const previousRestartAt = lastRestartAt.get(containerId) || 0;

  if (now - previousRestartAt < RESTART_COOLDOWN_MS) {
    console.log(`${containerName} sigue en cooldown de restart.`);
    return false;
  }

  await dockerRequest("POST", `/containers/${encodeURIComponent(containerId)}/restart`);
  lastRestartAt.set(containerId, now);
  failureCounts.set(containerId, 0);
  console.log(`${containerName} reiniciado por healthchecker.`);

  return true;
}

function clearFailure(containerId, containerName) {
  if (failureCounts.get(containerId) > 0) {
    console.log(`${containerName} volvio a estar sano.`);
  }

  failureCounts.delete(containerId);
}

function dockerRequest(method, path) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: DOCKER_SOCKET_PATH,
        method,
        path,
      },
      (response) => {
        let rawBody = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          rawBody += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Docker API ${method} ${path} respondio ${response.statusCode}: ${rawBody}`));
            return;
          }

          if (!rawBody) {
            resolve(null);
            return;
          }

          try {
            resolve(JSON.parse(rawBody));
          } catch (error) {
            reject(new Error(`Docker API devolvio JSON invalido: ${error.message}`));
          }
        });
      }
    );

    request.on("error", reject);
    request.end();
  });
}

function formatContainerName(container) {
  const firstName = container.Names?.[0] || container.Id.slice(0, 12);

  return firstName.replace(/^\//, "");
}

function readPositiveIntegerEnv(name, defaultValue) {
  const value = Number(process.env[name] || defaultValue);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} debe ser un entero positivo.`);
  }

  return value;
}

function readNonNegativeIntegerEnv(name, defaultValue) {
  const value = Number(process.env[name] || defaultValue);

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} debe ser un entero mayor o igual a cero.`);
  }

  return value;
}
