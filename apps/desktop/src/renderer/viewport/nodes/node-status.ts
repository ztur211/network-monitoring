// The display side of the Monitoring boundary (Spec 4 §9). Spec 4 ships only this
// type + colour map and the `unknown` default; the Monitoring spec populates the
// store's nodeStatus map (initial fetch + a realtime status event), and these
// markers/badges/filters light up live with no redesign.
export type NodeStatus = 'up' | 'down' | 'warning' | 'unknown';

export const STATUS_COLOR: Record<NodeStatus, number> = {
  up: 0x35c46a,
  down: 0xe5484d,
  warning: 0xf5a623,
  unknown: 0x8a8f98,
};
