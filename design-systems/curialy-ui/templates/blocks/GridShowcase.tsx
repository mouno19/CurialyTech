// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {Card} from '@curialy/ui/Card';
import {Grid} from '@curialy/ui/Grid';

export default function GridShowcase() {
  return (
    <Grid columns={3} gap={2} width={400}>
      {Array.from({length: 12}, (_, i) => (
        <Card key={i}>Item {i + 1}</Card>
      ))}
    </Grid>
  );
}
