import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';
import type { OnboardingField } from '@nodescope/shared';
import { useOnboardingStore } from '../../store/onboarding.store';
import { WizardMessage } from './WizardMessage';
import { WizardChip } from './WizardChip';
import { WizardField } from './WizardField';

function sheetHeight(): number {
  return Math.round(Dimensions.get('window').height * 0.6);
}

function fieldsAreReady(fields: OnboardingField[], values: Record<string, string>): boolean {
  return fields.every((f) => !f.required || (values[f.key] && values[f.key].trim().length > 0));
}

function buildFieldPayload(
  fields: OnboardingField[],
  values: Record<string, string>,
): Record<string, string | number> {
  const payload: Record<string, string | number> = {};
  for (const field of fields) {
    const raw = values[field.key];
    if (raw === undefined || raw === '') continue;
    if (field.kind === 'number' || field.kind === 'speeds') {
      const parsed = Number(raw);
      if (!Number.isNaN(parsed)) payload[field.key] = parsed;
    } else {
      payload[field.key] = raw;
    }
  }
  return payload;
}

export function WizardSheet() {
  const {
    wizardOpen,
    transcript,
    chips,
    fields,
    submitting,
    complete,
    error,
    sendTurn,
    dismissForSession,
    closeWizard,
  } = useOnboardingStore();

  const scrollRef = useRef<ScrollView>(null);
  const initialTurnFired = useRef(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  // Fire the initial welcome turn once when the sheet opens with an empty
  // transcript. The store guards against double-submits on its own, but we
  // also pin the ref so React strict-mode double-render doesn't trigger two
  // POSTs back to back.
  useEffect(() => {
    if (!wizardOpen) {
      initialTurnFired.current = false;
      return;
    }
    if (initialTurnFired.current) return;
    if (transcript.length > 0) {
      initialTurnFired.current = true;
      return;
    }
    initialTurnFired.current = true;
    void sendTurn({});
  }, [wizardOpen, transcript.length, sendTurn]);

  // Reset local field state when the step's fields change. The step boundary is
  // determined by the field-key signature — two consecutive steps that ask for
  // the same key (rare) won't clobber, which keeps mid-typing edits safe.
  const fieldSignature = useMemo(() => fields.map((f) => f.key).join('|'), [fields]);
  useEffect(() => {
    setFieldValues({});
  }, [fieldSignature]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [transcript.length]);

  if (!wizardOpen) return null;

  const handleChip = (value: string) => {
    if (submitting) return;
    void sendTurn({ chipChoice: value });
  };

  const handleSendFields = () => {
    if (submitting) return;
    if (!fieldsAreReady(fields, fieldValues)) return;
    const payload = buildFieldPayload(fields, fieldValues);
    void sendTurn({ fieldValues: payload });
  };

  const handleSkip = () => {
    void dismissForSession();
  };

  const handleClose = () => {
    closeWizard();
  };

  const hasFields = fields.length > 0;
  const canSendFields = hasFields && !submitting && fieldsAreReady(fields, fieldValues);
  const isInitialLoading = submitting && transcript.length === 0;

  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-0 justify-end"
      style={{ zIndex: 50 }}
    >
      {/* Scrim — tap-through disabled so the user can't accidentally pierce
          the sheet by tapping its background. */}
      <View className="absolute inset-0 bg-black/30" />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View
          className="bg-white dark:bg-gray-900 rounded-t-3xl shadow-2xl"
          style={{ height: sheetHeight() }}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between px-6 pt-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            <View>
              <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Set up your network
              </Text>
              <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                A quick chat to make the map yours
              </Text>
            </View>
            <View className="flex-row gap-2">
              {!complete && (
                <TouchableOpacity
                  onPress={handleSkip}
                  className="px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800"
                >
                  <Text className="text-xs text-gray-600 dark:text-gray-300">Skip for now</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={handleClose}
                className="w-8 h-8 rounded-full items-center justify-center bg-gray-100 dark:bg-gray-800"
              >
                <Text className="text-base text-gray-600 dark:text-gray-300">×</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Transcript */}
          <ScrollView
            ref={scrollRef}
            className="flex-1 px-4 pt-4"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 12 }}
          >
            {isInitialLoading ? (
              <View className="flex-1 items-center justify-center py-8">
                <ActivityIndicator size="small" color="#6b7280" />
                <Text className="text-xs text-gray-500 mt-2">Getting started…</Text>
              </View>
            ) : (
              transcript.map((m) => <WizardMessage key={m.id} message={m} />)
            )}
            {submitting && transcript.length > 0 && (
              <View className="items-start mb-3">
                <View className="rounded-2xl px-4 py-3 bg-gray-100 dark:bg-gray-800">
                  <ActivityIndicator size="small" color="#6b7280" />
                </View>
              </View>
            )}
            {error && (
              <View className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-3">
                <Text className="text-sm text-red-700">{error}</Text>
                <TouchableOpacity
                  onPress={() => void sendTurn({})}
                  className="mt-1"
                >
                  <Text className="text-xs text-red-700 font-medium underline">Retry</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>

          {/* Footer — chips + fields + send */}
          <View className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 bg-white dark:bg-gray-900">
            {hasFields && (
              <View className="mb-2">
                {fields.map((field) => (
                  <WizardField
                    key={field.key}
                    field={field}
                    value={fieldValues[field.key] ?? ''}
                    onChange={(v) => setFieldValues((prev) => ({ ...prev, [field.key]: v }))}
                    disabled={submitting}
                  />
                ))}
                <TouchableOpacity
                  onPress={handleSendFields}
                  disabled={!canSendFields}
                  className={`mt-1 rounded-xl px-4 py-3 items-center ${
                    canSendFields ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-700'
                  }`}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <Text className="text-white font-semibold text-sm">Send</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {chips.length > 0 && (
              <View className="flex-row flex-wrap gap-2">
                {chips.map((chip) => (
                  <WizardChip
                    key={chip.value}
                    chip={chip}
                    disabled={submitting}
                    onPress={
                      complete && chip.value === 'close' ? handleClose : handleChip
                    }
                  />
                ))}
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
