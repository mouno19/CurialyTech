// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {ButtonGroup} from '@curialy/ui/ButtonGroup';
import {Button} from '@curialy/ui/Button';
import {IconButton} from '@curialy/ui/IconButton';
import {Stack} from '@curialy/ui/Layout';
import {Icon} from '@curialy/ui/Icon';
import {
  ClipboardDocumentIcon,
  ScissorsIcon,
  ClipboardIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';

export default function ButtonGroupShowcase() {
  return (
    <Stack direction="horizontal" gap={6} vAlign="center">
      <ButtonGroup label="Clipboard actions">
        <Button label="Copy" icon={<Icon icon={ClipboardDocumentIcon} />} />
        <Button label="Cut" icon={<Icon icon={ScissorsIcon} />} />
        <Button label="Paste" icon={<Icon icon={ClipboardIcon} />} />
      </ButtonGroup>
      <ButtonGroup label="Save options">
        <Button label="Save" variant="primary" />
        <IconButton
          label="Save options"
          variant="primary"
          icon={<Icon icon={ChevronDownIcon} />}
        />
      </ButtonGroup>
    </Stack>
  );
}
