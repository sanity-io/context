import {hues} from '@sanity/color'
import {Card, type CardTone, Flex, Stack, Text, useTheme} from '@sanity/ui'

import {TextWithInfo} from '../TextWithInfo'
import {Widget} from './Widget'

type Tone = Extract<CardTone, 'positive' | 'primary' | 'caution' | 'critical' | 'default'>

const TONE_COLORS: Record<Tone, {dark: string; light: string}> = {
  positive: {dark: hues.green[700].hex, light: hues.green[300].hex},
  primary: {dark: hues.blue[700].hex, light: hues.blue[300].hex},
  caution: {dark: hues.orange[700].hex, light: hues.orange[300].hex},
  critical: {dark: hues.red[700].hex, light: hues.red[300].hex},
  default: {dark: hues.gray[700].hex, light: hues.gray[300].hex},
}

export interface DistributionItem {
  label: string
  count: number
  tone: Tone
}

interface DistributionWidgetProps {
  title: string
  info: string
  items: DistributionItem[]
  emptyText: string
}

export function DistributionWidget(props: DistributionWidgetProps) {
  const {title, info, items, emptyText} = props
  const total = items.reduce((sum, item) => sum + item.count, 0)

  return (
    <Widget>
      <Stack space={4}>
        <TextWithInfo size={1} weight="semibold" info={info}>
          {title}
        </TextWithInfo>

        {total > 0 ? (
          <Stack space={3}>
            {items.map((item) => (
              <DistributionRow key={item.label} item={item} total={total} />
            ))}
          </Stack>
        ) : (
          <Text size={1} muted>
            {emptyText}
          </Text>
        )}
      </Stack>
    </Widget>
  )
}

function DistributionRow(props: {item: DistributionItem; total: number}) {
  const {item, total} = props
  const percentage = Math.round((item.count / total) * 100)
  const barColor = TONE_COLORS[item.tone]
  const isDark = useTheme().sanity.v2?.color._dark

  return (
    <Stack space={2}>
      <Flex gap={2} align="center" justify="space-between">
        <Text size={1}>{item.label}</Text>

        <Flex align="center" gap={2}>
          <Text size={1} weight="medium">
            {item.count}
          </Text>

          <Text size={0} muted>
            ({percentage}%)
          </Text>
        </Flex>
      </Flex>

      <Card
        tone="transparent"
        style={{
          width: '100%',
          height: 4,
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: item.count === 0 ? 0 : `${Math.max(percentage, 2)}%`,
            height: '100%',
            borderRadius: 2,
            backgroundColor: isDark ? barColor.dark : barColor.light,
          }}
        />
      </Card>
    </Stack>
  )
}
