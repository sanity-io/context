import {Stack, Text} from '@sanity/ui'

import {METRIC_INFO} from '../constants'
import {TextWithInfo} from '../TextWithInfo'
import {ContentGapRow} from './ContentGapRow'
import type {ContentGap} from './useOverviewData'
import {Widget} from './Widget'

interface ContentGapsWidgetProps {
  contentGaps: ContentGap[]
  onContentGapClick: (description: string) => void
}

export function ContentGapsWidget(props: ContentGapsWidgetProps) {
  const {contentGaps, onContentGapClick} = props

  return (
    <Widget>
      <Stack space={4}>
        <TextWithInfo size={1} weight="semibold" info={METRIC_INFO.contentGaps}>
          Content gaps
        </TextWithInfo>

        {contentGaps.length > 0 ? (
          <Stack space={2}>
            {contentGaps.map((gap) => (
              <ContentGapRow
                key={gap.description}
                description={gap.description}
                count={gap.count}
                onClick={onContentGapClick}
              />
            ))}
          </Stack>
        ) : (
          <Text size={1} muted>
            No content gaps detected
          </Text>
        )}
      </Stack>
    </Widget>
  )
}
