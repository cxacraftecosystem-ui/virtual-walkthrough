/**
 * CRAFT INFOGRAPHICS — Product Wall (PDF §4 "Craft Infographics at Product Wall").
 *
 * The panel layout, typography and illustration slots are final; the COPY is not.
 * No historical or regional claims are invented here: every `body` is a clearly
 * marked slot awaiting curatorial text from the workshop. Replace `body` (and set
 * `placeholder: false`) and the wall panel + information panel update automatically.
 */

import type { SurfaceId } from './layout'
import type { AltLang, ContentI18n } from '../i18n/core'

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
  /** Optional Hindi / Bengali overrides (`steps` as a translated list). */
  i18n?: Partial<Record<AltLang, Partial<Record<'kicker' | 'title' | 'body', string>> & { steps?: string[] }>>
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
export const EXHIBITION_TITLE: { kicker: string; title: string; subtitle: string; intro: string; i18n?: ContentI18n<'kicker' | 'title' | 'subtitle' | 'intro'> } = {
  kicker: 'A Virtual Exhibition',
  title: 'Hand Block Printing',
  subtitle: 'Carved wood · pigment · cloth',
  intro:
    'Every pattern in these galleries begins as a block of carved wood pressed by hand onto cloth. Walk on to meet the textiles, the blocks that made them, and the craft between the two.',
  i18n: {
    hi: {
      kicker: 'एक आभासी प्रदर्शनी',
      title: 'हस्त ठप्पा छपाई',
      subtitle: 'नक्काशीदार लकड़ी · रंग · कपड़ा',
      intro: 'इन गैलरियों का हर नमूना नक्काशीदार लकड़ी के एक ठप्पे से शुरू होता है, जिसे हाथ से कपड़े पर दबाया जाता है। आगे बढ़िए और मिलिए वस्त्रों से, उन्हें बनाने वाले ठप्पों से, और दोनों के बीच के शिल्प से।',
    },
    bn: {
      kicker: 'একটি ভার্চুয়াল প্রদর্শনী',
      title: 'হাতের ব্লক ছাপা',
      subtitle: 'খোদাই কাঠ · রং · কাপড়',
      intro: 'এই গ্যালারিগুলির প্রতিটি নকশার শুরু খোদাই করা কাঠের একটি ব্লক থেকে, যা হাতে কাপড়ের উপর চেপে ধরা হয়। এগিয়ে চলুন — দেখুন বস্ত্রগুলি, সেগুলি তৈরির ব্লক, আর দুইয়ের মাঝের কারুশিল্প।',
    },
  },
}

export const RECEPTION_WELCOME: { title: string; body: string; i18n?: ContentI18n<'title' | 'body'> } = {
  title: 'Welcome',
  body: 'Follow the central passage to the galleries. Galleries A, B and C open either side of it, the craft court lies beyond the reveal wall, and doorways lead on to Gallery D and the dye-garden courtyard.',
  i18n: {
    hi: {
      title: 'स्वागत है',
      body: 'गैलरियों तक जाने के लिए केंद्रीय गलियारे पर चलें। गैलरी A, B और C इसके दोनों ओर खुलती हैं, शिल्प प्रांगण अनावरण दीवार के पीछे है, और आगे के द्वार गैलरी D और रंग-उद्यान आँगन तक ले जाते हैं।',
    },
    bn: {
      title: 'স্বাগতম',
      body: 'গ্যালারিগুলিতে যেতে কেন্দ্রীয় পথ ধরে চলুন। গ্যালারি A, B ও C এর দুই পাশে খোলে, কারুশিল্প প্রাঙ্গণ উন্মোচন প্রাচীরের ওপারে, আর আরও এগিয়ে দরজাগুলি গ্যালারি D ও রং-বাগান উঠোনে নিয়ে যায়।',
    },
  },
}
