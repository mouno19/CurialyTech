// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState} from 'react';
import {Tokenizer} from '@curialy/ui/Tokenizer';
import {Button} from '@curialy/ui/Button';
import {Stack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';
import type {SearchableItem, SearchSource} from '@curialy/ui/Typeahead';

const users: SearchableItem[] = [
  {id: '1', label: 'Alice Johnson'},
  {id: '2', label: 'Bob Smith'},
  {id: '3', label: 'Charlie Brown'},
  {id: '4', label: 'Diana Prince'},
  {id: '5', label: 'Eve Williams'},
  {id: '6', label: 'Frank Miller'},
];

const userSource: SearchSource = {
  search: (query: string) =>
    users.filter(u => u.label.toLowerCase().includes(query.toLowerCase())),
  bootstrap: () => users,
};

export default function TokenizerEndContent() {
  const [value, setValue] = useState<SearchableItem[]>([users[0], users[2]]);

  return (
    <div style={{display: 'grid', gridTemplateColumns: 'minmax(0, 400px)'}}>
      <Stack direction="vertical" gap={2}>
        <Text type="supporting" color="secondary">
          Action button in the end slot
        </Text>
        <Tokenizer
          label="Team Members"
          placeholder="Search people..."
          searchSource={userSource}
          value={value}
          onChange={items => setValue(items)}
          endContent={<Button label="Apply" variant="primary" size="sm" />}
        />
      </Stack>
    </div>
  );
}
