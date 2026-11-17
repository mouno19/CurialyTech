// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Toolbar} from '@curialy/ui/Toolbar';
import {Button} from '@curialy/ui/Button';
import {Icon} from '@curialy/ui/Icon';
import {Heading} from '@curialy/ui/Text';
import {Card} from '@curialy/ui/Card';
import {Section} from '@curialy/ui/Section';
import {ArrowLeftIcon} from '@heroicons/react/24/outline';

export default function ToolbarThreeSlot() {
  return (
    <Card style={{width: 600, height: '100%', marginTop: 260}}>
      <Toolbar
        label="Document toolbar"
        dividers={['bottom']}
        startContent={
          <Button
            label="Back"
            variant="ghost"
            icon={<Icon icon={ArrowLeftIcon} />}
            isIconOnly
          />
        }
        centerContent={<Heading level={4}>Title</Heading>}
        endContent={
          <>
            <Button label="Discard" variant="secondary" />
            <Button label="Save" variant="primary" />
          </>
        }
      />
      <Section />
    </Card>
  );
}
