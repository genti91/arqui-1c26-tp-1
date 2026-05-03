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

app.use(express.json());

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
  const { balance } = req.body;

  if (!accountId || !balance) {
    return res.status(400).json({ error: "Malformed request" });
  } else {
    try {
      await setAccountBalance(accountId, balance);

      res.json(await getAccounts());
    } catch (err) {
      handleStorageError(res, err);
    }
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
  const { baseCurrency, counterCurrency, rate } = req.body;

  if (!baseCurrency || !counterCurrency || !rate) {
    return res.status(400).json({ error: "Malformed request" });
  }

  const newRateRequest = { ...req.body };
  try {
    await setRate(newRateRequest);

    res.json(await getRates());
  } catch (err) {
    handleStorageError(res, err);
  }
});

// LOG endpoint

app.get("/log", async (req, res) => {
  try {
    res.json(await getLog());
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
  } = req.body;

  if (
    !baseCurrency ||
    !counterCurrency ||
    !baseAccountId ||
    !counterAccountId ||
    !baseAmount
  ) {
    return res.status(400).json({ error: "Malformed request" });
  }

  try {
    const exchangeRequest = { ...req.body };
    const exchangeResult = await exchange(exchangeRequest);

    if (exchangeResult.ok) {
      res.status(200).json(exchangeResult);
    } else {
      res.status(500).json(exchangeResult);
    }
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
  res.status(503).json({ error: "Storage unavailable" });
}
