// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {SyntaxTheme} from '@curialy/ui/theme';
import {githubLight} from '@curialy/ui/theme/syntax';
import {CodeBlock} from '@curialy/ui/CodeBlock';

const code = `const status = response.ok ? 'success' : 'error';
console.log({status});`;

export default function SyntaxThemeLightPreset() {
  return (
    <SyntaxTheme theme={githubLight}>
      <CodeBlock code={code} language="tsx" title="GitHub Light preset" />
    </SyntaxTheme>
  );
}
