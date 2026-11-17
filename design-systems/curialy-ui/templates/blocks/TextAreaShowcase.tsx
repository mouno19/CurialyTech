// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState} from 'react';
import {TextArea} from '@curialy/ui/TextArea';

export default function TextAreaShowcase() {
  const [value, setValue] = useState('');
  return (
    <div style={{width: 400}}>
      <TextArea
        label="Description"
        value={value}
        onChange={setValue}
        placeholder="Enter a description..."
      />
    </div>
  );
}
