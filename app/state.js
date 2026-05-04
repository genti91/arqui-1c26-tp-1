import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { createClient } from "redis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ACCOUNTS_FILE = "./seed/accounts.json";
const RATES_FILE = "./seed/rates.json";
const LOG_FILE = "./seed/log.json";

const ACCOUNTS_KEY = "arvault:accounts";
const RATES_KEY = "arvault:rates";
const LOG_KEY = "arvault:log";
const MONEY_DECIMAL_PLACES = 2;

const RESERVE_ACCOUNT_BALANCE_BY_CURRENCY_SCRIPT = `
local function roundAmount(amount)
  return tonumber(string.format("%.2f", amount))
end

local accounts = redis.call("HGETALL", KEYS[1])
local currency = ARGV[1]
local amount = tonumber(ARGV[2])

if amount == nil then
  return nil
end

for i = 1, #accounts, 2 do
  local account = cjson.decode(accounts[i + 1])

  if account.currency == currency then
    if account.balance >= amount then
      account.balance = roundAmount(account.balance - amount)
      redis.call("HSET", KEYS[1], accounts[i], cjson.encode(account))
      return cjson.encode(account)
    end

    return nil
  end
end

return nil
`;

const ADD_ACCOUNT_BALANCE_AND_LOG_SCRIPT = `
local function roundAmount(amount)
  return tonumber(string.format("%.2f", amount))
end

local accountJson = redis.call("HGET", KEYS[1], ARGV[1])

if accountJson == false then
  return 0
end

local account = cjson.decode(accountJson)
account.balance = roundAmount(account.balance + tonumber(ARGV[2]))

redis.call("HSET", KEYS[1], ARGV[1], cjson.encode(account))
redis.call("RPUSH", KEYS[2], ARGV[3])

return 1
`;

const ADD_ACCOUNT_BALANCE_SCRIPT = `
local function roundAmount(amount)
  return tonumber(string.format("%.2f", amount))
end

local accountJson = redis.call("HGET", KEYS[1], ARGV[1])

if accountJson == false then
  return 0
end

local account = cjson.decode(accountJson)
account.balance = roundAmount(account.balance + tonumber(ARGV[2]))

redis.call("HSET", KEYS[1], ARGV[1], cjson.encode(account))

return 1
`;

let redisClient = null;
let connectPromise = null;

export async function init() {
  try {
    await getRedisClient();
  } catch (err) {
    console.error("Could not connect to Redis:", err);
  }
}

export async function getAccounts() {
  const client = await getRedisClient();
  const rawAccounts = await client.hGetAll(ACCOUNTS_KEY);

  return Object.values(rawAccounts)
    .map(JSON.parse)
    .sort((left, right) => left.id - right.id);
}

export async function getRates() {
  const client = await getRedisClient();
  const rawRates = await client.hGetAll(RATES_KEY);
  const rates = {};

  for (const [pair, rate] of Object.entries(rawRates)) {
    const [baseCurrency, counterCurrency] = pair.split(":");

    if (!rates[baseCurrency]) {
      rates[baseCurrency] = {};
    }

    rates[baseCurrency][counterCurrency] = Number(rate);
  }

  return rates;
}

export async function getLog({ page, limit }) {
  const client = await getRedisClient();
  const totalItems = await client.lLen(LOG_KEY);
  const totalPages = Math.ceil(totalItems / limit);
  const start = (page - 1) * limit;
  const end = start + limit - 1;
  const rawLog = start < totalItems
    ? await client.lRange(LOG_KEY, start, end)
    : [];

  return {
    items: rawLog.map(JSON.parse),
    pagination: {
      page,
      limit,
      totalItems,
      totalPages,
    },
  };
}

export async function getAccountByCurrency(currency) {
  const accounts = await getAccounts();
  const account = accounts.find((currentAccount) => {
    return currentAccount.currency == currency;
  });

  return account || null;
}

export async function setAccountBalance(accountId, balance) {
  const client = await getRedisClient();
  const account = await getAccountById(accountId);

  if (account == null) {
    return null;
  }

  account.balance = roundDecimalAmount(balance);
  await client.hSet(ACCOUNTS_KEY, String(account.id), JSON.stringify(account));

  return account;
}

export async function setRate(rateRequest) {
  const client = await getRedisClient();
  const { baseCurrency, counterCurrency, rate } = rateRequest;

  await client.hSet(RATES_KEY, `${baseCurrency}:${counterCurrency}`, String(rate));
  await client.hSet(
    RATES_KEY,
    `${counterCurrency}:${baseCurrency}`,
    String(1 / rate)
  );
}

export async function reserveAccountBalanceByCurrency(currency, amount) {
  const client = await getRedisClient();
  const reservedAccount = await client.eval(
    RESERVE_ACCOUNT_BALANCE_BY_CURRENCY_SCRIPT,
    {
      keys: [ACCOUNTS_KEY],
      arguments: [currency, String(amount)],
    }
  );

  if (!reservedAccount) {
    return null;
  }

  return JSON.parse(reservedAccount);
}

export async function addAccountBalance(accountId, amount) {
  const client = await getRedisClient();
  const updated = await client.eval(ADD_ACCOUNT_BALANCE_SCRIPT, {
    keys: [ACCOUNTS_KEY],
    arguments: [String(accountId), String(amount)],
  });

  return updated == 1;
}

export async function addAccountBalanceAndLog(accountId, amount, logEntry) {
  const client = await getRedisClient();
  const updated = await client.eval(ADD_ACCOUNT_BALANCE_AND_LOG_SCRIPT, {
    keys: [ACCOUNTS_KEY, LOG_KEY],
    arguments: [
      String(accountId),
      String(roundDecimalAmount(amount)),
      JSON.stringify(normalizeLogEntry(logEntry)),
    ],
  });

  return updated == 1;
}

export async function appendLog(logEntry) {
  const client = await getRedisClient();

  await client.rPush(LOG_KEY, JSON.stringify(normalizeLogEntry(logEntry)));
}

async function getRedisClient() {
  if (redisClient?.isReady) {
    return redisClient;
  }

  if (connectPromise == null) {
    connectPromise = openRedisClient();
  }

  try {
    return await connectPromise;
  } finally {
    connectPromise = null;
  }
}

async function openRedisClient() {
  if (redisClient == null || !redisClient.isOpen) {
    redisClient = createRedisClient();
  }

  if (!redisClient.isOpen) {
    await redisClient.connect();
  }

  await seedRedisIfEmpty();

  return redisClient;
}

function createRedisClient() {
  const client = createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379",
    socket: {
      reconnectStrategy: false,
    },
  });

  client.on("error", (err) => {
    console.error("Redis Client Error:", err);
  });

  return client;
}

async function seedRedisIfEmpty() {
  const accountsCount = await redisClient.hLen(ACCOUNTS_KEY);

  if (accountsCount > 0) {
    return;
  }

  const accounts = await loadJson(ACCOUNTS_FILE);
  const rates = await loadJson(RATES_FILE);
  const log = await loadJson(LOG_FILE);
  const seed = redisClient.multi();

  for (const account of accounts) {
    seed.hSet(ACCOUNTS_KEY, String(account.id), JSON.stringify(account));
  }

  for (const [baseCurrency, counterRates] of Object.entries(rates)) {
    for (const [counterCurrency, rate] of Object.entries(counterRates)) {
      seed.hSet(RATES_KEY, `${baseCurrency}:${counterCurrency}`, String(rate));
    }
  }

  for (const logEntry of log) {
    seed.rPush(LOG_KEY, JSON.stringify(logEntry));
  }

  await seed.exec();
}

async function getAccountById(accountId) {
  const client = await getRedisClient();
  const rawAccount = await client.hGet(ACCOUNTS_KEY, String(accountId));

  return rawAccount ? JSON.parse(rawAccount) : null;
}

function normalizeLogEntry(logEntry) {
  return {
    ...logEntry,
    counterAmount: roundDecimalAmount(logEntry.counterAmount),
    request: {
      ...logEntry.request,
      baseAmount: roundDecimalAmount(logEntry.request?.baseAmount),
    },
  };
}

function roundDecimalAmount(amount) {
  if (!Number.isFinite(amount)) {
    return amount;
  }

  return Number(amount.toFixed(MONEY_DECIMAL_PLACES));
}

async function loadJson(fileName) {
  const filePath = path.join(__dirname, fileName);
  const raw = await fs.promises.readFile(filePath, "utf8");

  return JSON.parse(raw);
}
