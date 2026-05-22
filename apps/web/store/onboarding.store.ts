import { create } from 'zustand';
import {
  OnboardingChip,
  OnboardingField,
  OnboardingProgress,
  OnboardingStepId,
  OnboardingTurnRequest,
  OnboardingTurnResponse,
} from '@nodescope/shared';
import { api } from '../lib/api.service';

export interface OnboardingMessage {
  id: string;
  role: 'user' | 'bot';
  content: string;
  timestamp: string;
}

interface OnboardingStore {
  wizardOpen: boolean;
  currentStep: OnboardingStepId | null;
  progress: OnboardingProgress;
  transcript: OnboardingMessage[];
  chips: OnboardingChip[];
  fields: OnboardingField[];
  submitting: boolean;
  complete: boolean;
  dismissedForSession: boolean;
  error: string | null;

  openWizard: () => void;
  closeWizard: () => void;
  dismissForSession: () => Promise<void>;
  sendTurn: (request: OnboardingTurnRequest) => Promise<void>;
}

function msgId(): string {
  return `onb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function userMessageContent(request: OnboardingTurnRequest): string | null {
  if (request.userMessage && request.userMessage.length > 0) return request.userMessage;
  if (request.chipChoice && request.chipChoice.length > 0) return request.chipChoice;
  if (request.fieldValues && Object.keys(request.fieldValues).length > 0) {
    return Object.values(request.fieldValues)
      .map((v) => String(v))
      .join(', ');
  }
  return null;
}

export const useOnboardingStore = create<OnboardingStore>((set, get) => ({
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

  openWizard: () => set({ wizardOpen: true }),

  closeWizard: () => set({ wizardOpen: false }),

  dismissForSession: async () => {
    try {
      await api.post('/onboarding/skip');
    } catch {
      // Best-effort — still flip local state so the user isn't re-prompted
      // this session. The server-side 30-day flag will catch up later.
    }
    set({ wizardOpen: false, dismissedForSession: true });
  },

  sendTurn: async (request) => {
    if (get().submitting) return;

    const userContent = userMessageContent(request);
    set((state) => ({
      submitting: true,
      error: null,
      transcript: userContent
        ? [
            ...state.transcript,
            {
              id: msgId(),
              role: 'user',
              content: userContent,
              timestamp: new Date().toISOString(),
            },
          ]
        : state.transcript,
    }));

    try {
      const res = await api.post<{ success: true; data: OnboardingTurnResponse }>(
        '/onboarding/turn',
        request,
      );
      const data = res.data.data;
      set((state) => ({
        currentStep: data.stepId,
        progress: data.progress,
        chips: data.chips,
        fields: data.fields,
        complete: data.complete,
        submitting: false,
        transcript: [
          ...state.transcript,
          {
            id: msgId(),
            role: 'bot',
            content: data.botMessage,
            timestamp: new Date().toISOString(),
          },
        ],
      }));
    } catch {
      set({ submitting: false, error: 'Failed to send message' });
    }
  },
}));
