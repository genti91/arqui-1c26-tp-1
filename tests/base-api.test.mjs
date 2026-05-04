import assert from "node:assert/strict";
import test from "node:test";

const BASE_URL = process.env.ARVAULT_BASE_URL || "http://localhost:5555";

test("GET /rates conserva el contrato actual", async () => {
  const response = await request("GET", "/rates");

  assert.equal(response.status, 200);
  assert.equal(typeof response.body, "object");
  assert.equal(typeof response.body.USD.ARS, "number");
  assert.equal(typeof response.body.ARS.USD, "number");
});

test("GET /accounts conserva el contrato actual", async () => {
  const response = await request("GET", "/accounts");

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body));
  assert.equal(findAccount(response.body, 1).currency, "ARS");
  assert.equal(typeof findAccount(response.body, 1).balance, "number");
});

test("la app expone /logs y no /log", async () => {
  const documentedResponse = await request("GET", "/logs");
  const oldResponse = await request("GET", "/log");

  assert.equal(documentedResponse.status, 200);
  assertLogResponse(documentedResponse.body);
  assert.equal(oldResponse.status, 404);
});

test("POST /exchange exitoso conserva respuesta, saldos y log actuales", async () => {
  const initialAccounts = await getAccounts();
  const rates = await getRates();
  const baseAmount = 10;
  const exchangeRate = rates.USD.ARS;
  const counterAmount = baseAmount * exchangeRate;

  try {
    await ensureCurrencyBalance("ARS", initialAccounts, counterAmount);

    const accountsBefore = await getAccounts();
    const logBefore = await getLog();

    const response = await postExchange({
      baseCurrency: "USD",
      counterCurrency: "ARS",
      baseAmount,
      baseAccountId: 11,
      counterAccountId: 10,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.exchangeRate, exchangeRate);
    assert.equal(response.body.counterAmount, counterAmount);
    assert.equal(response.body.obs, null);

    const accountsAfter = await getAccounts();
    assert.equal(
      findAccountByCurrency(accountsAfter, "USD").balance,
      findAccountByCurrency(accountsBefore, "USD").balance + baseAmount
    );
    assert.equal(
      findAccountByCurrency(accountsAfter, "ARS").balance,
      findAccountByCurrency(accountsBefore, "ARS").balance - counterAmount
    );

    const logAfter = await getLog();
    const lastLogEntry = await getLastLogEntry(logAfter.pagination.totalItems);

    assert.equal(
      logAfter.pagination.totalItems,
      logBefore.pagination.totalItems + 1
    );
    assert.equal(lastLogEntry.id, response.body.id);
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

test("monto negativo devuelve 400 y no cambia saldos", async () => {
  const initialAccounts = await getAccounts();

  try {
    const accountsBefore = await getAccounts();
    const logBefore = await getLog();
    const response = await postExchange({
      baseCurrency: "USD",
      counterCurrency: "ARS",
      baseAmount: -5,
      baseAccountId: 11,
      counterAccountId: 10,
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "INVALID_BASE_AMOUNT");

    const accountsAfter = await getAccounts();
    const logAfter = await getLog();

    assertAccountsEqual(accountsAfter, accountsBefore);
    assert.equal(logAfter.pagination.totalItems, logBefore.pagination.totalItems);
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

test("monto cero devuelve 400 y no agrega una entrada al log", async () => {
  const logBefore = await getLog();

  const response = await postExchange({
    baseCurrency: "USD",
    counterCurrency: "ARS",
    baseAmount: 0,
    baseAccountId: 11,
    counterAccountId: 10,
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.errorCode, "INVALID_BASE_AMOUNT");

  const logAfter = await getLog();
  assert.equal(logAfter.pagination.totalItems, logBefore.pagination.totalItems);
});

test("tasa inexistente devuelve 400 y no registra operacion", async () => {
  const initialAccounts = await getAccounts();
  const logBefore = await getLog();

  try {
    const response = await postExchange({
      baseCurrency: "USD",
      counterCurrency: "EUR",
      baseAmount: 10,
      baseAccountId: 11,
      counterAccountId: 12,
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "RATE_NOT_FOUND");

    const logAfter = await getLog();
    assert.equal(logAfter.pagination.totalItems, logBefore.pagination.totalItems);
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

test("saldo insuficiente devuelve 409 y registra operacion fallida", async () => {
  const initialAccounts = await getAccounts();
  const rates = await getRates();

  try {
    const accountsBefore = await getAccounts();
    const logBefore = await getLog();
    const arsBalance = findAccountByCurrency(accountsBefore, "ARS").balance;
    const baseAmount = Math.floor(arsBalance / rates.USD.ARS) + 1;

    const response = await postExchange({
      baseCurrency: "USD",
      counterCurrency: "ARS",
      baseAmount,
      baseAccountId: 11,
      counterAccountId: 10,
    });

    assert.equal(response.status, 409);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.errorCode, "INSUFFICIENT_COUNTER_FUNDS");
    assert.equal(response.body.obs, "Not enough funds on counter currency account");

    const accountsAfter = await getAccounts();
    assert.equal(findAccountByCurrency(accountsAfter, "ARS").balance, findAccountByCurrency(accountsBefore, "ARS").balance);
    assert.equal(findAccountByCurrency(accountsAfter, "USD").balance, findAccountByCurrency(accountsBefore, "USD").balance);

    const logAfter = await getLog();
    assert.equal(
      logAfter.pagination.totalItems,
      logBefore.pagination.totalItems + 1
    );
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

async function restoreAccounts(accounts) {
  for (const account of accounts) {
    const response = await request("PUT", `/accounts/${account.id}/balance`, {
      balance: account.balance,
    });
    assert.equal(response.status, 200);
  }
}

async function ensureCurrencyBalance(currency, currentAccounts, minimumBalance) {
  const account = findAccountByCurrency(currentAccounts, currency);

  if (account.balance >= minimumBalance) {
    return;
  }

  const response = await request("PUT", `/accounts/${account.id}/balance`, {
    balance: minimumBalance,
  });
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

async function getLastLogEntry(totalItems) {
  const response = await request("GET", `/logs?page=${totalItems}&limit=1`);
  assert.equal(response.status, 200);
  assertLogResponse(response.body);
  return response.body.items[0];
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

function findAccount(accounts, id) {
  return accounts.find((account) => account.id === id);
}

function findAccountByCurrency(accounts, currency) {
  return accounts.find((account) => account.currency === currency);
}

function assertAccountsEqual(accountsAfter, accountsBefore) {
  for (const accountBefore of accountsBefore) {
    assert.equal(
      findAccount(accountsAfter, accountBefore.id).balance,
      accountBefore.balance
    );
  }
}
