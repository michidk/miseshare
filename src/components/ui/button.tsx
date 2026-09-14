import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva('', {
  variants: {
    variant: {
      default: 'button',
      primary: 'button button-primary',
      secondary: 'button button-secondary',
      unstyled: '',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

function Button({
  className,
  variant = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      className={cn(buttonVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Button, buttonVariants }
