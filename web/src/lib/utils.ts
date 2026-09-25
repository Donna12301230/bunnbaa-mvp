import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// tailwind.config.ts 自訂的字級（text-body、text-body-sm…）要登記成 font-size，
// 否則 twMerge 會把它當成文字顏色，和 text-primary-foreground 等顏色 class 互相覆蓋掉。
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "h1", "h2", "h3", "body", "body-sm", "caption", "micro"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
