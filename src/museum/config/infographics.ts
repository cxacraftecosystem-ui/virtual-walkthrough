/**
 * CRAFT INFOGRAPHICS — Product Wall (PDF §4 "Craft Infographics at Product Wall").
 *
 * The panel layout, typography and illustration slots are final; the COPY is not.
 * No historical or regional claims are invented here: every `body` is a clearly
 * marked slot awaiting curatorial text from the workshop. Replace `body` (and set
 * `placeholder: false`) and the wall panel + information panel update automatically.
 */

import type { SurfaceId } from './layout'

export type InfographicIcon = 'map' | 'dye' | 'block' | 'process'

export interface InfographicConfig {
  id: string
  kicker: string
  title: string
  body: string
  /** Optional numbered steps rendered as a process strip. */
  steps?: string[]
  icon: InfographicIcon
  placement: { surface: SurfaceId; at: number; centerHeight?: number }
  width: number
  height: number
  placeholder?: boolean
}

const PENDING = 'Curatorial text to be supplied by the workshop. This panel will present verified content only.'

export const INFOGRAPHICS: InfographicConfig[] = [
  { id: 'info-history', kicker: '01', title: 'Regional History', body: PENDING, icon: 'map', placement: { surface: 'product-wall', at: -3.6 }, width: 1.45, height: 1.95, placeholder: true },
  { id: 'info-dyes', kicker: '02', title: 'Natural Dyes', body: PENDING, icon: 'dye', placement: { surface: 'product-wall', at: -1.2 }, width: 1.45, height: 1.95, placeholder: true },
  { id: 'info-technique', kicker: '03', title: 'Technique', body: PENDING, icon: 'block', placement: { surface: 'product-wall', at: 1.2 }, width: 1.45, height: 1.95, placeholder: true },
  {
    id: 'info-process',
    kicker: '04',
    title: 'Process',
    body: PENDING,
    steps: ['Block', 'Cloth', 'Colour', 'Print', 'Finish'],
    icon: 'process',
    placement: { surface: 'product-wall', at: 3.6 },
    width: 1.45,
    height: 1.95,
    placeholder: true,
  },
  // Key panel for the salon hang in Gallery A-south (the seven studies carry no individual labels).
  { id: 'info-salon', kicker: 'Salon', title: 'Seven Studies', body: PENDING, icon: 'block', placement: { surface: 'gallery-a-partition', at: -1.75, centerHeight: 1.45 }, width: 0.56, height: 0.75, placeholder: true },
  // Gallery D introduction, on the east wall just north of the doorway from Gallery A.
  { id: 'info-gallery-d', kicker: 'Gallery D', title: 'Regional Gallery', body: PENDING, icon: 'map', placement: { surface: 'gallery-d-east', at: -12.4 }, width: 1.2, height: 1.62, placeholder: true },
]

/** Wall text on the reveal wall — the first focal plane of the exhibition. */
export const EXHIBITION_TITLE = {
  kicker: 'A Virtual Exhibition',
  title: 'Hand Block Printing',
  subtitle: 'Carved wood · pigment · cloth',
  intro:
    'Every pattern in these galleries begins as a block of carved wood pressed by hand onto cloth. Walk on to meet the textiles, the blocks that made them, and the craft between the two.',
}

export const RECEPTION_WELCOME = {
  title: 'Welcome',
  body: 'Follow the central passage to the galleries. Galleries A, B and C open either side of it, the craft court lies beyond the reveal wall, and doorways lead on to Gallery D and the dye-garden courtyard.',
}
