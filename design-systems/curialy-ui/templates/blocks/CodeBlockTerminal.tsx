// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {SyntaxTheme} from '@curialy/ui/theme';
import {githubDark} from '@curialy/ui/theme/syntax';
import {CodeBlock} from '@curialy/ui/CodeBlock';

const commands = `$ cui init --features agents
✓ AI agent docs installed → AGENTS.md
$ pnpm cui component CodeBlock --dense`;

export default function CodeBlockTerminal() {
  return (
    <SyntaxTheme theme={githubDark}>
      <CodeBlock
        code={commands}
        language="bash"
        hasCopyButton
        style={{width: '100%', maxWidth: 480}}
      />
    </SyntaxTheme>
  );
}
