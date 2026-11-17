// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

// In production, use useToast() hook for proper positioning, stacking, and lifecycle.

import {useRef} from 'react';
import {Toast} from '@curialy/ui/Toast';
import {useToast} from '@curialy/ui/Toast';
import {Button} from '@curialy/ui/Button';
import {VStack, HStack} from '@curialy/ui/Layout';

export default function ToastDismiss() {
  const toast = useToast();
  const dismissRef = useRef<(() => void) | null>(null);

  return (
    <VStack gap={3}>
      <Toast
        type="info"
        body="Uploading file…"
        isAutoHide={false}
        autoHideDuration={5000}
        isExiting={false}
        onDismiss={() => {}}
      />
      <HStack gap={3} vAlign="center">
        <Button
          label="Show toast"
          variant="secondary"
          size="sm"
          onClick={() => {
            dismissRef.current = toast({
              body: 'Uploading file…',
              isAutoHide: false,
            });
          }}
        />
        <Button
          label="Dismiss via code"
          variant="ghost"
          size="sm"
          onClick={() => {
            dismissRef.current?.();
            dismissRef.current = null;
          }}
        />
      </HStack>
    </VStack>
  );
}
