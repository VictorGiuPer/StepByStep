import {
  Apple, BookOpen, Brain, BriefcaseBusiness, CalendarCheck, CheckCircle2, ChefHat,
  Circle, Dumbbell, Flame, Gift, GraduationCap, HandHeart, Heart, HeartPulse, House,
  Languages, MoonStar, Music2, Palette, PiggyBank, Puzzle, Shapes, Sparkles, Sprout,
  Star, Sun, Target, Users, WalletCards, type LucideIcon,
} from 'lucide-react'

const icons: Record<string, LucideIcon> = {
  Apple, BookOpen, Brain, BriefcaseBusiness, CalendarCheck, CheckCircle2, ChefHat,
  Circle, Dumbbell, Flame, Gift, GraduationCap, HandHeart, Heart, HeartPulse, House,
  Languages, MoonStar, Music2, Palette, PiggyBank, Puzzle, Shapes, Sparkles, Sprout,
  Star, Sun, Target, Users, WalletCards,
}

export const iconNames = Object.keys(icons)

export function AppIcon({ name, size = 20, className, strokeWidth = 2 }: { name?: string | null; size?: number; className?: string; strokeWidth?: number }) {
  const Icon = (name && icons[name]) || Circle
  return <Icon aria-hidden="true" size={size} className={className} strokeWidth={strokeWidth} />
}
