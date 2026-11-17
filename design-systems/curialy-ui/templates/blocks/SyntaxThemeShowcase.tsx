// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {SyntaxTheme} from '@curialy/ui/theme';
import {oneDarkPro} from '@curialy/ui/theme/syntax';
import {CodeBlock} from '@curialy/ui/CodeBlock';
import {Stack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

const sampleCode = `async function save() {
  await api.update(values);
  toast.show('Saved');
}`;

export default function SyntaxThemeShowcase() {
  return (
    <SyntaxTheme theme={oneDarkPro}>
      <Stack
        direction="vertical"
        gap={2}
        style={{width: 360, maxWidth: '100%'}}>
        <Text type="supporting" weight="bold" color="secondary">
          One Dark Pro preset
        </Text>
        <CodeBlock code={sampleCode} language="tsx" />
      </Stack>
    </SyntaxTheme>
  );
}
