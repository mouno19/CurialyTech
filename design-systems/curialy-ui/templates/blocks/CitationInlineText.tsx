// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Citation} from '@curialy/ui/Citation';
import {Text} from '@curialy/ui/Text';
import {Stack} from '@curialy/ui/Layout';

export default function CitationInlineText() {
  return (
    <Stack direction="vertical" gap={4} style={{maxWidth: 560}}>
      <Text type="body">
        React uses a virtual DOM to minimize expensive DOM operations
        <Citation
          source={{title: 'React Documentation', url: 'https://react.dev'}}
          number={1}
          variant="number"
        />
        . This approach was inspired by earlier functional UI frameworks
        <Citation
          source={{
            title: 'Elm Architecture',
            url: 'https://guide.elm-lang.org/architecture/',
          }}
          number={2}
          variant="number"
        />
        .
      </Text>
      <Text type="body">
        TypeScript adds static types to JavaScript for safer refactoring
        <Citation
          source={{
            title: 'TypeScript Documentation',
            url: 'https://www.typescriptlang.org',
            icon: 'https://www.typescriptlang.org/favicon-32x32.png',
          }}
          number={3}
          variant="label"
        />
        .
      </Text>
    </Stack>
  );
}
