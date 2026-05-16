import React, { useEffect, useState } from 'react';
import { Text, TextProps } from 'react-native';

interface TimestampProps extends TextProps {
  isoTimestamp: string | null;
  staleThresholdMs?: number;
}

function formatRelative(isoTimestamp: string): string {
  const diffMs = Date.now() - new Date(isoTimestamp).getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 10) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds} seconds ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
}

export function Timestamp({ isoTimestamp, staleThresholdMs = 90_000, style, ...rest }: TimestampProps) {
  const [label, setLabel] = useState<string>('Never');
  const [isStale, setIsStale] = useState(true);

  useEffect(() => {
    if (!isoTimestamp) {
      setLabel('Never');
      setIsStale(true);
      return;
    }

    const update = () => {
      setLabel(`Last updated ${formatRelative(isoTimestamp)}`);
      setIsStale(Date.now() - new Date(isoTimestamp).getTime() > staleThresholdMs);
    };

    update();
    const timer = setInterval(update, 10_000);
    return () => clearInterval(timer);
  }, [isoTimestamp, staleThresholdMs]);

  return (
    <Text
      {...rest}
      style={[{ fontSize: 12, color: isStale ? '#f59e0b' : '#6b7280' }, style]}
    >
      {label}
    </Text>
  );
}
