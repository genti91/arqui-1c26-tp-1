import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const BASE_URL = process.env.ARVAULT_BASE_URL || "http://localhost:5555";

test("Redis conserva saldos y log cuando se reinicia solo la API", async () => {
  const initialAccounts = await getAccounts();
  const rates = await getRates();
  const baseAmount = 10;
  const counterAmount = baseAmount * rates.USD.ARS;

  try {
    await ensureCurrencyBalance("ARS", initialAccounts, counterAmount);

    const response = await postExchange({
      baseCurrency: "USD",
      counterCurrency: "ARS",
      baseAmount,
      baseAccountId: 11,
      counterAccountId: 10,
    });

    assert.equal(response.status, 200);

    const accountsBeforeRestart = await getAccounts();
    const logBeforeRestart = await getLog();
    const lastLogEntryIdBeforeRestart = await getLastLogEntryId(
      logBeforeRestart.pagination.totalItems
    );

    await restartApi();

    const accountsAfterRestart = await getAccounts();
    const logAfterRestart = await getLog();

    assert.deepEqual(accountsAfterRestart, accountsBeforeRestart);
    assert.equal(
      logAfterRestart.pagination.totalItems,
      logBeforeRestart.pagination.totalItems
    );
    assert.equal(
      await getLastLogEntryId(logAfterRestart.pagination.totalItems),
      lastLogEntryIdBeforeRestart
    );
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

test("Redis reserva saldo atomico y no permite doble gasto concurrente", async () => {
  const initialAccounts = await getAccounts();
  const rates = await getRates();
  const baseAmount = 10;
  const counterAmount = baseAmount * rates.USD.ARS;
  const arsAccount = findAccountByCurrency(initialAccounts, "ARS");

  try {
    await putAccountBalance(arsAccount.id, counterAmount);

    const responses = await Promise.all([
      postExchange({
        baseCurrency: "USD",
        counterCurrency: "ARS",
        baseAmount,
        baseAccountId: 11,
        counterAccountId: 10,
      }),
      postExchange({
        baseCurrency: "USD",
        counterCurrency: "ARS",
        baseAmount,
        baseAccountId: 11,
        counterAccountId: 10,
      }),
    ]);

    const successfulResponses = responses.filter((response) => {
      return response.status === 200;
    });
    const failedResponses = responses.filter((response) => {
      return response.status === 409;
    });
    const accountsAfter = await getAccounts();

    assert.equal(successfulResponses.length, 1);
    assert.equal(failedResponses.length, 1);
    assert.equal(findAccountByCurrency(accountsAfter, "ARS").balance, 0);
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

async function restartApi() {
  await execFileAsync("docker", ["compose", "restart", "api"], {
    cwd: process.cwd(),
  });
  await waitForApi();
}

async function waitForApi() {
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    try {
      const response = await request("GET", "/rates");

      if (response.status === 200) {
        return;
      }
    } catch (err) {
      await sleep(500);
    }

    await sleep(500);
  }

  throw new Error("La API no volvio a responder despues del restart");
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function restoreAccounts(accounts) {
  for (const account of accounts) {
    const response = await putAccountBalance(account.id, account.balance);
    assert.equal(response.status, 200);
  }
}

async function ensureCurrencyBalance(currency, currentAccounts, minimumBalance) {
  const account = findAccountByCurrency(currentAccounts, currency);

  if (account.balance >= minimumBalance) {
    return;
  }

  const response = await putAccountBalance(account.id, minimumBalance);
  assert.equal(response.status, 200);
}

async function getRates() {
  const response = await request("GET", "/rates");
  assert.equal(response.status, 200);
  return response.body;
}

async function getAccounts() {
  const response = await request("GET", "/accounts");
  assert.equal(response.status, 200);
  return response.body;
}

async function getLog() {
  const response = await request("GET", "/logs");
  assert.equal(response.status, 200);
  assertLogResponse(response.body);
  return response.body;
}

async function getLastLogEntryId(totalItems) {
  const response = await request("GET", `/logs?page=${totalItems}&limit=1`);
  assert.equal(response.status, 200);
  assertLogResponse(response.body);
  return response.body.items[0].id;
}

function assertLogResponse(body) {
  assert.ok(Array.isArray(body.items));
  assert.equal(typeof body.pagination.page, "number");
  assert.equal(typeof body.pagination.limit, "number");
  assert.equal(typeof body.pagination.totalItems, "number");
  assert.equal(typeof body.pagination.totalPages, "number");
}

function postExchange(payload) {
  return request("POST", "/exchange", payload);
}

function putAccountBalance(accountId, balance) {
  return request("PUT", `/accounts/${accountId}/balance`, { balance });
}

async function request(method, path, body) {
  let response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
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
    text,
  };
}

function findAccountByCurrency(accounts, currency) {
  return accounts.find((account) => account.currency === currency);
}
