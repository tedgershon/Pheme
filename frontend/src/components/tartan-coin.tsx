import Image from "next/image";
import { cn } from "@/lib/utils";

export function TartanCoin({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src="/assets/tartan-coin.svg"
      alt="Tartan Coin"
      width={size}
      height={size}
      className={cn("inline-block", className)}
    />
  );
}
