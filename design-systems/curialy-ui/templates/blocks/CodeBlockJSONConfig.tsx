// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {CodeBlock} from '@curialy/ui/CodeBlock';

const code = `{
  "name": "@curialy/ui",
  "version": "0.0.5",
  "dependencies": {
    "@curialy/ui-theme-neutral": "^0.1.0",
    "react": "^19.0.0"
  },
  "scripts": {
    "build": "tsup",
    "test": "vitest"
  }
}`;

export default function CodeBlockJSONConfig() {
  return (
    <CodeBlock
      code={code}
      language="json"
      title="package.json"
      hasLineNumbers
    />
  );
}
