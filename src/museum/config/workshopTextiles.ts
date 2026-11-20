/**
 * THE WORKSHOP'S TEXTILES — twenty hand-block-printed textiles photographed and captioned by the workshop
 * (the deck "HAND BLOCK IMAGES.pptx", one textile per slide), hung in place of twenty of the generated
 * stand-in designs (artworks.ts applies them by `slot`).
 *
 *   images   public/artworks/<slug>.jpg — written by scripts/import-workshop-textiles.mjs from the deck, cropped
 *            exactly as the team cropped each picture on its slide (which also keeps the photo editor's corner
 *            mark out), then given .1024/.2048.webp variants by scripts/optimize-assets.mjs --artworks.
 *   text     `description` is the team's caption, verbatim. `artisan`, `region` and `tradition` are taken from
 *            it; `title` and `alt` name only what the caption and the photograph show. `material` is set only
 *            where the caption names the cloth.
 *   hang     by maker: Khatri Ibrahim Isha's five Ajrakh in Gallery A and on the reveal wall; Giriraj Prasad
 *            Chhipa's Bagru in Gallery B and the craft court and his Dabu in Gallery C; Ramjan's five Balotra
 *            pieces in Gallery D. `fit` resizes a slot's frame box where the stand-in's shape no longer suits.
 */
import type { ContentI18n } from '../i18n/core'

export interface WorkshopTextile {
  /** Slide of the deck (1-based). */
  slide: number
  /** File name under public/artworks (no extension). */
  slug: string
  /** The artwork slot (artworks.ts id) the textile hangs in. */
  slot: string
  title: string
  tradition: 'Ajrakh' | 'Bagru' | 'Dabu'
  artisan: string
  region: string
  technique: string
  material?: string
  /** The team's caption, verbatim. */
  description: string
  alt: string
  i18n: ContentI18n<'title' | 'tradition' | 'region'>
  /** Optional new frame box (m) for the slot. */
  fit?: { maxWidth?: number; maxHeight?: number; centerHeight?: number }
}

const KHATRI = 'Khatri Ibrahim Isha'
const GIRIRAJ = 'Giriraj Prasad Chhipa'
const RAMJAN = 'Ramjan'
const KUTCH = 'Kutch, Gujarat'
const JAIPUR = 'Jaipur, Rajasthan'
const BALOTRA = 'Balotra, Rajasthan'
const AJRAKH_T = 'Hand block printing with resist and mordants; natural dyes'
const BAGRU_T = 'Hand block printing with syahi and begar pastes; natural dyes'
const DABU_T = 'Mud-resist (dabu) hand block printing; natural dyes'

const TRADITION_I18N = {
  Ajrakh: { hi: 'अजरख', bn: 'আজরখ' },
  Bagru: { hi: 'बगरू', bn: 'বাগরু' },
  Dabu: { hi: 'दाबू', bn: 'দাবু' },
} as const
const REGION_I18N: Record<string, { hi: string; bn: string }> = {
  [KUTCH]: { hi: 'कच्छ, गुजरात', bn: 'কচ্ছ, গুজরাট' },
  [JAIPUR]: { hi: 'जयपुर, राजस्थान', bn: 'জয়পুর, রাজস্থান' },
  [BALOTRA]: { hi: 'बालोतरा, राजस्थान', bn: 'বালোতরা, রাজস্থান' },
}

type Row = [
  slide: number,
  slug: string,
  slot: string,
  title: string,
  hi: string,
  bn: string,
  tradition: WorkshopTextile['tradition'],
  artisan: string,
  region: string,
  technique: string,
  material: string | undefined,
  alt: string,
  description: string,
  fit?: WorkshopTextile['fit'],
]

const ROWS: Row[] = [
  // ── Khatri Ibrahim Isha, Kutch — Ajrakh: Gallery A and the reveal wall ──
  [
    1,
    'ajrakh-mihrab-arches',
    'hero-01',
    'Mihrab Arches',
    'मेहराबों की कतार',
    'মেহরাবের সারি',
    'Ajrakh',
    KHATRI,
    KUTCH,
    AJRAKH_T,
    'Cotton',
    'An indigo Ajrakh with a central column of turquoise-and-ochre arches, between bands of star lattice and sawtooth borders.',
    'Crafted by master artisan Khatri Ibrahim Isha of Kutch, Gujarat, this hand-block-printed Ajrakh textile transforms raw cotton into an indigo and earth masterpiece. Its central spine features turquoise-and-ochre mihrab arches with botanical motifs, framed by sawtooth borders and star-and-rosette latticework echoing western Indian sandstone screens. Rooted in a centuries-old ritual of oil-curing, teakwood block-printing with resist and mordants, and repeated indigo dyeing, this piece reflects the precise artistry of Kutch’s desert workshops.',
  ],
  [
    2,
    'ajrakh-madder-pinstripes',
    'feature-03',
    'Madder-Red Pinstripes',
    'मजीठ-लाल महीन धारियाँ',
    'মঞ্জিষ্ঠা-লাল সরু ডোরা',
    'Ajrakh',
    KHATRI,
    KUTCH,
    AJRAKH_T,
    undefined,
    'A red Ajrakh: fine red pinstripes above a dense end panel of medallions and borders, on a black edge.',
    'Crafted by master artisan Khatri Ibrahim Isha of Kutch, Gujarat, this hand-block-printed Ajrakh textile celebrates natural red tones and geometric complexity. The fabric features fine horizontal madder-red pinstripes transitioning into a dense pallu filled with star-like medallions, floral lattices, and mihrab motifs in black, white, and red, framed by sharp kangura borders on charcoal-black edges. Created through the multi-stage Ajrakh resist-printing and natural-dyeing tradition using hand-carved woodblocks, madder, and iron, the piece embodies the ancestral mastery of Kutch’s craft.',
  ],
  [
    3,
    'ajrakh-medallion-pallu',
    'hero-02',
    'Medallion Pallu',
    'पदकों वाला पल्लू',
    'পদক-নকশার আঁচল',
    'Ajrakh',
    KHATRI,
    KUTCH,
    AJRAKH_T,
    undefined,
    'An Ajrakh end panel: a trellis of medallions above rows of teardrop motifs and a fringe of pendants, on a black ground.',
    'Crafted by master artisan Khatri Ibrahim Isha of Kutch, Gujarat, this hand-block-printed Ajrakh textile features geometric medallions, undulating borders, and stylized floral motifs in deep indigo, madder red, and sky-blue against a charcoal-black ground. Its elaborate pallu transitions from a star-and-rosette trellis into rhythmic bands of circular medallions, teardrop foliage, and pendant fringes. Rooted in Kutch’s centuries-old natural-dyeing and resist-printing heritage—using hand-carved teakwood blocks, natural oils, mineral mordants, and fermented indigo and madder baths—this piece exemplifies the precision of traditional Ajrak craftsmanship.',
  ],
  [
    4,
    'ajrakh-star-trellis',
    'feature-01',
    'Star-and-Rosette Trellis',
    'तारे और गुलाब-बूटे की जाली',
    'তারা ও গোলাপ-বুটির জাল',
    'Ajrakh',
    KHATRI,
    KUTCH,
    AJRAKH_T,
    undefined,
    'A close view of Ajrakh: blue-and-ochre rosettes in a star-shaped trellis on a black ground.',
    'Crafted by master artisan Khatri Ibrahim Isha of Kutch, Gujarat, this hand-block-printed Ajrakh textile features dense geometric medallions, undulating borders, and stylized floral butas in deep indigo, madder red, and soft sky-blue against a charcoal-black ground. Its elaborate pallu transitions from a star-and-rosette trellis into rhythmic bands of circular medallions, teardrop foliage, and pendant fringes. Rooted in Kutch\'s centuries-old resist-printing and natural-dyeing heritage—utilizing natural oils, hand-carved teakwood blocks with resist pastes and mineral mordants, and fermented indigo and madder baths—this piece exemplifies the precision and rich tonal layering of traditional Ajrak craftsmanship.',
  ],
  [
    5,
    'ajrakh-indigo-abstraction',
    'feature-04',
    'Indigo Abstraction',
    'नील में अमूर्त रचना',
    'নীলে বিমূর্ত রচনা',
    'Ajrakh',
    KHATRI,
    KUTCH,
    AJRAKH_T,
    undefined,
    'A contemporary Ajrakh: white pinstripes on indigo, crossed by a diagonal band of black stripes and red circles.',
    'Crafted by master artisan Khatri Ibrahim Isha of Kutch, Gujarat, this contemporary Ajrakh piece reimagines traditional geometry through bold architectural abstraction. Set against a deep fermented-indigo ground, stepped columns of resist-printed vertical pinstripes with dark diamond accents frame a diagonal band of charcoal-black stripes and earth-red madder orbs. Rooted in centuries-old natural dyeing and resist-printing traditions—utilizing hand-carved teakwood blocks, mineral mordants, and successive indigo and madder baths—this work showcases the seamless translation of ancestral techniques into modern minimalism.',
  ],

  // ── Giriraj Prasad Chhipa, Jaipur — Bagru: Gallery B and the craft court ──
  [
    6,
    'bagru-cobalt-vines',
    'feature-02',
    'Cobalt Vines',
    'नीली बेलें',
    'নীল লতা',
    'Bagru',
    GIRIRAJ,
    JAIPUR,
    BAGRU_T,
    undefined,
    'Blue vines with red and cream flowers and serrated leaves on a black ground.',
    'Crafted by master artisan Giriraj Prasad Chhipa of Jaipur, Rajasthan, this traditional Bagru hand-block-printed textile features sprawling cobalt-blue vines, madder-red and cream blossoms, and serrated leaves against a charcoal-black (syahi) ground. Rooted in Bagru’s mud-resist (dabu) and natural-dyeing heritage, the fabric is treated with myrobalan (harda) and hand-stamped using carved wooden blocks with iron-jaggery, alum-gum, and clay resist pastes. Through indigo vat immersion, madder root boiling, and sun-drying, the vibrant colors and organic warmth of traditional Bagru printing are brought to life.',
  ],
  [
    7,
    'bagru-ochre-vines',
    'feature-07',
    'Ochre Vines and Pomegranates',
    'गेरुआ बेलें और अनार',
    'গেরুয়া লতা ও ডালিম',
    'Bagru',
    GIRIRAJ,
    JAIPUR,
    BAGRU_T,
    undefined,
    'Ochre-gold vines, white and blue flowers and pomegranates on a black ground.',
    'Crafted by master artisan Giriraj Prasad Chhipa of Jaipur, Rajasthan, this traditional Bagru hand-block-printed textile features a botanical narrative of warm ochre-gold vines, off-white and cobalt-blue blossoms, and pomegranate motifs against a deep charcoal-black (syahi) ground. Rooted in Bagru’s mud-resist (dabu) and natural-dyeing heritage, the fabric is treated with myrobalan (harda), hand-stamped with carved wooden blocks using fermented iron-and-jaggery paste, natural mordants, and clay resist, and sun-dried. Immersion in natural dye baths and washing under the Rajasthan sun reveal the luminous interplay of light and dark, showcasing the mastery of Bagru printing.',
  ],
  [
    8,
    'bagru-peacocks-fish',
    'hero-03',
    'Peacocks and Fish',
    'मोर और मछलियाँ',
    'ময়ূর ও মাছ',
    'Bagru',
    GIRIRAJ,
    JAIPUR,
    BAGRU_T,
    undefined,
    'Off-white peacocks and fish among flourishes on a terracotta-red ground.',
    'Crafted by master artisan Giriraj Prasad Chhipa of Jaipur, this traditional Bagru hand-block-printed textile features stylized peacocks (mor) and schooling fish (machhli) amidst aquatic flourishes in off-white and black against an earthy terracotta-red ground. Rooted in Bagru mud-resist (dabu) and natural-dyeing heritage, the fabric is treated with myrobalan (harda), stamped using carved wooden blocks with fermented iron-and-jaggery paste, natural madder, alum, and clay resist, then sun-washed to reveal the organic warmth and rhythmic artistry of traditional printing.',
  ],
  [
    9,
    'bagru-leaf-canopy',
    'hero-05',
    'Leaf Canopy',
    'पत्तियों का वितान',
    'পাতার চাঁদোয়া',
    'Bagru',
    GIRIRAJ,
    JAIPUR,
    BAGRU_T,
    'Cotton',
    'Overlapping leaves, striped in brick red and outlined in black, on a cream ground.',
    'Crafted by master artisan Giriraj Prasad Chhipa of Jaipur, this Bagru hand-block-printed textile features an organic canopy of overlapping veined leaves (patti) with brick-red stripes and charcoal-black outlines on a cream-beige ground. Rooted in Bagru’s heritage, the cotton is treated with myrobalan (harda), stamped using wooden blocks with iron-jaggery paste (syahi) and alum-gum paste (begar), and boiled in madder root to capture the timeless elegance of traditional hand-stamped printing.',
    // the stand-in was a wide panel (3.0 × 1.3 m): the hero box of Gallery A, so the portrait reads at hero size
    { maxWidth: 1.75, maxHeight: 2.3, centerHeight: 1.75 },
  ],
  [
    10,
    'bagru-sprigs',
    'study-13',
    'Sprigs on Crosshatch',
    'जालीदार ज़मीन पर बूटियाँ',
    'জালি জমিনে বুটি',
    'Bagru',
    GIRIRAJ,
    JAIPUR,
    BAGRU_T,
    'Cotton',
    'Rows of small black sprigs on a crosshatched brick-red and cream ground.',
    'Crafted by master artisan Giriraj Prasad Chhipa of Jaipur, this traditional Bagru hand-block-printed textile features charcoal-black botanical sprigs (buti) set against a crosshatched brick-red and cream-beige ground. Rooted in centuries-old heritage, the raw cotton is treated with myrobalan (harda), stamped using carved wooden blocks with alum-and-gum paste (begar) and fermented iron-and-jaggery paste (syahi), and finished through natural madder root boiling and sun-washing.',
  ],

  // ── Giriraj Prasad Chhipa, Jaipur — Dabu: Gallery C ──
  [
    11,
    'dabu-indigo-lattice',
    'study-14',
    'Indigo Lattice',
    'नील जाली',
    'নীল জাফরি',
    'Dabu',
    GIRIRAJ,
    JAIPUR,
    DABU_T,
    undefined,
    'A white lattice enclosing indigo diamonds and pale blue rosettes.',
    'Crafted by master artisan Giriraj Prasad Chhipa of Jaipur, this traditional Dabu hand-block-printed textile features an undulating off-white lattice enclosing deep indigo diamonds and sky-blue floral rosettes. Rooted in Rajasthan’s mud-resist heritage, the process involves stamping a clay and natural gum paste using hand-carved blocks, dusting with sawdust, and multiple immersions in natural indigo vats. Sun-washing removes the resist to reveal crisp white outlines and layered tonal blues with organic veining, celebrating the tactile craft of earth, water, and indigo.',
  ],
  [
    12,
    'dabu-crimson-jaal',
    'hero-04',
    'Crimson Floral Jaal',
    'लाल फूलों का जाल',
    'লাল ফুলের জাল',
    'Dabu',
    GIRIRAJ,
    JAIPUR,
    DABU_T,
    undefined,
    'A dense pattern of crimson and rose flowers with curling leaves.',
    'Crafted by master artisan Giriraj Prasad Chhipa of Jaipur, Rajasthan, this traditional Dabu hand-block-printed textile features a dense floral tapestry (jaal) of crimson and rose blossoms with curling foliage. Rooted in centuries-old mud-resist heritage, the artisan stamps a clay and gum paste (dabu) onto the cloth using hand-carved blocks, dusts it with sawdust, and dyes it in natural madder baths. Sun-washing removes the resist, revealing crisp off-white contours and organic crackle veining that celebrate traditional earth and botanical pigments.',
    // the stand-in was a tall narrow panel (1.2 × 2.7 m): the hero box of Gallery A
    { maxWidth: 1.75, maxHeight: 2.3 },
  ],
  [
    13,
    'dabu-lotus-rows',
    'feature-05',
    'Indigo Lotus Rows',
    'नील कमल की पंक्तियाँ',
    'নীল পদ্মের সারি',
    'Dabu',
    GIRIRAJ,
    JAIPUR,
    DABU_T,
    undefined,
    'Rows of indigo and blue lotus flowers, buds and stems on a crackled off-white ground.',
    'Crafted by master artisan Giriraj Prasad Chhipa of Jaipur, Rajasthan, this traditional Dabu hand-block-printed textile features rhythmic rows of deep indigo and cerulean-blue lotus blossoms, buds, and leafy stems against a crackled off-white ground. Using Rajasthan’s centuries-old mud-resist technique, the artisan stamps a local clay and chaff paste onto the cloth with hand-carved blocks, dusting it with sawdust to prevent smudging. Multiple natural indigo vat immersions and sun-washings remove the resist, revealing crisp off-white details and tonal blues with organic crackle veining.',
  ],
  [
    14,
    'dabu-indigo-waves',
    'study-15',
    'Indigo Waves',
    'नील लहरें',
    'নীল ঢেউ',
    'Dabu',
    GIRIRAJ,
    JAIPUR,
    DABU_T,
    undefined,
    'Wavy white bands edged with dots, enclosing indigo and pale blue rosettes.',
    'Crafted by master artisan Giriraj Prasad Chhipa of Jaipur, this traditional Dabu hand-block-printed textile features undulating off-white wavy bands bordered by teardrop dots enclosing deep indigo and sky-blue floral rosettes. Rooted in Rajasthan’s mud-resist heritage, the process involves stamping a clay-and-gum paste (dabu) onto cloth using hand-carved blocks, dusting with sawdust, and immersing in natural indigo vats. Sun-washing removes the dried resist, revealing crisp white contours and layered tonal blues that celebrate traditional craftsmanship.',
  ],
  [
    15,
    'dabu-olive-sunbursts',
    'study-09',
    'Olive Crosses and Sunbursts',
    'जैतूनी क्रॉस और सूर्य-फूल',
    'জলপাই-রঙা ক্রস ও সূর্যফুল',
    'Dabu',
    GIRIRAJ,
    JAIPUR,
    DABU_T,
    undefined,
    'Olive-green crosses and sunburst flowers in a grid on a crackled off-white ground.',
    'Handcrafted by master artisan Giriraj Prasad Chhipa of Jaipur using traditional Dabu mud-resist printing, this textile features a botanical grid of olive-green cross motifs and sunburst floral medallions against a crackled off-white ground. Created by stamping a clay-and-gum paste onto fabric with wooden blocks, dusting it with sawdust, and dyeing it in natural botanical baths like pomegranate or myrobalan and indigo, the process culminates in sun-washing to remove the resist, revealing crisp negative space and organic crackle veining.',
  ],

  // ── Ramjan, Balotra — Dabu: Gallery D ──
  [
    16,
    'balotra-madder-medallion',
    'feature-08',
    'Madder Medallion',
    'मजीठ में मध्य-पदक',
    'মঞ্জিষ্ঠায় কেন্দ্রীয় পদক',
    'Dabu',
    RAMJAN,
    BALOTRA,
    DABU_T,
    undefined,
    'A square cloth in madder red, black and cream: a central square with four round medallions, a diamond trellis and layered borders.',
    'Crafted by master artisan Ramjan of Balotra, Rajasthan, this monumental Dabu hand-block-printed textile features a four-quadrant central medallion with concentric floral mandalas, a dense diagonal diamond trellis (jaal) of star-and-rosette motifs, and multi-tiered floral and sawtooth borders (kangura) in madder red, charcoal black, and warm blush-cream. Rooted in Balotra\'s Luni River mud-resist and natural-dyeing tradition, the fabric is hand-stamped using carved wooden blocks with a sun-dried dabu paste dusted with sawdust, syahi black outlines, and alum mordants for deep madder red. Subsequent dye baths and desert sun washings strip away the resist to reveal complex, balanced geometry that captures Balotra\'s enduring block-printing heritage.',
  ],
  [
    17,
    'balotra-indigo-chaupar',
    'feature-10',
    'Indigo Chaupar',
    'नील में चौपड़',
    'নীলে চৌপড়',
    'Dabu',
    RAMJAN,
    BALOTRA,
    DABU_T,
    undefined,
    'A square indigo cloth: a red cross-shaped centre with four round medallions, a star trellis and layered borders.',
    'Crafted by master artisan Ramjan of Balotra, Rajasthan, this monumental Dabu hand-block-printed textile features a commanding architectural composition with a four-quadrant central square (chaupar) and four concentric circular floral mandalas against an indigo ground. A dense diagonal trellis (jaal) of star-and-rosette medallions is framed by multi-tiered floral, paisley, and white sawtooth borders (kangura) in indigo, madder red, sage green, and off-white. Rooted in Balotra\'s Luni River lineage, the fabric is hand-stamped using carved wooden blocks with a mud-resist paste (dabu), natural mordants, and repeated indigo and madder baths. Sun-washing reveals a rich interplay of color and geometry, showcasing the precision of Balotra’s block-printing heritage.',
  ],
  [
    18,
    'balotra-vine-stripes',
    'tri-01',
    'Vine Stripes',
    'बेल की धारियाँ',
    'লতার ডোরা',
    'Dabu',
    RAMJAN,
    BALOTRA,
    DABU_T,
    undefined,
    'Vertical wavy ochre vine stripes with red buds between pinstripes, on an indigo-teal ground.',
    'Crafted by master artisan Ramjan of Balotra, Rajasthan, this Dabu hand-block-printed textile features rustic linear ornamentation on a deep indigo-teal ground. An ornamental multi-stripe border showcases four vertical, undulating ochre-yellow vine stripes (bail) with madder red buds and circular accents, framed by straight pinstripes of ochre, red, and navy-black. Created using historic mud-resist and natural-dyeing techniques along the Luni River, this piece reflects Ramjan\'s desert craftsmanship.',
  ],
  [
    19,
    'balotra-arch-lotus',
    'tri-02',
    'Arch and Lotus',
    'मेहराब और कमल',
    'খিলান ও পদ্ম',
    'Dabu',
    RAMJAN,
    BALOTRA,
    DABU_T,
    undefined,
    'Twin ochre-and-black arch and lotus motifs with dotted rays, on a forest-teal ground.',
    'Crafted by master artisan Ramjan of Balotra, Rajasthan, this Dabu hand-block-printed textile features bold geometry on a deep forest-teal green ground. Printed with hand-carved wooden blocks in warm ochre-yellow and charcoal-black (syahi), the design centers on twin stylized triangular arch and lotus motifs framed by dotted diagonal rays and kangura borders. Rooted in Balotra\'s Luni River mud-resist lineage, the fabric uses a local clay and dabu resist paste, natural mineral mordants, and botanical dye baths, sun-dried to capture Ramjan\'s desert craftsmanship.',
  ],
  [
    20,
    'balotra-buti',
    'tri-03',
    'Buti on Indigo-Teal',
    'नील-हरी ज़मीन पर बूटियाँ',
    'নীল-সবুজ জমিনে বুটি',
    'Dabu',
    RAMJAN,
    BALOTRA,
    DABU_T,
    'Cotton',
    'Rows of small reddish-ochre buti motifs on a textured indigo-teal ground.',
    'Crafted by master artisan Ramjan of Balotra, Rajasthan, this traditional Dabu hand-block-printed textile features minimalist repeat patterns on a textured, deep indigo-teal natural cotton ground. Adorned with horizontal rows of small, hand-stamped ovoid or leaf-like buti motifs in reddish-ochre with yellow-orange grid and dot patterns, the piece reflects Balotra\'s historic mud-resist and natural-dyeing lineage along the Luni River. Using a sun-dried local clay resist (dabu) and mineral mordants, the fabric is steeped in fermented indigo and botanical dye baths. Repeated sun-washing removes the dried mud, highlighting the tonal contrast between the red-speckled motifs and the uneven blue-green background.',
  ],
]

export const WORKSHOP_TEXTILES: WorkshopTextile[] = ROWS.map(
  ([slide, slug, slot, title, hi, bn, tradition, artisan, region, technique, material, alt, description, fit]) => ({
    slide,
    slug,
    slot,
    title,
    tradition,
    artisan,
    region,
    technique,
    ...(material ? { material } : {}),
    description,
    alt,
    i18n: {
      hi: { title: hi, tradition: TRADITION_I18N[tradition].hi, region: REGION_I18N[region].hi },
      bn: { title: bn, tradition: TRADITION_I18N[tradition].bn, region: REGION_I18N[region].bn },
    },
    ...(fit ? { fit } : {}),
  }),
)

export const workshopTextileForSlot = (slot: string) => WORKSHOP_TEXTILES.find((t) => t.slot === slot)
