-- Adds MULTI_PROPERTY to the AccountTier enum, positioned between PERSONAL_PAID
-- and ENTERPRISE. This was the original 4-tier design per CLAUDE.md but was
-- omitted from the init migration; TierGuard already had the slot reserved at
-- ordering position 2. No existing rows reference MULTI_PROPERTY (it was never
-- assignable), so this is purely additive.
--
-- BEFORE clause is supported on PostgreSQL ≥ 9.5 (we're on 16); it preserves
-- the logical ordering of the enum.
ALTER TYPE "AccountTier" ADD VALUE 'MULTI_PROPERTY' BEFORE 'ENTERPRISE';
