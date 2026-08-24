import * as React from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "@/shared/components/ui/contracts/cn"

interface SliderProps extends Omit<React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>, "children" | "onValueChange"> {
  variant?: "primary" | "secondary";
  onValueChange?: (value: number) => void;
  className?: string;
}

const toScalarValue = (value: number | readonly number[]): number => {
  if (Array.isArray(value)) {
    return value[0] ?? 0;
  }

  return typeof value === 'number' ? value : (value[0] ?? 0);
};

const Slider = React.forwardRef<
  HTMLDivElement,
  SliderProps
>(({ className, variant = "primary", onValueChange, ...props }, ref) => {
  const rangeColorClass = variant === "secondary"
    ? "bg-muted-foreground/60"
    : "bg-primary";

  const thumbColorClass = variant === "secondary"
    ? "border-muted-foreground/60"
    : "border-primary";

  return (
    <SliderPrimitive.Root
      ref={ref}
      className={cn(
        "relative flex w-full touch-none select-none items-center",
        className
      )}
      {...props}
      onValueChange={onValueChange ? (value) => onValueChange(toScalarValue(value)) : undefined}
    >
      <SliderPrimitive.Control className="flex w-full items-center">
        <SliderPrimitive.Track className={cn(
          "relative w-full grow overflow-hidden rounded-full bg-secondary",
          variant === "secondary" ? "h-1" : "h-2"
        )}>
          <SliderPrimitive.Indicator className={cn("absolute h-full", rangeColorClass)} />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className={cn(
          "block h-5 w-5 rounded-full border-2 bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          thumbColorClass
        )} />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
})
Slider.displayName = "Slider"

export { Slider }
