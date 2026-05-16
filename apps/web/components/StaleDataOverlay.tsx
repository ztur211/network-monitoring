import React from 'react';
import { View, ViewProps } from 'react-native';

interface StaleDataOverlayProps extends ViewProps {
  isStale: boolean;
  children: React.ReactNode;
}

export function StaleDataOverlay({ isStale, children, style, ...rest }: StaleDataOverlayProps) {
  return (
    <View {...rest} style={[{ position: 'relative' }, style]}>
      <View style={{ opacity: isStale ? 0.4 : 1 }}>{children}</View>
    </View>
  );
}
