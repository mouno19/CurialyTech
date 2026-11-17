// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Center} from '@curialy/ui/Center';
import {Markdown} from '@curialy/ui/Markdown';

const content = [
  '# Markdown Demo',
  '',
  'Renders **markdown** with *Curialy UI* styling.',
  '',
  '## Features',
  '',
  '- **Bold**, *italic*, `code`',
  '- [Links](https://example.com)',
  '',
  '```typescript',
  'interface User {name: string;}',
  '```',
  '',
  '- [x] Parser',
  '- [ ] Stories',
].join('\n');

export default function MarkdownRichContent() {
  return (
    <Center width="100%" style={{maxWidth: 450}}>
      <Markdown>{content}</Markdown>
    </Center>
  );
}
