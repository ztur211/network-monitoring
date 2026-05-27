import { OnboardingProgress } from '@nodescope/shared';
import {
  handleStep,
  OnboardingInput,
  renderStep,
} from '../onboarding.state-machine';

const initial: OnboardingProgress = {};

describe('renderStep', () => {
  it('welcome step exposes a single chip and no fields', () => {
    const r = renderStep('welcome');
    expect(r.chips.map((c) => c.value)).toEqual(['start']);
    expect(r.fields).toEqual([]);
  });

  it('mobility step exposes three chips (HOME_ONLY / ROAMS / UNKNOWN)', () => {
    const r = renderStep('mobility');
    expect(r.chips.map((c) => c.value).sort()).toEqual(['HOME_ONLY', 'ROAMS', 'UNKNOWN']);
  });

  it('routerMac step exposes a Skip chip and both name + macAddress fields', () => {
    const r = renderStep('routerMac');
    expect(r.chips.some((c) => c.value === 'skip')).toBe(true);
    expect(r.fields.map((f) => f.key).sort()).toEqual(['macAddress', 'name']);
  });

  it('routerMac marks `name` required so the wizard Send button gates on it; macAddress stays optional', () => {
    const r = renderStep('routerMac');
    expect(r.fields.find((f) => f.key === 'name')?.required).toBe(true);
    expect(r.fields.find((f) => f.key === 'macAddress')?.required).not.toBe(true);
  });

  it('modemMac marks `name` required and `macAddress` optional', () => {
    const r = renderStep('modemMac');
    expect(r.fields.find((f) => f.key === 'name')?.required).toBe(true);
    expect(r.fields.find((f) => f.key === 'macAddress')?.required).not.toBe(true);
  });
});

describe('handleStep: welcome → networkName', () => {
  it('transitions to networkName regardless of input', () => {
    const r = handleStep('welcome', initial, { kind: 'init' });
    expect(r.nextStepId).toBe('networkName');
    expect(r.sideEffects).toEqual([]);
  });
});

describe('handleStep: networkName', () => {
  it('advances to address when name provided, no side effects yet', () => {
    const r = handleStep('networkName', initial, {
      kind: 'fields',
      values: { name: 'Home' },
    });
    expect(r.nextStepId).toBe('address');
    expect(r.progress.networkName).toBe('Home');
    expect(r.sideEffects).toEqual([]);
  });

  it('stays on the same step when name is empty', () => {
    const r = handleStep('networkName', initial, {
      kind: 'fields',
      values: { name: '  ' },
    });
    expect(r.nextStepId).toBe('networkName');
  });
});

describe('handleStep: address', () => {
  it('skip chip persists SaveNetwork without address and advances', () => {
    const r = handleStep('address', { networkName: 'Home' }, { kind: 'chip', value: 'skip' });
    expect(r.nextStepId).toBe('browserDeviceName');
    expect(r.sideEffects).toEqual([
      { type: 'SaveNetwork', payload: { name: 'Home' } },
    ]);
  });

  it('address entry persists SaveNetwork with address + GeocodeAddress', () => {
    const r = handleStep('address', { networkName: 'Home' }, {
      kind: 'fields',
      values: { address: '1 Main St' },
    });
    expect(r.nextStepId).toBe('browserDeviceName');
    expect(r.progress.homeAddress).toBe('1 Main St');
    expect(r.sideEffects.find((s) => s.type === 'SaveNetwork')?.payload).toMatchObject({
      name: 'Home',
      homeAddress: '1 Main St',
    });
    expect(r.sideEffects.find((s) => s.type === 'GeocodeAddress')?.payload).toEqual({
      address: '1 Main St',
    });
  });
});

describe('handleStep: browserDeviceName', () => {
  it('stores name and advances', () => {
    const r = handleStep('browserDeviceName', { networkName: 'Home' }, {
      kind: 'fields',
      values: { name: 'My Laptop' },
    });
    expect(r.nextStepId).toBe('mobility');
    expect(r.progress.browserDeviceName).toBe('My Laptop');
  });
});

describe('handleStep: mobility', () => {
  const progress = { networkName: 'Home', browserDeviceName: 'Laptop' };

  it('HOME_ONLY emits SaveBrowserDevice and advances', () => {
    const r = handleStep('mobility', progress, { kind: 'chip', value: 'HOME_ONLY' });
    expect(r.nextStepId).toBe('confirmHomeIp');
    expect(r.sideEffects).toEqual([
      { type: 'SaveBrowserDevice', payload: { name: 'Laptop', mobility: 'HOME_ONLY' } },
    ]);
    expect(r.progress.mobility).toBe('HOME_ONLY');
  });

  it('ROAMS emits SaveBrowserDevice with mobility=ROAMS', () => {
    const r = handleStep('mobility', progress, { kind: 'chip', value: 'ROAMS' });
    expect(r.sideEffects[0]).toMatchObject({ payload: { mobility: 'ROAMS' } });
  });

  it('UNKNOWN chip is accepted', () => {
    const r = handleStep('mobility', progress, { kind: 'chip', value: 'UNKNOWN' });
    expect(r.progress.mobility).toBe('UNKNOWN');
  });

  it('rejects unknown chip values and stays on step', () => {
    const r = handleStep('mobility', progress, { kind: 'chip', value: 'something' });
    expect(r.nextStepId).toBe('mobility');
    expect(r.sideEffects).toEqual([]);
  });
});

describe('handleStep: confirmHomeIp', () => {
  it("'yes' emits SaveHomeIp with sentinel and advances", () => {
    const r = handleStep('confirmHomeIp', {}, { kind: 'chip', value: 'yes' });
    expect(r.nextStepId).toBe('routerMac');
    expect(r.sideEffects).toEqual([
      { type: 'SaveHomeIp', payload: { ip: 'CURRENT_REQUEST' } },
    ]);
  });

  it("'no' advances without SaveHomeIp", () => {
    const r = handleStep('confirmHomeIp', {}, { kind: 'chip', value: 'no' });
    expect(r.nextStepId).toBe('routerMac');
    expect(r.sideEffects).toEqual([]);
  });
});

describe('handleStep: routerMac', () => {
  it('skip chip advances to modemMac with no side effects', () => {
    const r = handleStep('routerMac', {}, { kind: 'chip', value: 'skip' });
    expect(r.nextStepId).toBe('modemMac');
    expect(r.sideEffects).toEqual([]);
  });

  it('full mac + name emits SaveRouterDevice', () => {
    const r = handleStep('routerMac', {}, {
      kind: 'fields',
      values: { name: 'Router', macAddress: 'AA:BB:CC:DD:EE:FF' },
    });
    expect(r.nextStepId).toBe('modemMac');
    expect(r.sideEffects).toEqual([
      { type: 'SaveRouterDevice', payload: { name: 'Router', macAddress: 'AA:BB:CC:DD:EE:FF' } },
    ]);
  });

  it('name only (MAC blank) advances to modemMac and saves device with undefined macAddress', () => {
    const r = handleStep('routerMac', {}, { kind: 'fields', values: { name: 'Router' } });
    expect(r.nextStepId).toBe('modemMac');
    expect(r.sideEffects).toEqual([
      { type: 'SaveRouterDevice', payload: { name: 'Router', macAddress: undefined } },
    ]);
  });

  it('missing name (only MAC) stays on step — name is the only required field', () => {
    const r = handleStep('routerMac', {}, {
      kind: 'fields',
      values: { macAddress: 'AA:BB:CC:DD:EE:FF' },
    });
    expect(r.nextStepId).toBe('routerMac');
    expect(r.sideEffects).toEqual([]);
  });
});

describe('handleStep: modemMac', () => {
  it('skip advances to isp', () => {
    const r = handleStep('modemMac', {}, { kind: 'chip', value: 'skip' });
    expect(r.nextStepId).toBe('isp');
  });

  it('full input emits SaveModemDevice', () => {
    const r = handleStep('modemMac', {}, {
      kind: 'fields',
      values: { name: 'Modem', macAddress: '11:22:33:44:55:66' },
    });
    expect(r.sideEffects[0].type).toBe('SaveModemDevice');
  });

  it('name only (MAC blank) advances to isp and saves device with undefined macAddress', () => {
    const r = handleStep('modemMac', {}, { kind: 'fields', values: { name: 'Modem' } });
    expect(r.nextStepId).toBe('isp');
    expect(r.sideEffects).toEqual([
      { type: 'SaveModemDevice', payload: { name: 'Modem', macAddress: undefined } },
    ]);
  });

  it('missing name (only MAC) stays on step', () => {
    const r = handleStep('modemMac', {}, {
      kind: 'fields',
      values: { macAddress: '11:22:33:44:55:66' },
    });
    expect(r.nextStepId).toBe('modemMac');
    expect(r.sideEffects).toEqual([]);
  });
});

describe('handleStep: isp', () => {
  it('skip advances to speeds without modifying progress.isp', () => {
    const r = handleStep('isp', {}, { kind: 'chip', value: 'skip' });
    expect(r.nextStepId).toBe('speeds');
    expect(r.progress.isp).toBeUndefined();
  });

  it('field input stores isp and advances', () => {
    const r = handleStep('isp', {}, { kind: 'fields', values: { isp: 'Comcast' } });
    expect(r.progress.isp).toBe('Comcast');
    expect(r.nextStepId).toBe('speeds');
  });
});

describe('handleStep: speeds', () => {
  it('skip advances to done and marks complete', () => {
    const r = handleStep('speeds', {}, { kind: 'chip', value: 'skip' });
    expect(r.nextStepId).toBe('done');
    expect(r.complete).toBe(true);
  });

  it('numeric fields store down/up Mbps and complete', () => {
    const r = handleStep('speeds', {}, {
      kind: 'fields',
      values: { downMbps: 940, upMbps: 35 },
    });
    expect(r.progress.downMbps).toBe(940);
    expect(r.progress.upMbps).toBe(35);
    expect(r.complete).toBe(true);
  });

  it('string-numeric fields are coerced', () => {
    const r = handleStep('speeds', {}, {
      kind: 'fields',
      values: { downMbps: '500', upMbps: '50' },
    });
    expect(r.progress.downMbps).toBe(500);
    expect(r.progress.upMbps).toBe(50);
  });
});

describe('handleStep: done', () => {
  it('returns complete=true and no transitions out', () => {
    const r = handleStep('done', { networkName: 'Home' }, { kind: 'chip', value: 'close' });
    expect(r.nextStepId).toBe('done');
    expect(r.complete).toBe(true);
  });
});

describe('full happy-path traversal', () => {
  it('produces SaveNetwork + SaveBrowserDevice + SaveHomeIp side effects across the flow', () => {
    let progress: OnboardingProgress = {};
    const allSideEffects: { type: string }[] = [];

    const steps: Array<[OnboardingInput, string]> = [
      [{ kind: 'init' }, 'networkName'],
      [{ kind: 'fields', values: { name: 'Home' } }, 'address'],
      [{ kind: 'fields', values: { address: '1 Main St' } }, 'browserDeviceName'],
      [{ kind: 'fields', values: { name: 'Laptop' } }, 'mobility'],
      [{ kind: 'chip', value: 'HOME_ONLY' }, 'confirmHomeIp'],
      [{ kind: 'chip', value: 'yes' }, 'routerMac'],
      [{ kind: 'chip', value: 'skip' }, 'modemMac'],
      [{ kind: 'chip', value: 'skip' }, 'isp'],
      [{ kind: 'chip', value: 'skip' }, 'speeds'],
      [{ kind: 'chip', value: 'skip' }, 'done'],
    ];

    let stepId: 'welcome' | string = 'welcome';
    for (const [input, expected] of steps) {
      const r = handleStep(stepId as any, progress, input);
      expect(r.nextStepId).toBe(expected);
      progress = r.progress;
      allSideEffects.push(...r.sideEffects);
      stepId = r.nextStepId;
    }

    expect(allSideEffects.map((s) => s.type)).toEqual([
      'SaveNetwork',
      'GeocodeAddress',
      'SaveBrowserDevice',
      'SaveHomeIp',
    ]);
  });
});
