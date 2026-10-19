import { type HTMLAttributes, forwardRef } from 'react'
import { cn } from '../../lib/utils'

type CardProps = HTMLAttributes<HTMLDivElement>

export const Card = forwardRef<HTMLDivElement, CardProps>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'rounded-2xl border border-border-light bg-surface-light p-4 dark:border-transparent dark:bg-surface-dark-elevated',
      className,
    )}
    {...props}
  />
))
Card.displayName = 'Card'
