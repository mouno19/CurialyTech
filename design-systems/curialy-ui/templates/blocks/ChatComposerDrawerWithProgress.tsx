// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {ChatComposer, ChatComposerDrawer} from '@curialy/ui/Chat';
import {Token} from '@curialy/ui/Token';
import {ProgressBar} from '@curialy/ui/ProgressBar';
import {Stack} from '@curialy/ui/Layout';
import {Button} from '@curialy/ui/Button';
import {Icon} from '@curialy/ui/Icon';
import {PaperClipIcon, AtSymbolIcon} from '@heroicons/react/24/outline';

export default function ChatComposerDrawerWithProgress() {
  return (
    <Stack direction="vertical" gap={4} width={450} maxWidth="100%">
      <ChatComposer
        onSubmit={() => {}}
        drawer={
          <ChatComposerDrawer count={3} label="Attachments">
            <Token label="design-spec.pdf" onRemove={() => {}} />
            <Token label="api-schema.json" onRemove={() => {}} />
            <Token label="screenshot.png" onRemove={() => {}} />
          </ChatComposerDrawer>
        }
        headerActions={
          <>
            <Button
              label="Mention"
              variant="ghost"
              size="sm"
              icon={<Icon icon={AtSymbolIcon} size="sm" />}
              isIconOnly
              onClick={() => {}}
            />
            <Button
              label="Attach"
              variant="ghost"
              size="sm"
              icon={<Icon icon={PaperClipIcon} size="sm" />}
              isIconOnly
              onClick={() => {}}
            />
          </>
        }
        headerContext={
          <Stack direction="horizontal" gap={2} vAlign="center">
            <ProgressBar value={42} label="Context usage" isLabelHidden />
          </Stack>
        }
      />
    </Stack>
  );
}
