// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {ButtonGroup} from '@curialy/ui/ButtonGroup';
import {Button} from '@curialy/ui/Button';

export default function ButtonGroupBasic() {
  return (
    <ButtonGroup label="Text editing actions">
      <Button label="Copy" />
      <Button label="Cut" />
      <Button label="Paste" />
    </ButtonGroup>
  );
}
