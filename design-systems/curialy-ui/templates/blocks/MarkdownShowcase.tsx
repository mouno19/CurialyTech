// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Markdown} from '@curialy/ui/Markdown';
import {Center} from '@curialy/ui/Center';

const content = [
  '# Markdown Demo',
  '',
  'Renders **markdown** with *design-system-consistent* styling.',
  '',
  '## Features',
  '',
  '- Headings mapped to the Curialy UI type scale',
  '- **Bold**, *italic*, and ~~strikethrough~~ text',
  '- [Links](https://example.com) with external detection',
  '',
  '> Block quote indented text',
].join('\n');

export default function MarkdownShowcase() {
  return (
    <Center width={400}>
      <Markdown>{content}</Markdown>
    </Center>
  );
}
