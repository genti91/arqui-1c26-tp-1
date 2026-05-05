import dgram from "dgram";
import { addBusinessMetrics } from "./state.js";

const METRICS_HOST = process.env.STATSD_HOST || "graphite";
const METRICS_PORT = Number(process.env.STATSD_PORT || 8125);
const METRICS_PREFIX = process.env.STATSD_PREFIX || "exchange-api";

const socket = dgram.createSocket("udp4");

export async function registerSuccessfulExchangeMetrics({
  baseCurrency,
  counterCurrency,
  baseAmount,
  counterAmount,
}) {
  let businessTotals;

  try {
    businessTotals = await addBusinessMetrics({
      baseCurrency,
      counterCurrency,
      baseAmount,
      counterAmount,
    });
  } catch (err) {
    console.error("Could not update business metrics", err.message);
    return;
  }

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

function sendGauge(metricName, value) {
  const payload = `${METRICS_PREFIX}.${metricName}:${value}|g`;
  const message = Buffer.from(payload);

  socket.send(message, METRICS_PORT, METRICS_HOST, (err) => {
    if (err) {
      console.error("Could not send metric", metricName, err.message);
    }
  });
}
