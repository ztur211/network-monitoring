// Onboarding wizard wire types. The state machine lives server-side (the C#
// Inventory module's onboarding slice) — these are just the shape of the
// per-turn request/response.

export type OnboardingStepId =
  | 'welcome'
  | 'networkName'
  | 'address'
  | 'browserDeviceName'
  | 'mobility'
  | 'confirmHomeIp'
  | 'routerMac'
  | 'modemMac'
  | 'isp'
  | 'speeds'
  | 'done';

export type OnboardingFieldKind =
  | 'text'
  | 'mac'
  | 'address'
  | 'number'
  | 'speeds';

export interface OnboardingChip {
  label: string;
  value: string;
}

export interface OnboardingField {
  key: string;
  kind: OnboardingFieldKind;
  label: string;
  placeholder?: string;
  required?: boolean;
}

export interface OnboardingProgress {
  networkName?: string;
  homeAddress?: string;
  homeLatitude?: number;
  homeLongitude?: number;
  browserDeviceName?: string;
  mobility?: 'HOME_ONLY' | 'ROAMS' | 'UNKNOWN';
  homePublicIp?: string;
  routerMac?: string;
  modemMac?: string;
  isp?: string;
  downMbps?: number;
  upMbps?: number;
}

export interface OnboardingTurnRequest {
  userMessage?: string;
  chipChoice?: string;
  fieldValues?: Record<string, string | number>;
}

export interface OnboardingTurnResponse {
  stepId: OnboardingStepId;
  botMessage: string;
  chips: OnboardingChip[];
  fields: OnboardingField[];
  progress: OnboardingProgress;
  complete: boolean;
}
