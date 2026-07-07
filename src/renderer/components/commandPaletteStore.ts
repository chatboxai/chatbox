import { createSpotlight } from '@mantine/spotlight'

// 全局命令面板的 spotlight store（⌘K / Ctrl+K，见 hooks/useShortcut.tsx）。
// 独立的叶子模块：useShortcut 和 CommandPalette 都从这里导入，
// 避免 useShortcut → CommandPalette → sessionActions → router → __root → useShortcut 的循环依赖。
export const [commandPaletteStore, commandPalette] = createSpotlight()
