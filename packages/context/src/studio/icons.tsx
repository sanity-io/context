import {forwardRef, type SVGProps} from 'react'

/** Inlined from `@sanity/icons@5.2.1` `LaunchIcon` to avoid the peer dependency. */
export const LaunchIcon = forwardRef<SVGSVGElement, Omit<SVGProps<SVGSVGElement>, 'ref'>>(
  function LaunchIcon(props, ref) {
    return (
      <svg
        data-sanity-icon="launch"
        width="1em"
        height="1em"
        viewBox="0 0 25 25"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        {...props}
        ref={ref}
      >
        <path
          d="M12 7.5H6.5V18.5H17.5V13M19.5 5.5L10.5 14.5"
          stroke="currentColor"
          strokeWidth={1.2}
          strokeLinejoin="round"
        />

        <path d="M14 5.5H19.5V11" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
      </svg>
    )
  },
)

/** Inlined from `@sanity/icons@5.2.1` `ChartUpwardIcon` to avoid the peer dependency. */
export const ChartUpwardIcon = forwardRef<SVGSVGElement, Omit<SVGProps<SVGSVGElement>, 'ref'>>(
  function ChartUpwardIcon(props, ref) {
    return (
      <svg
        data-sanity-icon="chart-upward"
        width="1em"
        height="1em"
        viewBox="0 0 25 25"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        {...props}
        ref={ref}
      >
        <path
          d="M5.5 5V19.5H20M7.5 16L11.5 11.5L15.5 14L19.5 8.5"
          stroke="currentColor"
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
      </svg>
    )
  },
)
