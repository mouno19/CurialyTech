// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Carousel} from '@curialy/ui/Carousel';
import {Avatar} from '@curialy/ui/Avatar';
import {Badge} from '@curialy/ui/Badge';
import {Card} from '@curialy/ui/Card';
import {Stack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';

const TEAM = [
  {name: 'Alice Chen', role: 'Engineering Lead', color: 'blue' as const},
  {name: 'Bob Smith', role: 'Product Designer', color: 'purple' as const},
  {name: 'Carol Davis', role: 'Product Manager', color: 'green' as const},
  {name: 'Andrew Thomas', role: 'Design Manager', color: 'red' as const},
  {name: 'Gina Wilson', role: 'Software Engineer', color: 'orange' as const},
];

export default function CarouselSnap() {
  return (
    <Stack direction="vertical" gap={3} style={{maxWidth: 520, padding: 8}}>
      <Text type="body" weight="bold">
        Team members
      </Text>
      <Carousel gap={2} hasSnap hasButtons aria-label="Team members">
        {TEAM.map(person => (
          <Card key={person.name} width={180} minHeight={140}>
            <Stack direction="vertical" gap={3} hAlign="center">
              <Avatar name={person.name} size="lg" />
              <Stack direction="vertical" gap={1} hAlign="center">
                <Text type="body" weight="bold">
                  {person.name}
                </Text>
                <Badge variant={person.color} label={person.role} />
              </Stack>
            </Stack>
          </Card>
        ))}
      </Carousel>
    </Stack>
  );
}
