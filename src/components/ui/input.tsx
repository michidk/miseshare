import { Input as InputPrimitive } from '@base-ui/react/input'
import type * as React from 'react'
import { cn } from '@/lib/utils'

function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <InputPrimitive data-slot="input" className={cn(className)} {...props} />
}

export { Input }
