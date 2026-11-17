// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState} from 'react';
import {AspectRatio} from '@curialy/ui/AspectRatio';
import {useImageMode} from '@curialy/ui/hooks';
import {VStack} from '@curialy/ui/Layout';
import {Switch} from '@curialy/ui/Switch';
import {Text} from '@curialy/ui/Text';
import {MediaTheme} from '@curialy/ui/theme';

const NIGHT_PHOTO = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20400%20300%22%20preserveAspectRatio%3D%22xMidYMid%20slice%22%3E%3Crect%20width%3D%22400%22%20height%3D%22300%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.12%22%2F%3E%3Cg%20transform%3D%22translate%28200%20150%29%22%20fill%3D%22none%22%20stroke%3D%22%23808080%22%20stroke-opacity%3D%220.55%22%20stroke-width%3D%225%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Crect%20x%3D%22-44%22%20y%3D%22-44%22%20width%3D%2288%22%20height%3D%2288%22%20rx%3D%2216%22%2F%3E%3Ccircle%20cx%3D%2218%22%20cy%3D%22-18%22%20r%3D%222.5%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.55%22%20stroke%3D%22none%22%2F%3E%3Cpath%20d%3D%22M-34%2030%20L-8%200%20L10%2018%20L20%208%20L34%2024%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E';
const BEACH_PHOTO = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20400%20300%22%20preserveAspectRatio%3D%22xMidYMid%20slice%22%3E%3Crect%20width%3D%22400%22%20height%3D%22300%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.12%22%2F%3E%3Cg%20transform%3D%22translate%28200%20150%29%22%20fill%3D%22none%22%20stroke%3D%22%23808080%22%20stroke-opacity%3D%220.55%22%20stroke-width%3D%225%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Crect%20x%3D%22-44%22%20y%3D%22-44%22%20width%3D%2288%22%20height%3D%2288%22%20rx%3D%2216%22%2F%3E%3Ccircle%20cx%3D%2218%22%20cy%3D%22-18%22%20r%3D%222.5%22%20fill%3D%22%23808080%22%20fill-opacity%3D%220.55%22%20stroke%3D%22none%22%2F%3E%3Cpath%20d%3D%22M-34%2030%20L-8%200%20L10%2018%20L20%208%20L34%2024%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E';

const CAPTION_REGION = {x: 0, y: 0, width: 1, height: 0.3};

export default function UseImageModeHookUsage() {
  const [isBeach, setIsBeach] = useState(false);
  const src = isBeach ? BEACH_PHOTO : NIGHT_PHOTO;
  const mode = useImageMode(src, {
    region: CAPTION_REGION,
    threshold: 0.4,
    fallback: 'dark',
  });

  return (
    <VStack gap={3}>
      <AspectRatio
        ratio={3 / 2}
        style={{
          width: 360,
          maxWidth: '100%',
          borderRadius: 'var(--radius-container)',
        }}>
        <img
          src={src}
          alt={isBeach ? 'A beach under a pale sky' : 'Snowy peaks at night'}
          style={{width: '100%', height: '100%', objectFit: 'cover'}}
        />
        <div style={{position: 'absolute', inset: '0 0 auto', padding: 16}}>
          <MediaTheme mode={mode ?? 'off'}>
            <VStack gap={1}>
              <Text type="body" weight="bold">
                {isBeach ? 'Afternoon at the beach' : 'Night in the mountains'}
              </Text>
              <Text type="supporting">Sky behind the caption: {mode}</Text>
            </VStack>
          </MediaTheme>
        </div>
      </AspectRatio>
      <Switch label="Beach photo" value={isBeach} onChange={setIsBeach} />
    </VStack>
  );
}
