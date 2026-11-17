// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {MediaTheme} from '@curialy/ui/theme';
import {Section} from '@curialy/ui/Section';
import {Stack} from '@curialy/ui/Layout';
import {Text} from '@curialy/ui/Text';
import {Button} from '@curialy/ui/Button';
import {Badge} from '@curialy/ui/Badge';
import {Icon} from '@curialy/ui/Icon';

const SHOWCASE_IMAGE_URL =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20400%20300%22%20preserveAspectRatio%3D%22xMidYMid%20slice%22%3E%3Crect%20width%3D%22400%22%20height%3D%22300%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.12%22%2F%3E%3Cg%20transform%3D%22translate%28200%20150%29%22%20fill%3D%22none%22%20stroke%3D%22%23808080%22%20stroke-opacity%3D%220.55%22%20stroke-width%3D%225%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Crect%20x%3D%22-44%22%20y%3D%22-44%22%20width%3D%2288%22%20height%3D%2288%22%20rx%3D%2216%22%2F%3E%3Ccircle%20cx%3D%2218%22%20cy%3D%22-18%22%20r%3D%222.5%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.55%22%20stroke%3D%22none%22%2F%3E%3Cpath%20d%3D%22M-34%2030%20L-8%200%20L10%2018%20L20%208%20L34%2024%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E';

export default function MediaThemeShowcase() {
  return (
    <Section
      variant="transparent"
      padding={4}
      style={{
        width: 360,
        maxWidth: '100%',
        minHeight: 230,
        display: 'flex',
        alignItems: 'flex-end',
        backgroundImage: `linear-gradient(180deg, rgba(10,19,23,0.05) 0%, rgba(10,19,23,0.82) 100%), url(${SHOWCASE_IMAGE_URL})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        borderRadius: 'var(--radius-container)',
        boxShadow: 'var(--shadow-med)',
      }}>
      <MediaTheme mode="dark">
        <Stack direction="vertical" gap={3}>
          <Stack direction="horizontal" gap={2} vAlign="center">
            <Icon icon="info" size="md" />
            <Text type="body" weight="bold">
              Media overlay
            </Text>
            <Badge label="Live" />
          </Stack>
          <Text type="supporting" color="secondary">
            Text, icons, badges, and button variants inherit legible colors on
            top of the dark image treatment.
          </Text>
          <Stack direction="horizontal" gap={2} wrap="wrap">
            <Button label="Primary" variant="primary" size="sm" />
            <Button label="Secondary" variant="secondary" size="sm" />
            <Button label="Ghost" variant="ghost" size="sm" />
          </Stack>
        </Stack>
      </MediaTheme>
    </Section>
  );
}
