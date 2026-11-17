// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {CodeBlock} from '@curialy/ui/CodeBlock';
import {VStack} from '@curialy/ui/Stack';

export default function CodeBlockBashCommand() {
  return (
    <VStack gap={4} style={{width: '100%', maxWidth: 400}}>
      <CodeBlock
        code="npm install @curialy/ui"
        language="bash"
        hasLanguageLabel={false}
        style={{width: '100%'}}
      />
      <CodeBlock
        code="yarn add @curialy/ui-theme-neutral"
        language="bash"
        hasLanguageLabel={false}
        style={{width: '100%'}}
      />
      <CodeBlock
        code={
          'cui upgrade --from 0.6.0 --apply --path apps/web/src --install-deps\nnpm run build'
        }
        language="bash"
        hasLanguageLabel={false}
        style={{width: '100%'}}
      />
    </VStack>
  );
}
