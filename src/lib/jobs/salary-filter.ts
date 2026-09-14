type SalaryWhere = {
  salaryMin?: null | { gte?: number; lte?: number };
  salaryMax?: null | { gte?: number; lte?: number };
  salaryCurrency?: string | null | { notIn: string[] };
  AND?: SalaryWhere[];
  OR?: SalaryWhere[];
};
import {
  convertSalaryAmount,
  SALARY_COMPARISON_CURRENCIES,
  type SalaryComparisonCurrency,
  type SalaryExchangeRates,
} from "@/lib/currency-conversion";

// Both read models store annualized bounds. Unknown currency is not USD.
function buildNumericSalaryRangeWhere(
  salaryMin: number | undefined,
  salaryMax: number | undefined,
): SalaryWhere | null {
  const clauses: SalaryWhere[] = [];

  if (salaryMin) {
    clauses.push({
      OR: [
        { salaryMax: { gte: salaryMin } },
        { salaryMin: { gte: salaryMin } },
      ],
    });
  }

  if (salaryMax) {
    clauses.push({
      OR: [
        { salaryMin: { lte: salaryMax } },
        {
          AND: [{ salaryMin: null }, { salaryMax: { lte: salaryMax } }],
        },
      ],
    });
  }

  if (clauses.length === 0) return null;
  return clauses.length === 1 ? clauses[0] : { AND: clauses };
}

export function buildSalaryRangeWhere(
  salaryMin: number | undefined,
  salaryMax: number | undefined,
  comparisonCurrency: SalaryComparisonCurrency,
  exchangeRates: SalaryExchangeRates,
  includeUnknownSalary: boolean = false,
): SalaryWhere | null {
  if (!salaryMin && !salaryMax) return null;

  const clauses: SalaryWhere[] = [];

  for (const jobCurrency of SALARY_COMPARISON_CURRENCIES) {
    const convertedMin =
      salaryMin != null
        ? (convertSalaryAmount(
            salaryMin,
            comparisonCurrency,
            jobCurrency,
            exchangeRates,
          ) ?? undefined)
        : undefined;
    const convertedMax =
      salaryMax != null
        ? (convertSalaryAmount(
            salaryMax,
            comparisonCurrency,
            jobCurrency,
            exchangeRates,
          ) ?? undefined)
        : undefined;
    const rangeWhere = buildNumericSalaryRangeWhere(convertedMin, convertedMax);
    if (!rangeWhere) continue;

    clauses.push({
      AND: [{ salaryCurrency: jobCurrency }, rangeWhere],
    });
  }

  if (clauses.length === 0) return null;
  const salaryWhere = clauses.length === 1 ? clauses[0] : { OR: clauses };

  if (!includeUnknownSalary) return salaryWhere;

  return {
    OR: [
      salaryWhere,
      { salaryCurrency: null },
      { salaryCurrency: { notIn: [...SALARY_COMPARISON_CURRENCIES] } },
      {
        AND: [{ salaryMin: null }, { salaryMax: null }],
      },
    ],
  };
}
