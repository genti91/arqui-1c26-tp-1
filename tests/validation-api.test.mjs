import assert from "node:assert/strict";
import test from "node:test";

const BASE_URL = process.env.ARVAULT_BASE_URL || "http://localhost:5555";

test("GET /logs reemplaza a GET /log", async () => {
  const logsResponse = await request("GET", "/logs");
  const oldLogResponse = await request("GET", "/log");

  assert.equal(logsResponse.status, 200);
  assertLogResponse(logsResponse.body);
  assert.equal(oldLogResponse.status, 404);
});

test("GET /logs pagina y limita la respuesta", async () => {
  const firstPageResponse = await request("GET", "/logs?page=1&limit=1");
  const secondPageResponse = await request("GET", "/logs?page=2&limit=1");
  const cappedLimitResponse = await request("GET", "/logs?page=1&limit=999");

  assert.equal(firstPageResponse.status, 200);
  assert.equal(secondPageResponse.status, 200);
  assert.equal(cappedLimitResponse.status, 200);
  assertLogResponse(firstPageResponse.body);
  assertLogResponse(secondPageResponse.body);
  assertLogResponse(cappedLimitResponse.body);
  assert.equal(firstPageResponse.body.pagination.limit, 1);
  assert.equal(secondPageResponse.body.pagination.limit, 1);
  assert.equal(cappedLimitResponse.body.pagination.limit, 100);
  assert.ok(firstPageResponse.body.items.length <= 1);
  assert.ok(secondPageResponse.body.items.length <= 1);
  assert.ok(cappedLimitResponse.body.items.length <= 100);
});

test("GET /logs valida parametros de paginacion", async () => {
  const invalidPageResponse = await request("GET", "/logs?page=0");
  const invalidLimitResponse = await request("GET", "/logs?limit=abc");

  assertError(invalidPageResponse, 400, "INVALID_PAGE");
  assertError(invalidLimitResponse, 400, "INVALID_LIMIT");
});

test("requests con JSON invalido devuelven error estable", async () => {
  const response = await rawRequest("POST", "/exchange", "{ invalid json");

  assertError(response, 400, "INVALID_JSON");
});

test("PUT /accounts/:id/balance valida id y balance", async () => {
  const initialAccounts = await getAccounts();
  const account = initialAccounts[0];
  const newBalance = account.balance + 1;

  try {
    const invalidIdResponse = await request("PUT", "/accounts/1.0/balance", {
      balance: newBalance,
    });
    const negativeBalanceResponse = await putAccountBalance(account.id, -1);
    const textBalanceResponse = await putAccountBalance(account.id, "abc");
    const missingAccountResponse = await putAccountBalance(999999, newBalance);
    const successResponse = await putAccountBalance(account.id, newBalance);

    assertError(invalidIdResponse, 400, "INVALID_ACCOUNT_ID");
    assertError(negativeBalanceResponse, 400, "INVALID_BALANCE");
    assertError(textBalanceResponse, 400, "INVALID_BALANCE");
    assertError(missingAccountResponse, 404, "ACCOUNT_NOT_FOUND");
    assert.equal(successResponse.status, 200);
    assert.equal(successResponse.body.id, account.id);
    assert.equal(successResponse.body.balance, newBalance);
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

test("PUT /accounts/:id/balance normaliza decimales antes de persistir", async () => {
  const initialAccounts = await getAccounts();
  const account = initialAccounts[0];

  try {
    const response = await putAccountBalance(account.id, 0.1 + 0.2);
    const accountsAfter = await getAccounts();

    assert.equal(response.status, 200);
    assert.equal(response.body.balance, 0.3);
    assert.equal(findAccount(accountsAfter, account.id).balance, 0.3);
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

test("PUT /accounts/:id/balance persiste saldos con precision de wallet", async () => {
  const initialAccounts = await getAccounts();
  const account = initialAccounts[0];

  try {
    const response = await putAccountBalance(account.id, 0.1234567890123);
    const accountsAfter = await getAccounts();

    assert.equal(response.status, 200);
    assert.equal(response.body.balance, 0.12);
    assert.equal(findAccount(accountsAfter, account.id).balance, 0.12);
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

test("PUT /rates valida monedas y tasa", async () => {
  const ratesBefore = await getRates();

  try {
    const negativeRateResponse = await setRate("USD", "ARS", -1);
    const textRateResponse = await setRate("USD", "ARS", "abc");
    const unknownCurrencyResponse = await setRate("XYZ", "USD", 1.5);
    const sameCurrencyResponse = await setRate("USD", "USD", 1.5);
    const reciprocalOverflowResponse = await setRate("USD", "ARS", 5e-324);

    assertError(negativeRateResponse, 400, "INVALID_RATE");
    assertError(textRateResponse, 400, "INVALID_RATE");
    assertError(unknownCurrencyResponse, 400, "INVALID_BASE_CURRENCY");
    assertError(sameCurrencyResponse, 400, "SAME_CURRENCY");
    assertError(reciprocalOverflowResponse, 400, "INVALID_RATE");

    const ratesAfterInvalidRequests = await getRates();
    assert.deepEqual(ratesAfterInvalidRequests, ratesBefore);

    const successResponse = await setRate("USD", "ARS", 3);
    assert.equal(successResponse.status, 200);
    assert.equal(successResponse.body.USD.ARS, 3);
    assert.equal(successResponse.body.ARS.USD, 1 / 3);
  } finally {
    await setRate("USD", "ARS", ratesBefore.USD.ARS);
  }
});

test("POST /exchange valida request antes de mutar estado", async () => {
  const initialAccounts = await getAccounts();

  try {
    const accountsBefore = await getAccounts();
    const logsBefore = await getLogs();
    const invalidRequests = [
      {
        body: {
          baseCurrency: "USD",
          counterCurrency: "ARS",
          baseAmount: -5,
          baseAccountId: 11,
          counterAccountId: 10,
        },
        errorCode: "INVALID_BASE_AMOUNT",
      },
      {
        body: {
          baseCurrency: "USD",
          counterCurrency: "ARS",
          baseAmount: 0,
          baseAccountId: 11,
          counterAccountId: 10,
        },
        errorCode: "INVALID_BASE_AMOUNT",
      },
      {
        body: {
          baseCurrency: "USD",
          counterCurrency: "ARS",
          baseAmount: "abc",
          baseAccountId: 11,
          counterAccountId: 10,
        },
        errorCode: "INVALID_BASE_AMOUNT",
      },
      {
        body: {
          baseCurrency: "XYZ",
          counterCurrency: "ARS",
          baseAmount: 10,
          baseAccountId: 11,
          counterAccountId: 10,
        },
        errorCode: "INVALID_BASE_CURRENCY",
      },
      {
        body: {
          baseCurrency: "USD",
          counterCurrency: "USD",
          baseAmount: 10,
          baseAccountId: 11,
          counterAccountId: 10,
        },
        errorCode: "SAME_CURRENCY",
      },
      {
        body: {
          baseCurrency: "USD",
          counterCurrency: "EUR",
          baseAmount: 10,
          baseAccountId: 11,
          counterAccountId: 12,
        },
        errorCode: "RATE_NOT_FOUND",
      },
      {
        body: {
          baseCurrency: "USD",
          counterCurrency: "ARS",
          baseAmount: 10,
          baseAccountId: "cuenta-origen",
          counterAccountId: 10,
        },
        errorCode: "INVALID_BASE_ACCOUNT_ID",
      },
      {
        body: {
          baseCurrency: "USD",
          counterCurrency: "ARS",
          baseAmount: 10,
          baseAccountId: 11,
          counterAccountId: "cuenta-destino",
        },
        errorCode: "INVALID_COUNTER_ACCOUNT_ID",
      },
      {
        body: {
          baseCurrency: "USD",
          counterCurrency: "ARS",
          baseAmount: Number.MAX_VALUE,
          baseAccountId: 11,
          counterAccountId: 10,
        },
        errorCode: "INVALID_COUNTER_AMOUNT",
      },
    ];

    for (const invalidRequest of invalidRequests) {
      const response = await postExchange(invalidRequest.body);
      assertError(response, 400, invalidRequest.errorCode);
    }

    const accountsAfter = await getAccounts();
    const logsAfter = await getLogs();

    assertAccountsEqual(accountsAfter, accountsBefore);
    assert.equal(
      logsAfter.pagination.totalItems,
      logsBefore.pagination.totalItems
    );
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

test("POST /exchange normaliza decimales antes de responder y persistir", async () => {
  const initialAccounts = await getAccounts();
  const ratesBefore = await getRates();

  try {
    await setRate("USD", "ARS", 0.2);

    const accountsBefore = await getAccounts();
    const logsBefore = await getLogs();
    const response = await postExchange({
      baseCurrency: "USD",
      counterCurrency: "ARS",
      baseAmount: 0.1,
      baseAccountId: 11,
      counterAccountId: 10,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.counterAmount, 0.02);

    const accountsAfter = await getAccounts();
    const logsAfter = await getLogs();
    const lastLogEntry = await getLastLogEntry(logsAfter.pagination.totalItems);

    assert.equal(
      findAccountByCurrency(accountsAfter, "USD").balance,
      findAccountByCurrency(accountsBefore, "USD").balance + 0.1
    );
    assert.equal(
      findAccountByCurrency(accountsAfter, "ARS").balance,
      findAccountByCurrency(accountsBefore, "ARS").balance - 0.02
    );
    assert.equal(
      logsAfter.pagination.totalItems,
      logsBefore.pagination.totalItems + 1
    );
    assert.equal(lastLogEntry.counterAmount, 0.02);
    assert.equal(lastLogEntry.request.baseAmount, 0.1);
  } finally {
    await restoreAccounts(initialAccounts);
    await setRate("USD", "ARS", ratesBefore.USD.ARS);
  }
});

test("POST /exchange devuelve 409 cuando el saldo interno no alcanza", async () => {
  const initialAccounts = await getAccounts();
  const rates = await getRates();

  try {
    const accountsBefore = await getAccounts();
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
    assert.equal(response.body.errorCode, "INSUFFICIENT_COUNTER_FUNDS");
    assert.equal(response.body.ok, false);

    const accountsAfter = await getAccounts();
    assertAccountsEqual(accountsAfter, accountsBefore);
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

test("POST /exchange concurrente rechaza una operacion sin saldo negativo", async () => {
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

    const successfulResponses = responses.filter((response) => response.status === 200);
    const rejectedResponses = responses.filter((response) => response.status === 409);
    const accountsAfter = await getAccounts();

    assert.equal(successfulResponses.length, 1);
    assert.equal(rejectedResponses.length, 1);
    assert.equal(findAccountByCurrency(accountsAfter, "ARS").balance, 0);
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

async function restoreAccounts(accounts) {
  for (const account of accounts) {
    const response = await putAccountBalance(account.id, account.balance);
    assert.equal(response.status, 200);
  }
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

async function getLogs() {
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

function setRate(baseCurrency, counterCurrency, rate) {
  return request("PUT", "/rates", { baseCurrency, counterCurrency, rate });
}

function putAccountBalance(accountId, balance) {
  return request("PUT", `/accounts/${accountId}/balance`, { balance });
}

async function request(method, path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
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

async function rawRequest(method, path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body,
  });
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

function assertError(response, status, errorCode) {
  assert.equal(response.status, status);
  assert.equal(response.body.errorCode, errorCode);
  assert.equal(typeof response.body.obs, "string");
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
