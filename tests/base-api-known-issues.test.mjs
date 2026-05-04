import assert from "node:assert/strict";
import test from "node:test";

const BASE_URL = process.env.ARVAULT_BASE_URL || "http://localhost:5555";
const RUN_CRASH_KNOWN_ISSUES = process.env.ARVAULT_RUN_CRASH_KNOWN_ISSUES === "1";

test("POST /exchange deberia rechazar monto negativo sin cambiar saldos", async () => {
  const initialAccounts = await getAccounts();
  const accountsBefore = await getAccounts();

  try {
    const response = await postExchange({
      baseCurrency: "USD",
      counterCurrency: "ARS",
      baseAmount: -5,
      baseAccountId: 11,
      counterAccountId: 10,
    });

    assert.equal(response.status, 400);

    const accountsAfter = await getAccounts();
    assert.equal(findAccount(accountsAfter, 1).balance, findAccount(accountsBefore, 1).balance);
    assert.equal(findAccount(accountsAfter, 2).balance, findAccount(accountsBefore, 2).balance);
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

test("POST /exchange deberia rechazar monto no numerico sin cambiar saldos", async () => {
  const initialAccounts = await getAccounts();
  const accountsBefore = await getAccounts();

  try {
    const response = await postExchange({
      baseCurrency: "USD",
      counterCurrency: "ARS",
      baseAmount: "abc",
      baseAccountId: 11,
      counterAccountId: 10,
    });

    assert.equal(response.status, 400);

    const accountsAfter = await getAccounts();
    assertAccountsEqual(accountsAfter, accountsBefore);
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

test("POST /exchange deberia rechazar ids de cuenta no numericos sin cambiar saldos", async () => {
  const initialAccounts = await getAccounts();
  const accountsBefore = await getAccounts();

  try {
    const response = await postExchange({
      baseCurrency: "USD",
      counterCurrency: "ARS",
      baseAmount: 5,
      baseAccountId: "cuenta-origen",
      counterAccountId: "cuenta-destino",
    });

    assert.equal(response.status, 400);

    const accountsAfter = await getAccounts();
    assertAccountsEqual(accountsAfter, accountsBefore);
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

test("POST /exchange deberia devolver 409 cuando el saldo interno no alcanza", async () => {
  const initialAccounts = await getAccounts();
  const rates = await getRates();
  const accountsBefore = await getAccounts();
  const arsBalance = findAccountByCurrency(accountsBefore, "ARS").balance;
  const baseAmount = Math.floor(arsBalance / rates.USD.ARS) + 1;

  try {
    const response = await postExchange({
      baseCurrency: "USD",
      counterCurrency: "ARS",
      baseAmount,
      baseAccountId: 11,
      counterAccountId: 10,
    });

    assert.equal(response.status, 409);
    assert.equal(typeof response.body.errorCode, "string");
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

test("POST /exchange deberia rechazar pares sin tasa con 400", async () => {
  const response = await postExchange({
    baseCurrency: "USD",
    counterCurrency: "EUR",
    baseAmount: 10,
    baseAccountId: 11,
    counterAccountId: 12,
  });

  assert.equal(response.status, 400);
});

test("POST /exchange no deberia permitir saldos negativos por operaciones concurrentes", async () => {
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
    assert.ok(findAccountByCurrency(accountsAfter, "ARS").balance >= 0);
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

test(
  "POST /exchange deberia rechazar moneda base inexistente con 400",
  {
    skip: RUN_CRASH_KNOWN_ISSUES
      ? false
      : "La app base puede tumbar el proceso. Ejecutar con ARVAULT_RUN_CRASH_KNOWN_ISSUES=1.",
  },
  async () => {
    const response = await postExchange({
      baseCurrency: "XYZ",
      counterCurrency: "ARS",
      baseAmount: 10,
      baseAccountId: 11,
      counterAccountId: 10,
    });

    assert.equal(response.status, 400);
  }
);

test("PUT /accounts/:id/balance deberia rechazar saldos negativos", async () => {
  const initialAccounts = await getAccounts();
  const account = initialAccounts[0];

  try {
    const response = await request("PUT", `/accounts/${account.id}/balance`, {
      balance: -1,
    });

    assert.equal(response.status, 400);

    const accountsAfter = await getAccounts();
    assert.equal(findAccount(accountsAfter, account.id).balance, account.balance);
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

test("PUT /accounts/:id/balance deberia rechazar saldos no numericos", async () => {
  const initialAccounts = await getAccounts();
  const account = initialAccounts[0];

  try {
    const response = await request("PUT", `/accounts/${account.id}/balance`, {
      balance: "abc",
    });

    assert.equal(response.status, 400);

    const accountsAfter = await getAccounts();
    assert.equal(findAccount(accountsAfter, account.id).balance, account.balance);
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

test("PUT /accounts/:id/balance deberia devolver 404 si la cuenta no existe", async () => {
  const initialAccounts = await getAccounts();

  try {
    const response = await request("PUT", "/accounts/999999/balance", {
      balance: 100,
    });

    assert.equal(response.status, 404);
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

test("PUT /accounts/:id/balance deberia devolver solo la cuenta modificada", async () => {
  const initialAccounts = await getAccounts();
  const account = initialAccounts[0];
  const newBalance = account.balance + 1;

  try {
    const response = await request("PUT", `/accounts/${account.id}/balance`, {
      balance: newBalance,
    });

    assert.equal(response.status, 200);
    assert.equal(Array.isArray(response.body), false);
    assert.equal(response.body.id, account.id);
    assert.equal(response.body.balance, newBalance);
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

test("PUT /accounts/:id/balance deberia rechazar ids con coercion implicita", async () => {
  const initialAccounts = await getAccounts();
  const account = findAccount(initialAccounts, 1);

  try {
    const response = await request("PUT", "/accounts/1.0/balance", {
      balance: account.balance + 1,
    });

    assert.equal(response.status, 400);

    const accountsAfter = await getAccounts();
    assert.equal(findAccount(accountsAfter, account.id).balance, account.balance);
  } finally {
    await restoreAccounts(initialAccounts);
  }
});

test("PUT /rates deberia rechazar tasas negativas", async () => {
  const ratesBefore = await getRates();

  try {
    const response = await setUsdArsRate(-1);

    assert.equal(response.status, 400);
  } finally {
    await setUsdArsRate(ratesBefore.USD.ARS);
  }
});

test("PUT /rates deberia rechazar tasas no numericas", async () => {
  const ratesBefore = await getRates();

  try {
    const response = await setUsdArsRate("abc");

    assert.equal(response.status, 400);

    const ratesAfter = await getRates();
    assert.deepEqual(ratesAfter, ratesBefore);
  } finally {
    await setUsdArsRate(ratesBefore.USD.ARS);
  }
});

test("PUT /rates deberia rechazar monedas inexistentes sin cambiar tasas", async () => {
  const ratesBefore = await getRates();

  const response = await request("PUT", "/rates", {
    baseCurrency: "XYZ",
    counterCurrency: "USD",
    rate: 1.5,
  });

  assert.equal(response.status, 400);

  const ratesAfter = await getRates();
  assert.deepEqual(ratesAfter, ratesBefore);
});

test("PUT /rates no deberia truncar la tasa reciproca a cinco decimales", async () => {
  const ratesBefore = await getRates();

  try {
    const response = await setUsdArsRate(3);

    assert.equal(response.status, 200);

    const ratesAfter = await getRates();
    assert.equal(ratesAfter.ARS.USD, 1 / 3);
  } finally {
    await setUsdArsRate(ratesBefore.USD.ARS);
  }
});

test("POST /exchange deberia calcular montos decimales sin error de punto flotante", async () => {
  const initialAccounts = await getAccounts();
  const ratesBefore = await getRates();
  const baseAmount = 0.1;
  const expectedCounterAmount = 0.02;

  try {
    await ensureCurrencyBalance("ARS", initialAccounts, expectedCounterAmount);
    await setUsdArsRate(0.2);

    const response = await postExchange({
      baseCurrency: "USD",
      counterCurrency: "ARS",
      baseAmount,
      baseAccountId: 11,
      counterAccountId: 10,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.counterAmount, expectedCounterAmount);
  } finally {
    await restoreAccounts(initialAccounts);
    await setUsdArsRate(ratesBefore.USD.ARS);
  }
});

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

async function ensureLogHasAtLeastEntries(minimumLength) {
  let log = await getLog();

  while (log.pagination.totalItems < minimumLength) {
    await postExchange({
      baseCurrency: "USD",
      counterCurrency: "ARS",
      baseAmount: 1,
      baseAccountId: 11,
      counterAccountId: 10,
    });

    log = await getLog();
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

async function getLog() {
  const response = await request("GET", "/logs");
  assert.equal(response.status, 200);
  assertLogResponse(response.body);
  return response.body;
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

function setUsdArsRate(rate) {
  return setRate({
    baseCurrency: "USD",
    counterCurrency: "ARS",
    rate,
  });
}

function setRate(rateRequest) {
  return request("PUT", "/rates", rateRequest);
}

function putAccountBalance(accountId, balance) {
  return request("PUT", `/accounts/${accountId}/balance`, { balance });
}

async function request(method, path, body) {
  const headers = {
    ...(body ? { "Content-Type": "application/json" } : {}),
  };

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
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
