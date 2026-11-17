// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState} from 'react';
import {TextInput} from '@curialy/ui/TextInput';
import {VStack} from '@curialy/ui/Layout';
import {Center} from '@curialy/ui/Center';

export default function FieldStatusVariants() {
  const [email, setEmail] = useState('bad-email');
  const [username, setUsername] = useState('admin');
  const [apiKey, setApiKey] = useState('sk-live-abc123');

  return (
    <Center>
      <VStack gap={4}>
        <TextInput
          label="Email"
          description="Enter your work email"
          value={email}
          onChange={setEmail}
          status={{
            type: 'error',
            message: 'Please enter a valid email address',
          }}
        />
        <TextInput
          label="Username"
          description="Choose a unique username"
          value={username}
          onChange={setUsername}
          status={{
            type: 'warning',
            message: 'This username is reserved for administrators',
          }}
        />
        <TextInput
          label="API Key"
          description="Paste your API key"
          value={apiKey}
          onChange={setApiKey}
          status={{type: 'success', message: 'API key is valid and active'}}
        />
      </VStack>
    </Center>
  );
}
