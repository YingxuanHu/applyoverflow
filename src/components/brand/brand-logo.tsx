import { cn } from "@/lib/utils";

type BrandLogoProps = {
  className?: string;
  iconClassName?: string;
  textClassName?: string;
  showText?: boolean;
  priority?: boolean;
};

export function BrandLogo({
  className,
  iconClassName,
  textClassName,
  showText = true,
}: BrandLogoProps) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center text-foreground",
          iconClassName
        )}
        aria-hidden="true"
      >
        <span
          className="block size-full bg-current"
          style={{
            WebkitMaskImage: "url('/brand/applyoverflow-mark.png')",
            maskImage: "url('/brand/applyoverflow-mark.png')",
            WebkitMaskPosition: "center",
            maskPosition: "center",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskSize: "contain",
            maskSize: "contain",
          }}
        />
      </span>
      {showText ? (
        <span
          className={cn(
            "min-w-0 truncate font-brand text-base font-semibold tracking-tight",
            textClassName
          )}
        >
          ApplyOverflow
        </span>
      ) : null}
    </span>
  );
}
