// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState} from 'react';
import {Tokenizer} from '@curialy/ui/Tokenizer';
import {Stack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';
import type {SearchableItem, SearchSource} from '@curialy/ui/Typeahead';

const emptySource: SearchSource = {
  search: () => [],
  bootstrap: () => [],
};

const users: SearchableItem[] = [
  {id: '1', label: 'Alice Johnson'},
  {id: '2', label: 'Bob Smith'},
  {id: '3', label: 'Charlie Brown'},
  {id: '4', label: 'Diana Prince'},
  {id: '5', label: 'Eve Williams'},
];

const userSource: SearchSource = {
  search: (query: string) =>
    users.filter(u => u.label.toLowerCase().includes(query.toLowerCase())),
  bootstrap: () => users,
};

export default function TokenizerCreatable() {
  const [tags, setTags] = useState<SearchableItem[]>([]);
  const [members, setMembers] = useState<SearchableItem[]>([]);

  return (
    <div style={{display: 'grid', gridTemplateColumns: 'minmax(0, 400px)'}}>
      <Stack direction="vertical" gap={4}>
        <Stack direction="vertical" gap={1}>
          <Text type="supporting" color="secondary">
            Free-text only
          </Text>
          <Tokenizer
            label="Tags"
            searchSource={emptySource}
            value={tags}
            onChange={items => setTags(items)}
            hasCreate
            placeholder="Type a tag and press Enter..."
          />
        </Stack>
        <Stack direction="vertical" gap={1}>
          <Text type="supporting" color="secondary">
            Create or search
          </Text>
          <Tokenizer
            label="Team Members"
            searchSource={userSource}
            value={members}
            onChange={items => setMembers(items)}
            hasCreate
            hasEntriesOnFocus
            placeholder="Search or type a new name..."
          />
        </Stack>
      </Stack>
    </div>
  );
}
