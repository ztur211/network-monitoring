export type RuleScope =
  | { all: true }
  | { deviceIds: string[] }
  | { networkIds: string[] }
  | { siteIds: string[] };
