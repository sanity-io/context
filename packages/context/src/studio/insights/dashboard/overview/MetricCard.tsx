import {type CardTone, Stack, Text} from '@sanity/ui'

import {TextWithInfo} from '../TextWithInfo'
import {Widget} from './Widget'

interface MetricCardProps {
  label: string
  value: number | string
  info?: string
  tone?: CardTone
}

export function MetricCard(props: MetricCardProps) {
  const {label, value, info, tone} = props

  return (
    <Widget tone={tone}>
      <Stack space={3}>
        <Text size={3} weight="semibold">
          {value}
        </Text>

        {info ? (
          <TextWithInfo size={1} weight="medium" info={info}>
            {label}
          </TextWithInfo>
        ) : (
          <Text size={1} weight="medium">
            {label}
          </Text>
        )}
      </Stack>
    </Widget>
  )
}
