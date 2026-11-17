// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Stepper, Step} from '@curialy/ui/Stepper';
import {Text} from '@curialy/ui/Text';
import {Icon} from '@curialy/ui/Icon';
import {Spinner} from '@curialy/ui/Spinner';

export default function StepIndicator() {
  // The first four steps are all completed — same progress, so the indicator
  // prop is the only difference between them. `auto` is the one that reacts to
  // progress: a numbered badge until the step is reached, then a check. The
  // last step is in progress instead, because the node it passes to `indicator`
  // is a spinner and a spinner only makes sense on work that is running.
  return (
    <div style={{display: 'flex', flexWrap: 'wrap', gap: 24}}>
      <div style={{width: 190}}>
        <Text type="label">auto (default)</Text>
        <Stepper activeStep={1} orientation="vertical">
          <Step step={0} label="Verify email" />
        </Stepper>
      </div>
      <div style={{width: 190}}>
        <Text type="label">number</Text>
        <Stepper activeStep={1} orientation="vertical">
          <Step step={0} label="Verify email" indicator="number" />
        </Stepper>
      </div>
      <div style={{width: 190}}>
        <Text type="label">Custom node</Text>
        <Stepper activeStep={1} orientation="vertical">
          <Step
            step={0}
            label="Verify email"
            indicator={<Icon icon="wrench" size="sm" />}
          />
        </Stepper>
      </div>
      <div style={{width: 190}}>
        <Text type="label">none</Text>
        <Stepper activeStep={1} orientation="vertical">
          <Step step={0} label="Verify email" indicator="none" />
        </Stepper>
      </div>
      <div style={{width: 190}}>
        <Text type="label">Spinner (in progress)</Text>
        <Stepper activeStep={0} orientation="vertical">
          <Step
            step={0}
            label="Verify email"
            // `inherit` picks up the indicator's own tint, so the spinner is
            // colored by the step's progress and status like any other glyph.
            indicator={<Spinner size="md" shade="inherit" />}
          />
        </Stepper>
      </div>
    </div>
  );
}
