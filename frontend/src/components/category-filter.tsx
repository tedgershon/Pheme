"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CategoryFilter({
  categories,
  selected,
  onSelect,
}: {
  categories: string[];
  selected: string | null;
  onSelect: (category: string | null) => void;
}) {
  return (
    <div className="border-b border-border">
      <div className="mx-auto flex max-w-7xl flex-wrap gap-2 px-4 py-2.5">
        <Button
          variant={selected === null ? "default" : "outline"}
          size="sm"
          onClick={() => onSelect(null)}
          className={cn(selected === null && "pointer-events-none")}
        >
          All
        </Button>
        {categories.map((category) => (
          <Button
            key={category}
            variant={selected === category ? "default" : "outline"}
            size="sm"
            onClick={() => onSelect(category)}
            className={cn(selected === category && "pointer-events-none")}
          >
            {category}
          </Button>
        ))}
      </div>
    </div>
  );
}
