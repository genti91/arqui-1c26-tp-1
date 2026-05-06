import assert from "node:assert/strict";
import test from "node:test";

const BASE_URL = process.env.ARVAULT_BASE_URL || "http://localhost:5555";

test("healthcheck responde ok cuando API y Redis estan disponibles", async () => {
  const response = await request("GET", "/healthcheck");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: "ok" });
});

async function request(method, path) {
  let response;

  try {
    response = await fetch(`${BASE_URL}${path}`, { method });
  } catch (error) {
    throw new Error(
      `No se pudo conectar a ${BASE_URL}. Levanta docker compose antes de correr estas pruebas. ${error.message}`
    );
  }

  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  const parsedBody = contentType.includes("application/json") && text
    ? JSON.parse(text)
    : undefined;

  return {
    status: response.status,
    body: parsedBody,
  };
}
