// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState} from 'react';
import {Button} from '@curialy/ui/Button';
import {Card} from '@curialy/ui/Card';
import {VStack} from '@curialy/ui/Layout';
import {Switch} from '@curialy/ui/Switch';
import {TextInput} from '@curialy/ui/TextInput';
import {useToast} from '@curialy/ui/Toast';

export default function UseToastHookUsage() {
  const toast = useToast();
  const [name, setName] = useState('Ada Lovelace');
  const [savedName, setSavedName] = useState('Ada Lovelace');
  const [undoName, setUndoName] = useState('Ada Lovelace');
  const [isSaveFailing, setIsSaveFailing] = useState(false);

  const save = () => {
    if (isSaveFailing) {
      toast({
        type: 'error',
        body: 'Could not save settings',
        uniqueID: 'settings-save',
      });
      return;
    }
    // Saving an unchanged name keeps the earlier undo target.
    const nextUndoName = name === savedName ? undoName : savedName;
    setUndoName(nextUndoName);
    setSavedName(name);
    const dismiss = toast({
      body: 'Settings saved',
      // A repeated Save replaces this toast instead of stacking another.
      uniqueID: 'settings-save',
      endContent: (
        <Button
          label="Undo"
          variant="ghost"
          size="sm"
          onClick={() => {
            setName(nextUndoName);
            setSavedName(nextUndoName);
            dismiss();
          }}
        />
      ),
    });
  };

  return (
    <Card width={360} padding={4}>
      <VStack gap={3}>
        <TextInput label="Display name" value={name} onChange={setName} />
        <Switch
          label="Simulate a failed save"
          value={isSaveFailing}
          onChange={setIsSaveFailing}
        />
        <Button label="Save" variant="primary" onClick={save} />
      </VStack>
    </Card>
  );
}
