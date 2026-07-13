export type FrontierWindow = {
  offset: number;
  tailTake: number;
  headTake: number;
};

/**
 * Select a stable, bounded slice of a corpus and wrap at its end. Callers can
 * advance rotationSlot each run to cover the entire corpus without preserving
 * a mutable cursor in the database.
 */
export function getCompanyFrontierWindow(
  totalCompanyCount: number,
  companyLimit: number,
  rotationSlot: number
): FrontierWindow {
  if (totalCompanyCount <= 0 || companyLimit <= 0) {
    return { offset: 0, tailTake: 0, headTake: 0 };
  }

  const normalizedSlot = Math.abs(rotationSlot);
  const offset = (normalizedSlot * companyLimit) % totalCompanyCount;
  const tailTake = Math.min(companyLimit, totalCompanyCount - offset);

  return {
    offset,
    tailTake,
    headTake: companyLimit - tailTake,
  };
}
