import express from "express";

import {
  init as exchangeInit,
  getAccounts,
  setAccountBalance,
  getRates,
  setRate,
  getLog,
  exchange,
} from "./exchange.js";

await exchangeInit();

const app = express();
const port = 3000;
const DEFAULT_LOG_LIMIT = 50;
const MAX_LOG_LIMIT = 100;
const DEFAULT_LOG_PAGE = 1;

app.use(express.json());
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return sendError(res, 400, "INVALID_JSON", "Invalid JSON body");
  }

  next(err);
});

// ACCOUNT endpoints

app.get("/accounts", async (req, res) => {
  try {
    res.json(await getAccounts());
  } catch (err) {
    handleStorageError(res, err);
  }
});

app.put("/accounts/:id/balance", async (req, res) => {
  const accountId = req.params.id;
  const { balance } = req.body || {};

  if (!isPositiveIntegerString(accountId)) {
    return sendError(res, 400, "INVALID_ACCOUNT_ID", "Invalid account id");
  }

  if (!isNonNegativeNumber(balance)) {
    return sendError(res, 400, "INVALID_BALANCE", "Invalid balance");
  }

  try {
    const updatedAccount = await setAccountBalance(Number(accountId), balance);

    if (updatedAccount == null) {
      return sendError(res, 404, "ACCOUNT_NOT_FOUND", "Account not found");
    }

    res.json(updatedAccount);
  } catch (err) {
    handleStorageError(res, err);
  }
});

// RATE endpoints

app.get("/rates", async (req, res) => {
  try {
    res.json(await getRates());
  } catch (err) {
    handleStorageError(res, err);
  }
});

app.put("/rates", async (req, res) => {
  const { baseCurrency, counterCurrency, rate } = req.body || {};

  if (!isNonEmptyString(baseCurrency)) {
    return sendError(res, 400, "INVALID_BASE_CURRENCY", "Invalid base currency");
  }

  if (!isNonEmptyString(counterCurrency)) {
    return sendError(
      res,
      400,
      "INVALID_COUNTER_CURRENCY",
      "Invalid counter currency"
    );
  }

  if (baseCurrency === counterCurrency) {
    return sendError(res, 400, "SAME_CURRENCY", "Currencies must be different");
  }

  if (!isPositiveNumber(rate)) {
    return sendError(res, 400, "INVALID_RATE", "Invalid rate");
  }

  try {
    const accounts = await getAccounts();

    if (!isExistingCurrency(baseCurrency, accounts)) {
      return sendError(res, 400, "INVALID_BASE_CURRENCY", "Invalid base currency");
    }

    if (!isExistingCurrency(counterCurrency, accounts)) {
      return sendError(
        res,
        400,
        "INVALID_COUNTER_CURRENCY",
        "Invalid counter currency"
      );
    }

    if (!Number.isFinite(1 / rate)) {
      return sendError(res, 400, "INVALID_RATE", "Invalid rate");
    }

    const newRateRequest = { baseCurrency, counterCurrency, rate };
    await setRate(newRateRequest);

    res.json(await getRates());
  } catch (err) {
    handleStorageError(res, err);
  }
});

// LOG endpoint

app.get("/logs", async (req, res) => {
  const page = parsePositiveIntegerQueryParam(
    req.query.page,
    DEFAULT_LOG_PAGE
  );
  const requestedLimit = parsePositiveIntegerQueryParam(
    req.query.limit,
    DEFAULT_LOG_LIMIT
  );

  if (page == null) {
    return sendError(res, 400, "INVALID_PAGE", "Invalid page");
  }

  if (requestedLimit == null) {
    return sendError(res, 400, "INVALID_LIMIT", "Invalid limit");
  }

  const limit = Math.min(requestedLimit, MAX_LOG_LIMIT);

  try {
    res.json(await getLog({ page, limit }));
  } catch (err) {
    handleStorageError(res, err);
  }
});

// EXCHANGE endpoint

app.post("/exchange", async (req, res) => {
  const {
    baseCurrency,
    counterCurrency,
    baseAccountId,
    counterAccountId,
    baseAmount,
  } = req.body || {};

  if (!isNonEmptyString(baseCurrency)) {
    return sendError(res, 400, "INVALID_BASE_CURRENCY", "Invalid base currency");
  }

  if (!isNonEmptyString(counterCurrency)) {
    return sendError(
      res,
      400,
      "INVALID_COUNTER_CURRENCY",
      "Invalid counter currency"
    );
  }

  if (baseCurrency === counterCurrency) {
    return sendError(res, 400, "SAME_CURRENCY", "Currencies must be different");
  }

  if (!isPositiveNumber(baseAmount)) {
    return sendError(res, 400, "INVALID_BASE_AMOUNT", "Invalid base amount");
  }

  if (!isPositiveInteger(baseAccountId)) {
    return sendError(
      res,
      400,
      "INVALID_BASE_ACCOUNT_ID",
      "Invalid base account id"
    );
  }

  if (!isPositiveInteger(counterAccountId)) {
    return sendError(
      res,
      400,
      "INVALID_COUNTER_ACCOUNT_ID",
      "Invalid counter account id"
    );
  }

  try {
    const accounts = await getAccounts();

    if (!isExistingCurrency(baseCurrency, accounts)) {
      return sendError(res, 400, "INVALID_BASE_CURRENCY", "Invalid base currency");
    }

    if (!isExistingCurrency(counterCurrency, accounts)) {
      return sendError(
        res,
        400,
        "INVALID_COUNTER_CURRENCY",
        "Invalid counter currency"
      );
    }

    const rates = await getRates();
    const counterAmount = baseAmount * rates[baseCurrency]?.[counterCurrency];

    if (!isPositiveNumber(rates[baseCurrency]?.[counterCurrency])) {
      return sendError(res, 400, "RATE_NOT_FOUND", "Rate not found");
    }

    if (!Number.isFinite(counterAmount)) {
      return sendError(res, 400, "INVALID_COUNTER_AMOUNT", "Invalid counter amount");
    }

    const exchangeRequest = {
      baseCurrency,
      counterCurrency,
      baseAccountId,
      counterAccountId,
      baseAmount,
    };
    const exchangeResult = await exchange(exchangeRequest);

    if (exchangeResult.ok) {
      return res.status(200).json(exchangeResult);
    }

    if (exchangeResult.errorCode === "INSUFFICIENT_COUNTER_FUNDS") {
      return res.status(409).json(exchangeResult);
    }

    res.status(500).json(exchangeResult);
  } catch (err) {
    handleStorageError(res, err);
  }
});

app.listen(port, () => {
  console.log(`Exchange API listening on port ${port}`);
});

export default app;

function handleStorageError(res, err) {
  console.error("Storage error:", err);
  sendError(res, 503, "STORAGE_UNAVAILABLE", "Storage unavailable");
}

function sendError(res, status, errorCode, obs) {
  return res.status(status).json({ errorCode, obs });
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isPositiveIntegerString(value) {
  return typeof value === "string" && /^[1-9]\d*$/.test(value);
}

function parsePositiveIntegerQueryParam(value, defaultValue) {
  if (value == null) {
    return defaultValue;
  }

  if (!isPositiveIntegerString(value)) {
    return null;
  }

  const parsedValue = Number(value);

  if (!Number.isSafeInteger(parsedValue)) {
    return null;
  }

  return parsedValue;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isExistingCurrency(currency, accounts) {
  if (!isNonEmptyString(currency)) {
    return false;
  }

  return accounts.some((account) => account.currency === currency);
}
