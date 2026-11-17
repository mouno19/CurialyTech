// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {ProgressBar} from '@curialy/ui/ProgressBar';
import {VStack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

export default function ProgressBarCustomFormat() {
  return (
    <div style={{width: 300}}>
      <VStack gap={1}>
        <ProgressBar
          value={3.2}
          max={5}
          label="Disk usage"
          hasValueLabel
          formatValueLabel={(value: number, max: number) =>
            `${value} GB / ${max} GB`
          }
        />
        <Text type="supporting" color="secondary">
          1.8 GB remaining
        </Text>
      </VStack>
    </div>
  );
}
