-- Keep the database enum aligned with the first-class GENERAL job family.
ALTER TYPE "Industry" ADD VALUE IF NOT EXISTS 'GENERAL';
