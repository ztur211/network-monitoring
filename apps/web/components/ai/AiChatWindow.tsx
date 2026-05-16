import { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useAiStore } from '../../store/ai.store';
import { AiMessage } from './AiMessage';
import { AiStatusBanner } from './AiStatusBanner';

const PLACEHOLDER_MESSAGES = [
  'Is my network healthy?',
  'What devices do I have?',
  'Help me troubleshoot a connection issue',
  'What is a fiber run?',
];

export function AiChatWindow() {
  const { messages, isStreaming, error, sendMessage, clearConversation, usage, loadUsage } =
    useAiStore();
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    void loadUsage();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  const handleSend = () => {
    const text = inputText.trim();
    if (!text || isStreaming) return;
    setInputText('');
    sendMessage(text);
  };

  const isLimitReached =
    usage != null &&
    (usage.hourlyUsed >= usage.hourlyLimit || usage.dailyUsed >= usage.dailyLimit);

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={80}
    >
      <AiStatusBanner />

      {/* Message list */}
      {messages.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-2">
            NodeScope AI Assistant
          </Text>
          <Text className="text-sm text-gray-500 text-center mb-6">
            Ask about your network or how to use NodeScope
          </Text>
          <View className="w-full gap-2">
            {PLACEHOLDER_MESSAGES.map((msg) => (
              <TouchableOpacity
                key={msg}
                className="bg-gray-100 dark:bg-gray-800 rounded-xl px-4 py-3"
                onPress={() => sendMessage(msg)}
                disabled={isStreaming || isLimitReached}
              >
                <Text className="text-sm text-gray-700 dark:text-gray-200">{msg}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          className="flex-1 px-4 pt-4"
          showsVerticalScrollIndicator={false}
        >
          {messages.map((msg) => (
            <AiMessage key={msg.id} message={msg} />
          ))}
          {error && (
            <View className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-3">
              <Text className="text-sm text-red-700">{error}</Text>
            </View>
          )}
          <View className="h-4" />
        </ScrollView>
      )}

      {/* Input bar */}
      <View className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 bg-white dark:bg-gray-900">
        {messages.length > 0 && (
          <TouchableOpacity
            onPress={() => void clearConversation()}
            className="self-end mb-2"
            disabled={isStreaming}
          >
            <Text className="text-xs text-gray-400">Clear conversation</Text>
          </TouchableOpacity>
        )}
        <View className="flex-row items-end gap-2">
          <TextInput
            className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-2xl px-4 py-3 text-sm text-gray-900 dark:text-gray-100"
            placeholder={isLimitReached ? 'Message limit reached' : 'Ask about your network…'}
            placeholderTextColor="#9ca3af"
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={2000}
            editable={!isStreaming && !isLimitReached}
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={!inputText.trim() || isStreaming || isLimitReached}
            className={`w-10 h-10 rounded-full items-center justify-center ${
              !inputText.trim() || isStreaming || isLimitReached
                ? 'bg-gray-300 dark:bg-gray-600'
                : 'bg-blue-600'
            }`}
          >
            {isStreaming ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Text className="text-white font-bold text-base">↑</Text>
            )}
          </TouchableOpacity>
        </View>
        {usage && (
          <Text className="text-xs text-gray-400 text-center mt-1">
            {usage.hourlyUsed}/{usage.hourlyLimit} messages this hour
          </Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
