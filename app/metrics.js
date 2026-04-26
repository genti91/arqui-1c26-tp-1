import dgram from "dgram";

const METRICS_HOST = process.env.STATSD_HOST || "graphite";
const METRICS_PORT = Number(process.env.STATSD_PORT || 8125);
const METRICS_PREFIX = process.env.STATSD_PREFIX || "exchange-api";

const socket = dgram.createSocket("udp4");

const businessTotals = {
  volumeByCurrency: {},
  netByCurrency: {},
};

export function registerSuccessfulExchangeMetrics({
  baseCurrency,
  counterCurrency,
  baseAmount,
  counterAmount,
}) {
  // Volume is always positive for both currencies involved.
  addToMap(businessTotals.volumeByCurrency, baseCurrency, baseAmount);
  addToMap(businessTotals.volumeByCurrency, counterCurrency, counterAmount);

  // Net follows business rule: buys add, sells subtract.
  addToMap(businessTotals.netByCurrency, counterCurrency, counterAmount);
  addToMap(businessTotals.netByCurrency, baseCurrency, -baseAmount);

  sendGauge(
    `business.volume.${baseCurrency}`,
    businessTotals.volumeByCurrency[baseCurrency]
  );
  sendGauge(
    `business.volume.${counterCurrency}`,
    businessTotals.volumeByCurrency[counterCurrency]
  );
  sendGauge(
    `business.net.${baseCurrency}`,
    businessTotals.netByCurrency[baseCurrency]
  );
  sendGauge(
    `business.net.${counterCurrency}`,
    businessTotals.netByCurrency[counterCurrency]
  );
}

function addToMap(map, key, amount) {
  const current = map[key] || 0;
  map[key] = Number((current + amount).toFixed(5));
}

function sendGauge(metricName, value) {
  const payload = `${METRICS_PREFIX}.${metricName}:${value}|g`;
  const message = Buffer.from(payload);

  socket.send(message, METRICS_PORT, METRICS_HOST, (err) => {
    if (err) {
      console.error("Could not send metric", metricName, err.message);
    }
  });
}
