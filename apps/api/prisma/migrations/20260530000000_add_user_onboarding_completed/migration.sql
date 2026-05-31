-- Durable onboarding-completion marker. Replaces reliance on the short-lived
-- Redis wizard-state key for "has this user finished onboarding?". Additive and
-- nullable — existing users are treated as not-yet-completed (NULL), which is
-- correct (the wizard re-opens for anyone without a Network anyway).
ALTER TABLE "User" ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);
