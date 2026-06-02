import {CheckmarkIcon, ChevronDownIcon} from '@sanity/icons'
import {Button, Menu, MenuButton, MenuDivider, MenuItem} from '@sanity/ui'
import {useId} from 'react'

interface FilterOption<T extends string> {
  value: T
  label: string
}

interface FilterMenuProps<T extends string> {
  options: FilterOption<T>[]
  value: T | null
  allLabel: string
  onChange: (value: T | null) => void
}

export function FilterMenu<T extends string>(props: FilterMenuProps<T>) {
  const {options, value, allLabel, onChange} = props
  const menuId = useId()

  const activeLabel = options.find((opt) => opt.value === value)?.label

  return (
    <MenuButton
      button={
        <Button
          text={activeLabel || allLabel}
          mode="ghost"
          fontSize={1}
          iconRight={ChevronDownIcon}
          width="fill"
          justify="space-between"
        />
      }
      id={menuId}
      popover={{
        animate: true,
        placement: 'bottom',
        fallbackPlacements: ['bottom'],
        tone: 'default',
        portal: true,
        matchReferenceWidth: true,
      }}
      menu={
        <Menu>
          <MenuItem
            fontSize={1}
            text={allLabel}
            onClick={() => onChange(null)}
            iconRight={value ? undefined : CheckmarkIcon}
          />

          {options.length > 0 && <MenuDivider />}

          {options.map((option) => (
            <MenuItem
              key={option.value}
              fontSize={1}
              text={option.label}
              onClick={() => onChange(option.value)}
              iconRight={value === option.value ? CheckmarkIcon : undefined}
            />
          ))}
        </Menu>
      }
    />
  )
}
