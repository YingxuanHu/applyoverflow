export const SALARY_COMPARISON_CURRENCIES = [
  "USD",
  "CAD",
  "EUR",
  "GBP",
  "AUD",
  "NZD",
] as const;

export type SalaryComparisonCurrency = (typeof SALARY_COMPARISON_CURRENCIES)[number];
export type SalaryExchangeRates = Record<SalaryComparisonCurrency, number>;

// Salary filters need deterministic conversion at query time. These rates are
// intentionally centralized as the fallback when the live rate provider is
// unavailable.
export const FALLBACK_SALARY_EXCHANGE_RATES: SalaryExchangeRates = {
  USD: 1,
  CAD: 0.724401988,
  EUR: 1.164251427,
  GBP: 1.343297015,
  AUD: 0.71473702,
  NZD: 0.592539571,
};

const CURRENCY_ALIASES: Record<string, SalaryComparisonCurrency> = {
  US: "USD",
  US$: "USD",
  CA: "CAD",
  C$: "CAD",
  CA$: "CAD",
};

export function normalizeSalaryCurrency(
  value: string | null | undefined
): SalaryComparisonCurrency | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) return null;

  const alias = CURRENCY_ALIASES[normalized];
  if (alias) return alias;

  return SALARY_COMPARISON_CURRENCIES.includes(
    normalized as SalaryComparisonCurrency
  )
    ? (normalized as SalaryComparisonCurrency)
    : null;
}

export function convertSalaryAmount(
  amount: number | null | undefined,
  fromCurrency: string | null | undefined,
  toCurrency: string | null | undefined,
  rates: SalaryExchangeRates = FALLBACK_SALARY_EXCHANGE_RATES
) {
  if (amount == null || !Number.isFinite(amount)) return null;

  const from = normalizeSalaryCurrency(fromCurrency);
  const to = normalizeSalaryCurrency(toCurrency);
  if (!from || !to) return null;

  return Math.round((amount * rates[from]) / rates[to]);
}

export function convertSalaryRange(input: {
  salaryMin: number | null | undefined;
  salaryMax: number | null | undefined;
  fromCurrency: string | null | undefined;
  toCurrency: string | null | undefined;
  rates?: SalaryExchangeRates;
}) {
  return {
    salaryMin: convertSalaryAmount(
      input.salaryMin,
      input.fromCurrency,
      input.toCurrency,
      input.rates
    ),
    salaryMax: convertSalaryAmount(
      input.salaryMax,
      input.fromCurrency,
      input.toCurrency,
      input.rates
    ),
  };
}
