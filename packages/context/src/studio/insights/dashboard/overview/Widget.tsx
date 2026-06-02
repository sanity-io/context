import {Card, type CardTone} from '@sanity/ui'

interface WidgetProps {
  children: React.ReactNode
  tone?: CardTone
}

export function Widget(props: WidgetProps) {
  const {children, tone = 'default'} = props

  return (
    <Card padding={4} radius={3} border tone={tone}>
      {children}
    </Card>
  )
}
