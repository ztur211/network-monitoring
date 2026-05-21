import {
  OnboardingChip,
  OnboardingField,
  OnboardingProgress,
  OnboardingStepId,
} from '@nodescope/shared';

export type OnboardingSideEffect =
  | { type: 'SaveNetwork'; payload: SaveNetworkPayload }
  | { type: 'SaveBrowserDevice'; payload: SaveBrowserDevicePayload }
  | { type: 'SaveRouterDevice'; payload: SaveDevicePayload }
  | { type: 'SaveModemDevice'; payload: SaveDevicePayload }
  | { type: 'SaveHomeIp'; payload: { ip: string } }
  | { type: 'GeocodeAddress'; payload: { address: string } };

export interface SaveNetworkPayload {
  name: string;
  homeAddress?: string;
  homeLatitude?: number;
  homeLongitude?: number;
  isp?: string;
  downMbps?: number;
  upMbps?: number;
}

export interface SaveBrowserDevicePayload {
  name: string;
  mobility: 'HOME_ONLY' | 'ROAMS' | 'UNKNOWN';
}

export interface SaveDevicePayload {
  name: string;
  macAddress: string;
}

export type OnboardingInput =
  | { kind: 'init' }
  | { kind: 'chip'; value: string }
  | { kind: 'fields'; values: Record<string, string | number> };

export interface StepRender {
  chips: OnboardingChip[];
  fields: OnboardingField[];
}

export interface StepResult {
  nextStepId: OnboardingStepId;
  progress: OnboardingProgress;
  sideEffects: OnboardingSideEffect[];
  complete: boolean;
}

const SKIP_CHIP: OnboardingChip = { label: 'Skip', value: 'skip' };

/**
 * Returns the chips + fields the client should display for a given step. The
 * bot message comes from AiService.generateOnboardingMessage — this function
 * is responsible only for the structural UI.
 */
export function renderStep(stepId: OnboardingStepId): StepRender {
  switch (stepId) {
    case 'welcome':
      return { chips: [{ label: "Let's go", value: 'start' }], fields: [] };
    case 'networkName':
      return {
        chips: [],
        fields: [{ key: 'name', kind: 'text', label: 'Network name', placeholder: 'Home', required: true }],
      };
    case 'address':
      return {
        chips: [SKIP_CHIP],
        fields: [{ key: 'address', kind: 'address', label: 'Home address', required: false }],
      };
    case 'browserDeviceName':
      return {
        chips: [],
        fields: [{ key: 'name', kind: 'text', label: 'Name this browser', placeholder: 'My Laptop', required: true }],
      };
    case 'mobility':
      return {
        chips: [
          { label: 'Home only', value: 'HOME_ONLY' },
          { label: 'I take it places', value: 'ROAMS' },
          { label: 'Not sure', value: 'UNKNOWN' },
        ],
        fields: [],
      };
    case 'confirmHomeIp':
      return {
        chips: [
          { label: 'Yes, this is home', value: 'yes' },
          { label: 'No, skip for now', value: 'no' },
        ],
        fields: [],
      };
    case 'routerMac':
      return {
        chips: [SKIP_CHIP],
        fields: [
          { key: 'name', kind: 'text', label: 'Router name', placeholder: 'Main Router' },
          { key: 'macAddress', kind: 'mac', label: 'Router MAC (optional)' },
        ],
      };
    case 'modemMac':
      return {
        chips: [SKIP_CHIP],
        fields: [
          { key: 'name', kind: 'text', label: 'Modem name', placeholder: 'Modem' },
          { key: 'macAddress', kind: 'mac', label: 'Modem MAC (optional)' },
        ],
      };
    case 'isp':
      return {
        chips: [SKIP_CHIP],
        fields: [{ key: 'isp', kind: 'text', label: 'ISP name', placeholder: 'Comcast' }],
      };
    case 'speeds':
      return {
        chips: [SKIP_CHIP],
        fields: [
          { key: 'downMbps', kind: 'number', label: 'Download Mbps' },
          { key: 'upMbps', kind: 'number', label: 'Upload Mbps' },
        ],
      };
    case 'done':
      return { chips: [{ label: 'Close', value: 'close' }], fields: [] };
  }
}

/**
 * Pure state-transition function. Given the current step + cumulative
 * progress + the user's input, returns the next step plus any side effects
 * that the OnboardingService must enact (DB writes, geocode lookups, etc.).
 *
 * No DB / AI / network access in here — everything is data in, data out, so
 * the full tree of paths can be tested without infrastructure.
 */
export function handleStep(
  stepId: OnboardingStepId,
  progress: OnboardingProgress,
  input: OnboardingInput,
): StepResult {
  switch (stepId) {
    case 'welcome':
      return advance(progress, 'networkName', []);

    case 'networkName': {
      const name = readField(input, 'name');
      if (!name) return stay(progress, stepId);
      return advance({ ...progress, networkName: name }, 'address', []);
    }

    case 'address': {
      if (isSkipChip(input)) {
        return advance(progress, 'browserDeviceName', [
          {
            type: 'SaveNetwork',
            payload: { name: progress.networkName! },
          },
        ]);
      }
      const address = readField(input, 'address');
      if (!address) return stay(progress, stepId);
      return advance(
        { ...progress, homeAddress: address },
        'browserDeviceName',
        [
          {
            type: 'SaveNetwork',
            payload: { name: progress.networkName!, homeAddress: address },
          },
          { type: 'GeocodeAddress', payload: { address } },
        ],
      );
    }

    case 'browserDeviceName': {
      const name = readField(input, 'name');
      if (!name) return stay(progress, stepId);
      return advance({ ...progress, browserDeviceName: name }, 'mobility', []);
    }

    case 'mobility': {
      if (input.kind !== 'chip') return stay(progress, stepId);
      const mobility = input.value as 'HOME_ONLY' | 'ROAMS' | 'UNKNOWN';
      if (!['HOME_ONLY', 'ROAMS', 'UNKNOWN'].includes(mobility)) {
        return stay(progress, stepId);
      }
      return advance({ ...progress, mobility }, 'confirmHomeIp', [
        {
          type: 'SaveBrowserDevice',
          payload: { name: progress.browserDeviceName!, mobility },
        },
      ]);
    }

    case 'confirmHomeIp': {
      if (input.kind !== 'chip') return stay(progress, stepId);
      if (input.value === 'yes') {
        return advance(progress, 'routerMac', [
          { type: 'SaveHomeIp', payload: { ip: 'CURRENT_REQUEST' } },
        ]);
      }
      return advance(progress, 'routerMac', []);
    }

    case 'routerMac': {
      if (isSkipChip(input)) return advance(progress, 'modemMac', []);
      const name = readField(input, 'name');
      const macAddress = readField(input, 'macAddress');
      if (!name || !macAddress) return stay(progress, stepId);
      return advance(
        { ...progress, routerMac: macAddress },
        'modemMac',
        [{ type: 'SaveRouterDevice', payload: { name, macAddress } }],
      );
    }

    case 'modemMac': {
      if (isSkipChip(input)) return advance(progress, 'isp', []);
      const name = readField(input, 'name');
      const macAddress = readField(input, 'macAddress');
      if (!name || !macAddress) return stay(progress, stepId);
      return advance(
        { ...progress, modemMac: macAddress },
        'isp',
        [{ type: 'SaveModemDevice', payload: { name, macAddress } }],
      );
    }

    case 'isp': {
      if (isSkipChip(input)) return advance(progress, 'speeds', []);
      const isp = readField(input, 'isp');
      if (!isp) return stay(progress, stepId);
      return advance({ ...progress, isp }, 'speeds', []);
    }

    case 'speeds': {
      if (isSkipChip(input)) {
        return advance(progress, 'done', [], true);
      }
      const downMbps = readNumberField(input, 'downMbps');
      const upMbps = readNumberField(input, 'upMbps');
      if (downMbps === undefined && upMbps === undefined) {
        return stay(progress, stepId);
      }
      return advance(
        { ...progress, downMbps, upMbps },
        'done',
        [],
        true,
      );
    }

    case 'done':
      return { nextStepId: 'done', progress, sideEffects: [], complete: true };
  }
}

function advance(
  progress: OnboardingProgress,
  nextStepId: OnboardingStepId,
  sideEffects: OnboardingSideEffect[],
  complete = false,
): StepResult {
  return { nextStepId, progress, sideEffects, complete };
}

function stay(progress: OnboardingProgress, stepId: OnboardingStepId): StepResult {
  return { nextStepId: stepId, progress, sideEffects: [], complete: false };
}

function readField(input: OnboardingInput, key: string): string | undefined {
  if (input.kind !== 'fields') return undefined;
  const raw = input.values[key];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumberField(input: OnboardingInput, key: string): number | undefined {
  if (input.kind !== 'fields') return undefined;
  const raw = input.values[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function isSkipChip(input: OnboardingInput): boolean {
  return input.kind === 'chip' && input.value === 'skip';
}
