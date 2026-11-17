// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Button} from '@curialy/ui/Button';
import {Card} from '@curialy/ui/Card';
import {useListFocus} from '@curialy/ui/hooks';
import {VStack} from '@curialy/ui/Layout';

const RECENT_FILES = [
  'Q3 roadmap.pdf',
  'Budget 2026.xlsx',
  'Offsite notes.docx',
  'Launch checklist.md',
];

export default function UseListFocusHookUsage() {
  const {listRef, handleKeyDown, handleFocus} = useListFocus({
    itemSelector: 'button',
    orientation: 'vertical',
    wrap: true,
    hasHomeEnd: true,
    hasRovingTabIndex: true,
  });

  return (
    <Card width={320} padding={2}>
      <VStack
        ref={listRef}
        role="toolbar"
        aria-label="Recent files"
        aria-orientation="vertical"
        gap={1}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}>
        {RECENT_FILES.map(name => (
          <Button key={name} label={name} variant="ghost" />
        ))}
      </VStack>
    </Card>
  );
}
