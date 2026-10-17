export const equipmentSlots = ['armor', 'shield', 'main_hand', 'off_hand'] as const
export type EquipmentSlot = (typeof equipmentSlots)[number]

export const equipmentSlotLabels: Record<EquipmentSlot, string> = {
  armor: 'Armor',
  shield: 'Shield',
  main_hand: 'Main hand',
  off_hand: 'Off hand',
}

export function compatibleEquipmentSlots(category: string): EquipmentSlot[] {
  if (category === 'armor') return ['armor']
  if (category === 'shield') return ['shield']
  if (category === 'weapon') return ['main_hand', 'off_hand']
  return []
}
