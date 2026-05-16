/// <reference types="nativewind/types" />

import 'react-native';

declare module 'react-native' {
  interface ViewProps {
    className?: string;
  }
  interface TextProps {
    className?: string;
  }
  interface ImagePropsBase {
    className?: string;
  }
  interface TextInputProps {
    className?: string;
    placeholderClassName?: string;
  }
  interface ScrollViewProps {
    className?: string;
    contentContainerClassName?: string;
  }
  interface SwitchProps {
    className?: string;
  }
  interface TouchableWithoutFeedbackProps {
    className?: string;
  }
  interface PressableProps {
    className?: string;
  }
  interface FlatListProps<ItemT> {
    className?: string;
    contentContainerClassName?: string;
    columnWrapperClassName?: string;
  }
  interface ActivityIndicatorProps {
    className?: string;
  }
}
