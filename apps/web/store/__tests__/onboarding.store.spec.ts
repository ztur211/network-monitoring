/**
 * Unit tests for onboarding.store — the Zustand slice that drives the
 * AI-assisted onboarding wizard.
 *
 * Tracks: wizardOpen, currentStep, progress, transcript[], chips, fields,
 *         submitting, complete, dismissedForSession, error.
 *
 * Actions: openWizard, closeWizard, dismissForSession (POST /onboarding/skip),
 *          sendTurn (POST /onboarding/turn).
 *
 * Mocks `axios` end-of-pipeline and the localStorage-bound browser device id
 * so the store exercises its real call chain without a network round trip.
 */
import { OnboardingTurnResponse } from '@nodescope/shared';

const jestEsm = jest as typeof jest & {
  unstable_mockModule: (moduleName: string, factory: () => unknown) => void;
};

const mockPost = jest.fn();
const MOCK_BROWSER_DEVICE_ID = 'mock-browser-device-id-1234';

jestEsm.unstable_mockModule('axios', () => ({
  default: {
    create: jest.fn(() => ({
      post: mockPost,
      interceptors: { response: { use: jest.fn() } },
    })),
    isAxiosError: jest.fn(() => false),
  },
}));

// browser-device-id reads from localStorage. We seed a known UUID in
// beforeEach (via a fake Storage) so every sendTurn POST carries a
// predictable browserDeviceId without having to mock the module itself —
// jest.unstable_mockModule + relative paths don't compose well in ts-jest
// ESM mode, but localStorage seeding is just as deterministic.

class FakeLocalStorage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const { useOnboardingStore } = await import('../onboarding.store');

function welcomeResponse(): OnboardingTurnResponse {
  return {
    stepId: 'welcome',
    botMessage: 'Hi! Let’s set up your network.',
    chips: [{ label: 'Get started', value: 'start' }],
    fields: [],
    progress: {},
    complete: false,
  };
}

function networkNameResponse(): OnboardingTurnResponse {
  return {
    stepId: 'networkName',
    botMessage: 'What would you like to call this network?',
    chips: [],
    fields: [{ key: 'networkName', kind: 'text', label: 'Network name', required: true }],
    progress: {},
    complete: false,
  };
}

function doneResponse(): OnboardingTurnResponse {
  return {
    stepId: 'done',
    botMessage: 'All set!',
    chips: [],
    fields: [],
    progress: { networkName: 'Home' },
    complete: true,
  };
}

function resetStore(): void {
  useOnboardingStore.setState({
    wizardOpen: false,
    currentStep: null,
    progress: {},
    transcript: [],
    chips: [],
    fields: [],
    submitting: false,
    complete: false,
    dismissedForSession: false,
    error: null,
  });
}

describe('onboarding.store', () => {
  beforeEach(() => {
    const fake = new FakeLocalStorage();
    fake.setItem('nodescope.browserDeviceId', MOCK_BROWSER_DEVICE_ID);
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      fake as unknown as Storage;
    mockPost.mockReset();
    resetStore();
  });

  describe('openWizard / closeWizard', () => {
    it('openWizard sets wizardOpen=true', () => {
      useOnboardingStore.getState().openWizard();
      expect(useOnboardingStore.getState().wizardOpen).toBe(true);
    });

    it('closeWizard sets wizardOpen=false without touching dismissedForSession', () => {
      useOnboardingStore.setState({ wizardOpen: true, dismissedForSession: false });
      useOnboardingStore.getState().closeWizard();
      const state = useOnboardingStore.getState();
      expect(state.wizardOpen).toBe(false);
      expect(state.dismissedForSession).toBe(false);
    });
  });

  describe('dismissForSession', () => {
    it('posts to /onboarding/skip, closes the wizard, and sets dismissedForSession', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true, data: null } });
      useOnboardingStore.setState({ wizardOpen: true });

      await useOnboardingStore.getState().dismissForSession();

      expect(mockPost).toHaveBeenCalledWith('/onboarding/skip');
      const state = useOnboardingStore.getState();
      expect(state.wizardOpen).toBe(false);
      expect(state.dismissedForSession).toBe(true);
    });

    it('still flips local state even if the skip POST fails (best-effort)', async () => {
      mockPost.mockRejectedValueOnce(new Error('network down'));
      useOnboardingStore.setState({ wizardOpen: true });

      await useOnboardingStore.getState().dismissForSession();

      const state = useOnboardingStore.getState();
      expect(state.wizardOpen).toBe(false);
      expect(state.dismissedForSession).toBe(true);
    });
  });

  describe('sendTurn', () => {
    it('posts the request to /onboarding/turn and folds the response into the store', async () => {
      const resp = networkNameResponse();
      mockPost.mockResolvedValueOnce({ data: { success: true, data: resp } });

      await useOnboardingStore
        .getState()
        .sendTurn({ chipChoice: 'start' });

      expect(mockPost).toHaveBeenCalledWith('/onboarding/turn', {
        browserDeviceId: MOCK_BROWSER_DEVICE_ID,
        chipChoice: 'start',
      });
      const state = useOnboardingStore.getState();
      expect(state.currentStep).toBe('networkName');
      expect(state.chips).toEqual(resp.chips);
      expect(state.fields).toEqual(resp.fields);
      expect(state.progress).toEqual(resp.progress);
      expect(state.complete).toBe(false);
      expect(state.submitting).toBe(false);
      expect(state.error).toBeNull();
    });

    it('appends a user bubble to the transcript when userMessage is supplied', async () => {
      mockPost.mockResolvedValueOnce({
        data: { success: true, data: networkNameResponse() },
      });

      await useOnboardingStore.getState().sendTurn({ userMessage: 'hi there' });
      const transcript = useOnboardingStore.getState().transcript;

      expect(transcript).toHaveLength(2);
      expect(transcript[0]).toMatchObject({ role: 'user', content: 'hi there' });
      expect(transcript[1]).toMatchObject({
        role: 'bot',
        content: networkNameResponse().botMessage,
      });
    });

    it('appends a user bubble to the transcript when chipChoice is supplied', async () => {
      mockPost.mockResolvedValueOnce({
        data: { success: true, data: networkNameResponse() },
      });

      await useOnboardingStore.getState().sendTurn({ chipChoice: 'start' });
      const transcript = useOnboardingStore.getState().transcript;

      expect(transcript).toHaveLength(2);
      expect(transcript[0]).toMatchObject({ role: 'user', content: 'start' });
    });

    it('does NOT append a user bubble for an empty request (initial welcome turn)', async () => {
      mockPost.mockResolvedValueOnce({
        data: { success: true, data: welcomeResponse() },
      });

      await useOnboardingStore.getState().sendTurn({});
      const transcript = useOnboardingStore.getState().transcript;

      expect(transcript).toHaveLength(1);
      expect(transcript[0]).toMatchObject({ role: 'bot' });
    });

    it('always includes browserDeviceId in the POST body — even on the initial welcome turn', async () => {
      // Regression: the backend OnboardingTurnDto requires browserDeviceId
      // (string, MinLength 1). The store must inject it on every call, not
      // only when the caller supplies it. The smoke on 2026-05-21 caught the
      // welcome-turn 400 when this wasn't sent.
      mockPost.mockResolvedValueOnce({
        data: { success: true, data: welcomeResponse() },
      });

      await useOnboardingStore.getState().sendTurn({});

      expect(mockPost).toHaveBeenCalledWith('/onboarding/turn', {
        browserDeviceId: MOCK_BROWSER_DEVICE_ID,
      });
    });

    it('appends a user bubble derived from fieldValues when no userMessage/chipChoice', async () => {
      mockPost.mockResolvedValueOnce({
        data: { success: true, data: networkNameResponse() },
      });

      await useOnboardingStore
        .getState()
        .sendTurn({ fieldValues: { networkName: 'Home' } });

      const transcript = useOnboardingStore.getState().transcript;
      expect(transcript).toHaveLength(2);
      expect(transcript[0].role).toBe('user');
      expect(transcript[0].content).toContain('Home');
    });

    it('flips submitting true during the call and false after', async () => {
      let snapshotMidFlight: boolean | undefined;
      mockPost.mockImplementationOnce(() => {
        snapshotMidFlight = useOnboardingStore.getState().submitting;
        return Promise.resolve({
          data: { success: true, data: networkNameResponse() },
        });
      });

      await useOnboardingStore.getState().sendTurn({});

      expect(snapshotMidFlight).toBe(true);
      expect(useOnboardingStore.getState().submitting).toBe(false);
    });

    it('is a no-op while a previous turn is in flight', async () => {
      mockPost.mockReturnValueOnce(
        new Promise((resolve) => {
          setTimeout(
            () => resolve({ data: { success: true, data: welcomeResponse() } }),
            5,
          );
        }),
      );

      const first = useOnboardingStore.getState().sendTurn({});
      await useOnboardingStore.getState().sendTurn({ userMessage: 'noop' });
      await first;

      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    it('sets complete=true when the response says complete', async () => {
      mockPost.mockResolvedValueOnce({
        data: { success: true, data: doneResponse() },
      });

      await useOnboardingStore.getState().sendTurn({});

      expect(useOnboardingStore.getState().complete).toBe(true);
    });

    it('records error and leaves submitting false on failure', async () => {
      mockPost.mockRejectedValueOnce(new Error('boom'));

      await useOnboardingStore.getState().sendTurn({ userMessage: 'hello' });

      const state = useOnboardingStore.getState();
      expect(state.submitting).toBe(false);
      expect(state.error).toBe('Failed to send message');
      // User bubble should still be visible — only the bot's response is missing.
      expect(state.transcript).toHaveLength(1);
      expect(state.transcript[0].role).toBe('user');
    });

    it('closes the wizard and marks complete on a 409 ONBOARD_002 instead of looping Retry', async () => {
      // A finished user whose wizard re-opened (or a stale tab) gets ONBOARD_002.
      // The store must close the wizard rather than surface a Retry that re-POSTs
      // the same conflict forever.
      mockPost.mockRejectedValueOnce({
        response: { status: 409, data: { error: { code: 'ONBOARD_002' } } },
      });
      useOnboardingStore.setState({ wizardOpen: true });

      await useOnboardingStore.getState().sendTurn({ chipChoice: 'start' });

      const state = useOnboardingStore.getState();
      expect(state.wizardOpen).toBe(false);
      expect(state.complete).toBe(true);
      expect(state.error).toBeNull();
      expect(state.submitting).toBe(false);
    });
  });
});
