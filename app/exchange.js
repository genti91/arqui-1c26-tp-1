import { nanoid } from "nanoid";
import { registerSuccessfulExchangeMetrics } from "./metrics.js";

const MONEY_DECIMAL_PLACES = 2;

import {
  init as stateInit,
  getAccounts as stateAccounts,
  setAccountBalance as stateSetAccountBalance,
  getRates as stateRates,
  setRate as stateSetRate,
  getLog as stateLog,
  getAccountByCurrency,
  reserveAccountBalanceByCurrency,
  addAccountBalance,
  addAccountBalanceAndLog,
  appendLog,
} from "./state.js";

//call to initialize the exchange service
export async function init() {
  await stateInit();
}

//returns all internal accounts
export function getAccounts() {
  return stateAccounts();
}

//sets balance for an account
export function setAccountBalance(accountId, balance) {
  return stateSetAccountBalance(accountId, balance);
}

//returns all current exchange rates
export function getRates() {
  return stateRates();
}

//returns a paginated transaction log
export function getLog(pagination) {
  return stateLog(pagination);
}

//sets the exchange rate for a given pair of currencies, and the reciprocal rate as well
export function setRate(rateRequest) {
  return stateSetRate(rateRequest);
}

//executes an exchange operation
export async function exchange(exchangeRequest) {
  const {
    baseCurrency,
    counterCurrency,
    baseAccountId: clientBaseAccountId,
    counterAccountId: clientCounterAccountId,
    baseAmount,
  } = exchangeRequest;

  const rates = await stateRates();
  const exchangeRate = rates[baseCurrency]?.[counterCurrency];
  const counterAmount = roundDecimalAmount(baseAmount * exchangeRate);
  const baseAccount = await getAccountByCurrency(baseCurrency);
  
  //construct the result object with defaults
  const exchangeResult = {
    id: nanoid(),
    ts: new Date(),
    ok: false,
    request: exchangeRequest,
    exchangeRate: exchangeRate,
    counterAmount: 0.0,
    obs: null,
  };

  if (baseAccount == null || !Number.isFinite(counterAmount)) {
    return failExchange(
      exchangeResult,
      "INSUFFICIENT_COUNTER_FUNDS",
      "Not enough funds on counter currency account"
    );
  }

  const reservedCounterAccount = await reserveAccountBalanceByCurrency(
    counterCurrency,
    counterAmount
  );

  if (reservedCounterAccount == null) {
    return failExchange(
      exchangeResult,
      "INSUFFICIENT_COUNTER_FUNDS",
      "Not enough funds on counter currency account"
    );
  }

  const baseAmountReceived = await transfer(
    clientBaseAccountId,
    baseAccount.id,
    baseAmount
  );

  if (!baseAmountReceived) {
    return failExchangeAndReleaseCounterBalance(
      exchangeResult,
      reservedCounterAccount.id,
      counterAmount,
      "CLIENT_WITHDRAWAL_FAILED",
      "Could not withdraw from clients' account"
    );
  }

  const counterAmountSent = await transfer(
    reservedCounterAccount.id,
    clientCounterAccountId,
    counterAmount
  );

  if (!counterAmountSent) {
    await transfer(baseAccount.id, clientBaseAccountId, baseAmount);
    return failExchangeAndReleaseCounterBalance(
      exchangeResult,
      reservedCounterAccount.id,
      counterAmount,
      "CLIENT_DEPOSIT_FAILED",
      "Could not transfer to clients' account"
    );
  }

  exchangeResult.ok = true;
  exchangeResult.counterAmount = counterAmount;

  await addAccountBalanceAndLog(baseAccount.id, baseAmount, exchangeResult);

  await registerSuccessfulExchangeMetrics({
    baseCurrency,
    counterCurrency,
    baseAmount,
    counterAmount,
  });

  return exchangeResult;
}

// internal - call transfer service to execute transfer between accounts
async function transfer(fromAccountId, toAccountId, amount) {
  const min = 200;
  const max = 400;
  return new Promise((resolve) =>
    setTimeout(() => resolve(true), Math.random() * (max - min + 1) + min)
  );
}

function roundDecimalAmount(amount) {
  if (!Number.isFinite(amount)) {
    return amount;
  }

  return Number(amount.toFixed(MONEY_DECIMAL_PLACES));
}

async function failExchangeAndReleaseCounterBalance(
  exchangeResult,
  counterAccountId,
  counterAmount,
  errorCode,
  observation
) {
  await addAccountBalance(counterAccountId, counterAmount);

  return failExchange(exchangeResult, errorCode, observation);
}

async function failExchange(exchangeResult, errorCode, observation) {
  exchangeResult.errorCode = errorCode;
  exchangeResult.obs = observation;
  await appendLog(exchangeResult);

  return exchangeResult;
}
