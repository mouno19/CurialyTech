// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState} from 'react';
import {Card} from '@curialy/ui/Card';
import {usePressFeedback} from '@curialy/ui/hooks';
import {
  focusOutlineStyles,
  interactionOverlayStyles,
} from '@curialy/ui/utils';
import {Text} from '@curialy/ui/Text';

export default function UsePressFeedbackHookUsage() {
  const pressable = usePressFeedback();
  const [isFaceUp, setIsFaceUp] = useState(true);
  const flip = () => setIsFaceUp(faceUp => !faceUp);

  return (
    <Card
      {...pressable}
      xstyle={[
        interactionOverlayStyles.backgroundImage,
        focusOutlineStyles.focusVisible,
      ]}
      width={120}
      padding={1}
      role="button"
      tabIndex={0}
      aria-label="Flip card"
      aria-pressed={!isFaceUp}
      onClick={flip}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          flip();
        }
      }}>
      <Text>Card content</Text>
    </Card>
  );
}
