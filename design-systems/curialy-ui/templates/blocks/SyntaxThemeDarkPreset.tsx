// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {SyntaxTheme} from '@curialy/ui/theme';
import {dracula} from '@curialy/ui/theme/syntax';
import {CodeBlock} from '@curialy/ui/CodeBlock';

const code = `function greet(name: string) {
  return \`Hello, \${name}!\`;
}`;

export default function SyntaxThemeDarkPreset() {
  return (
    <SyntaxTheme theme={dracula}>
      <CodeBlock code={code} language="tsx" title="Dracula preset" />
    </SyntaxTheme>
  );
}
