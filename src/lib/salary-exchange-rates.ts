import {
  FALLBACK_SALARY_EXCHANGE_RATES,
  SALARY_COMPARISON_CURRENCIES,
  type SalaryComparisonCurrency,
  type SalaryExchangeRates,
} from "@/lib/currency-conversion";

const DEFAULT_EXCHANGE_RATE_URL = "https://open.er-api.com/v6/latest/USD";
const DEFAULT_CACHE_MS = 12 * 60 * 60 * 1000;
const FAILURE_CACHE_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1_500;

let cachedRates: { expiresAt: number; rates: SalaryExchangeRates } | null = null;

function getCacheMs() {
  const raw = Number(process.env.SALARY_EXCHANGE_RATE_CACHE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CACHE_MS;
}

function getExchangeRateUrl() {
  return process.env.SALARY_EXCHANGE_RATE_URL || DEFAULT_EXCHANGE_RATE_URL;
}

function parseUsdRatePayload(payload: unknown): SalaryExchangeRates | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as {
    base_code?: unknown;
    result?: unknown;
    rates?: Record<string, unknown>;
  };
  if (record.result && record.result !== "success") return null;
  if (record.base_code && record.base_code !== "USD") return null;
  if (!record.rates || typeof record.rates !== "object") return null;

  const rates = { ...FALLBACK_SALARY_EXCHANGE_RATES };
  for (const currency of SALARY_COMPARISON_CURRENCIES) {
    if (currency === "USD") {
      rates.USD = 1;
      continue;
    }

    const unitsPerUsd = Number(record.rates[currency]);
    if (!Number.isFinite(unitsPerUsd) || unitsPerUsd <= 0) {
      return null;
    }
    rates[currency as SalaryComparisonCurrency] = 1 / unitsPerUsd;
  }

  return rates;
}

export async function loadSalaryExchangeRates(): Promise<SalaryExchangeRates> {
  const now = Date.now();
  if (cachedRates && cachedRates.expiresAt > now) {
    return cachedRates.rates;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(getExchangeRateUrl(), {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Exchange rate request failed with ${response.status}`);
    }

    const parsed = parseUsdRatePayload(await response.json());
    if (!parsed) {
      throw new Error("Exchange rate payload was missing supported currencies");
    }

    cachedRates = { expiresAt: now + getCacheMs(), rates: parsed };
    return parsed;
  } catch {
    cachedRates = {
      expiresAt: now + FAILURE_CACHE_MS,
      rates: FALLBACK_SALARY_EXCHANGE_RATES,
    };
    return FALLBACK_SALARY_EXCHANGE_RATES;
  } finally {
    clearTimeout(timeout);
  }
}
