// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

// In production, use useToast() hook for proper positioning, stacking, and lifecycle.

import {Toast} from '@curialy/ui/Toast';
import {useToast} from '@curialy/ui/Toast';
import {Button} from '@curialy/ui/Button';

export default function ToastShowcase() {
  const toast = useToast();
  return (
    <Toast
      type="info"
      body="Document saved successfully"
      endContent={
        <Button
          label="Show toast"
          variant="ghost"
          size="sm"
          onClick={() => toast({body: 'Document saved successfully'})}
        />
      }
      isAutoHide={false}
      autoHideDuration={5000}
      isExiting={false}
      onDismiss={() => {}}
    />
  );
}
