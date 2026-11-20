/**
 * TEXTILES FROM MUSEUM OPEN-ACCESS COLLECTIONS — documented Indian printed textiles, every image CC0 / public
 * domain (checked object by object through each museum's own API), hung in the twenty-one slots the workshop's
 * own textiles (workshopTextiles.ts) do not fill. artworks.ts applies them by `slot`.
 *
 *   images   public/artworks/<slug>.jpg — written by scripts/import-sourced-textiles.mjs from the museum's file
 *            (`source.image`), cut to `crop` (the cloth inside the photographer's backdrop; pixels of that file)
 *            where one is given, sRGB, long edge ≤ 2600 px; then scripts/optimize-assets.mjs --artworks.
 *   text     `title` is the museum's title, verbatim; `date`, `region`, `technique` and `size` come from its record
 *            (`technique` in the record's own words). `description` and `alt` say only what the record says and the
 *            photograph shows: "block-printed" only where the record does. Fragments hang larger than life; the
 *            info panel gives their real size. No maker is named: none is recorded.
 *   credit   collection, object number, credit line, licence and the record's address, shown under "Details".
 */
import type { ContentI18n } from '../i18n/core'

export type Museum = 'aic' | 'cma' | 'chsdm'
export const MUSEUMS: Record<Museum, { name: string; licence: string }> = {
  aic: { name: 'Art Institute of Chicago', licence: 'CC0 1.0 (public domain)' },
  cma: { name: 'The Cleveland Museum of Art', licence: 'CC0 1.0 (public domain)' },
  chsdm: { name: 'Cooper Hewitt, Smithsonian Design Museum', licence: 'CC0 1.0 (Smithsonian Open Access)' },
}

export interface SourcedTextile {
  slot: string
  /** File name under public/artworks: museum code + object number. */
  slug: string
  title: string
  /** Short technique line for the wall label (from the record). */
  tradition: string
  technique: string
  material: string
  date: string
  region: string
  size: string
  description: string
  alt: string
  source: { museum: Museum; accession: string; record: string; image: string; credit: string }
  /** The cloth inside the photographer's backdrop, in pixels of `source.image`. */
  crop?: { left: number; top: number; width: number; height: number }
  i18n: ContentI18n<'title' | 'region'>
}

const T = {
  'Heirloom Textile': ['पुश्तैनी वस्त्र', 'উত্তরাধিকারের বস্ত্র'],
  'Prayer Mat': ['नमाज़ की चटाई', 'জায়নামাজ'],
  "Sacred Heirloom Textile (mawa or ma'a)": ['पवित्र पुश्तैनी वस्त्र (मावा या मा’आ)', 'পবিত্র উত্তরাধিকারের বস্ত্র (মাওয়া বা মা’আ)'],
  'Chintz fragment': ['छींट का टुकड़ा', 'ছিটের টুকরো'],
  Fragment: ['टुकड़ा', 'টুকরো'],
  Hanging: ['टाँगने का वस्त्र', 'দেয়ালে ঝোলানোর বস্ত্র'],
  Textile: ['वस्त्र', 'বস্ত্র'],
  Panel: ['पैनल', 'প্যানেল'],
  "Fragment of Mawa' or Ma'a (Sacred Heirloom Textile)": ['मावा या मा’आ (पवित्र पुश्तैनी वस्त्र) का टुकड़ा', 'মাওয়া বা মা’আ (পবিত্র উত্তরাধিকারের বস্ত্র)-র টুকরো'],
} as const
const R = {
  India: ['भारत', 'ভারত'],
  'Gujarat, India': ['गुजरात, भारत', 'গুজরাট, ভারত'],
  'Jaipur, Rajasthan, India': ['जयपुर, राजस्थान, भारत', 'জয়পুর, রাজস্থান, ভারত'],
  'Probably India': ['संभवतः भारत', 'সম্ভবত ভারত'],
  'India; used in Fustat, Egypt': ['भारत; फ़ुस्तात, मिस्र में प्रयुक्त', 'ভারত; ফুস্তাত, মিশরে ব্যবহৃত'],
} as const

type Row = Omit<SourcedTextile, 'i18n' | 'title' | 'region'> & { title: keyof typeof T; region: keyof typeof R }

const AIC_IIIF = (id: string, w = 3000) => `https://www.artic.edu/iiif/2/${id}/full/${w},/0/default.jpg`
const CMA_PRINT = (acc: string) => `https://openaccess-cdn.clevelandart.org/${acc}/${acc}_print.jpg`
const SI = (id: string) => `https://ids.si.edu/ids/download?id=${id}`

const ROWS: Row[] = [
  // ══ Grand Atrium ═══
  {
    slot: 'feature-13',
    slug: 'aic-2015-586',
    title: 'Heirloom Textile',
    tradition: 'Block-printed, resist-dyed',
    technique: 'Cotton, plain woven, block printed and resist-dyed; two loom widths joined, all selvages present',
    material: 'Cotton',
    date: '15th century',
    region: 'India',
    size: '267.3 × 188 cm',
    description:
      'A 15th-century cotton cloth from India that the Art Institute of Chicago records as block printed and resist-dyed, made of two loom widths joined with all selvages present. A red field of stepped, cross-shaped medallions in a lattice is framed by patterned bands and plain red ends.',
    alt: 'Large red cotton cloth with rows of stepped cream-outlined medallions, patterned side panels and plain red ends.',
    source: { museum: 'aic', accession: '2015.586', record: 'https://www.artic.edu/artworks/220750', image: AIC_IIIF('db4df7b4-20c6-472d-2830-af60731e672a'), credit: 'Gift of Robert T. Coffland in memory of Mary Hunt Kahlenberg' },
    crop: { left: 107, top: 101, width: 2754, height: 1814 },
  },
  // ══ Craft court ═══
  {
    slot: 'feature-06',
    slug: 'cma-1937-581',
    title: 'Prayer Mat',
    tradition: 'Block-printed and painted',
    technique: 'Block printed and painted quilted cotton',
    material: 'Quilted cotton',
    date: 'early 1800s',
    region: 'India',
    size: '85.8 × 125.7 cm',
    description:
      'A quilted cotton prayer mat from India dated to the early 1800s, which the Cleveland Museum of Art records as block printed and painted. A pale central field with a floral medallion and scattered teardrop-shaped motifs is framed by several printed floral borders.',
    alt: 'Rectangular quilted mat with a pale field, a central floral medallion, scattered teardrop motifs and layered floral borders.',
    source: { museum: 'cma', accession: '1937.581', record: 'https://clevelandart.org/art/1937.581', image: CMA_PRINT('1937.581'), credit: 'Gift of Marion A. Parsons' },
    crop: { left: 37, top: 75, width: 3310, height: 2291 },
  },
  {
    slot: 'runner-01',
    slug: 'aic-2008-667',
    title: "Sacred Heirloom Textile (mawa or ma'a)",
    tradition: 'Block-printed, resist and mordant dyed',
    technique: 'Cotton, plain weave; block printed resist and mordant dyed',
    material: 'Cotton',
    date: '14th/15th century',
    region: 'India',
    size: '489 × 95.6 cm',
    description:
      "A long cotton cloth from India dated 14th/15th century, which the Art Institute of Chicago titles a sacred heirloom textile (mawa or ma'a) and records as block printed, resist and mordant dyed. Rows of blue and cream oval medallions on a deep red ground run its full 4.9-metre length between narrow patterned borders and end bands.",
    alt: 'Very long cotton cloth patterned with rows of blue and cream oval medallions on a deep red ground.',
    source: { museum: 'aic', accession: '2008.667', record: 'https://www.artic.edu/artworks/194713', image: AIC_IIIF('1dc3d9c4-80fc-2823-dae3-f806d8343998'), credit: 'Purchased with funds provided by the Alsdorf Foundation; James and Marilynn Alsdorf Acquisition Fund' },
    crop: { left: 51, top: 30, width: 2907, height: 582 },
  },
  {
    slot: 'panel-02',
    slug: 'chsdm-1962-175-14',
    title: 'Fragment',
    tradition: 'Block-printed',
    technique: 'Block-printed on plain weave',
    material: 'Cotton',
    date: 'late 18th–early 19th century',
    region: 'Jaipur, Rajasthan, India',
    size: '47 × 25.5 cm',
    description:
      'A cotton fragment made in Jaipur, Rajasthan, in the late 18th–early 19th century, block-printed in purple, brown, red and green on a cream ground. Cooper Hewitt describes the all-over pattern as a stylized floral form resembling pansies; it appears here as staggered rows of curling, teardrop-shaped sprays.',
    alt: 'Cream cotton printed with staggered rows of purple teardrop-shaped floral sprays.',
    source: { museum: 'chsdm', accession: '1962-175-14', record: 'https://collection.cooperhewitt.org/view/objects/asitem/id/132058', image: SI('CHSDM-8452BD8879F72-000001.jpg'), credit: 'Gift of Nasli Heeramaneck' },
    crop: { left: 344, top: 64, width: 1786, height: 4154 },
  },
  {
    slot: 'panel-03',
    slug: 'chsdm-1962-175-9',
    title: 'Fragment',
    tradition: 'Block-printed',
    technique: 'Block-printed on plain weave',
    material: 'Cotton',
    date: 'late 18th–early 19th century',
    region: 'Jaipur, Rajasthan, India',
    size: '49.2 × 28 cm',
    description:
      'A cotton fragment made in Jaipur, Rajasthan, in the late 18th–early 19th century, block-printed in red, green, black and touches of brown on a rose ground. Cooper Hewitt describes an all-over pattern of a stylized floral form, with a small border stripe of black dots.',
    alt: 'Rose-pink cotton printed with dense rows of small dark floral sprays above a dotted border stripe.',
    source: { museum: 'chsdm', accession: '1962-175-9', record: 'https://collection.cooperhewitt.org/view/objects/asitem/id/132066', image: SI('CHSDM-BDF9B1CC4E362-000001.jpg'), credit: 'Gift of Nasli Heeramaneck' },
    crop: { left: 429, top: 128, width: 1892, height: 4401 },
  },
  // ══ Gallery A ═══
  {
    slot: 'panel-01',
    slug: 'chsdm-1973-51-9',
    title: 'Chintz fragment',
    tradition: 'Chintz: block-printed and painted',
    technique: 'Block-printed for outlines and imbricated background with mordant painted over resist for fillings (chintz) on plain weave',
    material: 'Cotton',
    date: '1750–1800',
    region: 'Probably India',
    size: '21 × 56.5 cm',
    description:
      'A chintz fragment probably made in India in 1750–1800; Cooper Hewitt records its outlines and imbricated background as block-printed, with mordant painted over resist for the fillings. Curving floral stems sit on white islands against a background of red ribbons and picotage.',
    alt: 'Tall strip of white cotton with curving red and blue floral stems among wavy red ribbons.',
    source: { museum: 'chsdm', accession: '1973-51-9', record: 'https://collection.cooperhewitt.org/view/objects/asitem/id/151808', image: SI('CHSDM-19D94367D0B92-000001.jpg'), credit: 'Gift of Josephine Howell' },
    crop: { left: 61, top: 9, width: 2136, height: 5804 },
  },
  {
    slot: 'study-04',
    slug: 'cma-1925-491',
    title: 'Fragment',
    tradition: 'Resist-printed',
    technique: 'Resist printed cotton',
    material: 'Cotton',
    date: '1800s',
    region: 'India',
    size: '48.3 × 69.9 cm',
    description:
      'A 19th-century cotton fragment from India, recorded by the Cleveland Museum of Art as resist printed. Small red motifs in a fine trellis cover a white ground above a deep red border band with a running floral pattern.',
    alt: 'White cotton with a tiny red trellis pattern above a deep red floral border.',
    source: { museum: 'cma', accession: '1925.491', record: 'https://clevelandart.org/art/1925.491', image: CMA_PRINT('1925.491'), credit: 'Purchase from the J. H. Wade Fund' },
    crop: { left: 103, top: 29, width: 3250, height: 2321 },
  },
  {
    slot: 'study-03',
    slug: 'aic-1957-518',
    title: 'Panel',
    tradition: 'Woodblock printed',
    technique: 'Cotton; woodblock printed',
    material: 'Cotton',
    date: '19th century',
    region: 'India',
    size: '29.7 × 35.5 cm',
    description:
      'A small 19th-century cotton panel from India, recorded by the Art Institute of Chicago as woodblock printed. Pink and grey-green animals, a horse and rider, birds and flowering plants are scattered across a cream ground.',
    alt: 'Cream cotton printed with pink and grey animals, a horse and rider, birds and flowering trees.',
    source: { museum: 'aic', accession: '1957.518', record: 'https://www.artic.edu/artworks/6693', image: AIC_IIIF('d98382ed-e302-92d9-6366-6ab44171a368'), credit: 'Gift of Mrs. Murray M. Fuchsmann in memory of her mother, Bertha Stenge' },
    crop: { left: 170, top: 146, width: 2711, height: 2244 },
  },
  // salon hang (Gallery A, south partition)
  {
    slot: 'salon-01',
    slug: 'chsdm-1939-13-6',
    title: 'Fragment',
    tradition: 'Resist-printed',
    technique: 'Resist-printed on plain weave',
    material: 'Cotton',
    date: '14th–15th century',
    region: 'India',
    size: '18.2 × 17.9 cm',
    description:
      'A small cotton fragment made in India in the 14th–15th century, recorded by Cooper Hewitt as resist-printed. Rosettes sit within squares formed by diagonally crossing lines and dots, reserved pale on a blue ground.',
    alt: 'Ragged blue cotton fragment with a pale lattice of small rosettes.',
    source: { museum: 'chsdm', accession: '1939-13-6', record: 'https://collection.cooperhewitt.org/view/objects/asitem/id/70079', image: SI('CHSDM-B29F4AFEF6D62-000001.jpg'), credit: 'Purchased, The Au Panier Fleuri Fund' },
  },
  {
    slot: 'salon-02',
    slug: 'cma-1926-166',
    title: 'Fragment',
    tradition: 'Printed',
    technique: 'Printed cotton',
    material: 'Cotton',
    date: 'early 1800s',
    region: 'India',
    size: '72.4 × 50.2 cm',
    description:
      'An early 19th-century cotton fragment from India, recorded by the Cleveland Museum of Art as printed cotton. Small red flowering sprigs are set in staggered rows on a white ground above a plain lower edge.',
    alt: 'White cotton with neat staggered rows of small red flowering sprigs.',
    source: { museum: 'cma', accession: '1926.166', record: 'https://clevelandart.org/art/1926.166', image: CMA_PRINT('1926.166'), credit: 'Gift of Kenneth de B. Codrington' },
    crop: { left: 89, top: 80, width: 2244, height: 3196 },
  },
  {
    slot: 'salon-03',
    slug: 'aic-2011-271',
    title: "Fragment of Mawa' or Ma'a (Sacred Heirloom Textile)",
    tradition: 'Block-printed, resist and mordant dyed',
    technique: 'Cotton, plain weave; block printed resist and mordant dyed',
    material: 'Cotton',
    date: 'late 14th or 15th century',
    region: 'Gujarat, India',
    size: '121.9 × 94.5 cm',
    description:
      "A fragment of a sacred heirloom textile (mawa' or ma'a) from India, late 14th or 15th century, recorded as block printed, resist and mordant dyed. The Art Institute of Chicago notes it was made in Gujarat for the Indonesian market and radiocarbon-dated to between 1382 and 1502; a block-printed group of a seated figure with three attendants repeats in rows across the red ground.",
    alt: 'Red cotton fragment printed with rows of small repeated figure groups and a patterned side border.',
    source: { museum: 'aic', accession: '2011.271', record: 'https://www.artic.edu/artworks/212379', image: AIC_IIIF('baf55115-4298-0db5-2887-166bf28f9a05', 2890), credit: 'Belle M. Borland Estate; Marie Walters Endowment Fund; The Christa C. Mayer Thurman Textile Endowment' },
    crop: { left: 61, top: 43, width: 2820, height: 2167 },
  },
  {
    slot: 'salon-04',
    slug: 'cma-1951-518',
    title: 'Fragment',
    tradition: 'Stamped resist, mordant dyed',
    technique: 'Stamped resist, applied mordant, dyed; cotton',
    material: 'Cotton',
    date: '1400s (?)',
    region: 'India',
    size: '17.8 × 11.5 cm',
    description:
      'A small cotton fragment from India dated "1400s (?)", recorded by the Cleveland Museum of Art as stamped resist with applied mordant, dyed. A bold grid of nested squares, crosses and quatrefoils is reserved pale on a rose-red ground.',
    alt: 'Rose-red fragment with a pale pattern of nested squares and quatrefoils.',
    source: { museum: 'cma', accession: '1951.518', record: 'https://clevelandart.org/art/1951.518', image: CMA_PRINT('1951.518'), credit: 'Purchase from the J. H. Wade Fund' },
  },
  {
    slot: 'salon-05',
    slug: 'cma-1925-685',
    title: 'Fragment',
    tradition: 'Block-printed gold leaf (varak)',
    technique: 'Block printed with gold leaf (varak) on dark blue dyed plain weave cotton muslin',
    material: 'Cotton muslin',
    date: '1800s',
    region: 'India',
    size: '17.2 × 17.8 cm',
    description:
      'A 19th-century fragment of dark blue cotton muslin from India, block printed with gold leaf (varak) according to the Cleveland Museum of Art. Small gold flowering sprigs are spaced in rows across the deep blue ground.',
    alt: 'Deep navy muslin with rows of small gold flowering sprigs.',
    source: { museum: 'cma', accession: '1925.685', record: 'https://clevelandart.org/art/1925.685', image: CMA_PRINT('1925.685'), credit: 'Purchase from the J. H. Wade Fund' },
  },
  {
    slot: 'salon-06',
    slug: 'chsdm-1968-73-2',
    title: 'Fragment',
    tradition: 'Block-printed',
    technique: 'Block printed on plain weave',
    material: 'Cotton',
    date: '19th century',
    region: 'India',
    size: '49 × 49 cm',
    description:
      'A round 19th-century cotton fragment made in India, block printed in reds, violet and green on a cream ground (Cooper Hewitt). Flower heads fill the circle around a central rosette medallion.',
    alt: 'Circular cream cotton piece printed with red and violet flowers around a central rosette.',
    source: { museum: 'chsdm', accession: '1968-73-2', record: 'https://collection.cooperhewitt.org/view/objects/asitem/id/143873', image: SI('CHSDM-76EEBCC599802-000001.jpg'), credit: 'Gift of Alice B. Beer' },
  },
  {
    slot: 'salon-07',
    slug: 'chsdm-1902-1-975',
    title: 'Fragment',
    tradition: 'Block-printed, mordant and immersion dyed',
    technique: 'Plain weave; block printed using mordants and immersion dyeing',
    material: 'Cotton',
    date: '18th century',
    region: 'India',
    size: '35.6 × 25.7 cm',
    description:
      'An 18th-century cotton fragment made in India, block printed using mordants and immersion dyeing (Cooper Hewitt). Poppy-like plants stand in staggered rows on a red ground with white dots.',
    alt: 'Red cotton with white dots and staggered rows of tall poppy-like plants.',
    source: { museum: 'chsdm', accession: '1902-1-975', record: 'https://collection.cooperhewitt.org/view/objects/asitem/id/12228', image: SI('CHSDM-1902-1-975MattFlynn.jpg'), credit: 'Gift of John Pierpont Morgan' },
    crop: { left: 513, top: 126, width: 1890, height: 2772 },
  },
  // ══ Gallery D ═══
  {
    slot: 'feature-09',
    slug: 'chsdm-1968-135-92',
    title: 'Hanging',
    tradition: 'Block-printed mordants, madder dyed',
    technique: 'Plain weave foundation; mordants for black, two reds, and lavender were block printed; madder dyed; yellow and blue applied by brush',
    material: 'Cotton',
    date: '19th century',
    region: 'India',
    size: '193 × 139.7 cm',
    description:
      'A 19th-century cotton hanging made in India; Cooper Hewitt records that its mordants for black, two reds and lavender were block printed and madder dyed, with yellow and blue applied by brush. A cypress tree rises from a mound inside a niche arch, a peacock on either side, in a field of flowers framed by deep flowering-vine borders.',
    alt: 'Hanging with a niche arch containing a tall cypress tree and two peacocks, surrounded by wide floral borders.',
    source: { museum: 'chsdm', accession: '1968-135-92', record: 'https://collection.cooperhewitt.org/view/objects/asitem/id/142760', image: SI('CHSDM-1968-135-92MattFlynn.jpg'), credit: 'Gift of Harvey Smith' },
    crop: { left: 507, top: 198, width: 1917, height: 2607 },
  },
  {
    slot: 'feature-11',
    slug: 'chsdm-1953-90-21',
    title: 'Textile',
    tradition: 'Chintz: block-printed and painted',
    technique: 'Block printed and painted (chintz)',
    material: 'Cotton',
    date: '19th century',
    region: 'India',
    size: '257 × 130 cm',
    description:
      'A 19th-century cotton panel made in India, recorded by Cooper Hewitt as block printed and painted (chintz). A flowered curtain drapes over a wine party of four large figures in flowered robes, with a small flowering tree beside a pool, framed by a wide scrolling floral border on a blue ground.',
    alt: 'Printed panel showing four robed figures at a wine party beneath a draped curtain, framed by a blue floral border.',
    source: { museum: 'chsdm', accession: '1953-90-21', record: 'https://collection.cooperhewitt.org/view/objects/asitem/id/109635', image: SI('CHSDM-F2F1E504590E2-000001.jpg'), credit: 'Gift of Elizabeth Riefstahl' },
    crop: { left: 30, top: 30, width: 7348, height: 9898 },
  },
  {
    slot: 'feature-12',
    slug: 'aic-2015-590',
    title: 'Heirloom Textile',
    tradition: 'Block-printed, resist-dyed',
    technique: 'Cotton, plain weave, block printed and resist-dyed',
    material: 'Cotton',
    date: '17th/18th century',
    region: 'India',
    size: '248.9 × 133.7 cm',
    description:
      'A cotton heirloom textile from India dated 17th/18th century, recorded by the Art Institute of Chicago as block printed and resist-dyed. A dark blue-green central field of red rosettes and stars is flanked by broad panels of patterned vertical stripes and red ends.',
    alt: 'Cloth with a dark blue-green centre of red rosettes between broad panels of patterned vertical stripes.',
    source: { museum: 'aic', accession: '2015.590', record: 'https://www.artic.edu/artworks/220754', image: AIC_IIIF('cdac83f3-9180-f61c-66c7-e6b69df8c028'), credit: 'Gift of Robert T. Coffland in memory of Mary Hunt Kahlenberg' },
    crop: { left: 98, top: 115, width: 2788, height: 1505 },
  },
  // ══ Reception ═══
  {
    slot: 'study-11',
    slug: 'chsdm-1939-13-16',
    title: 'Fragment',
    tradition: 'Resist-printed',
    technique: 'Resist-printed on plain weave',
    material: 'Cotton',
    date: '14th–15th century',
    region: 'India; used in Fustat, Egypt',
    size: '17.7 × 22.5 cm',
    description:
      'A border fragment of fine cotton made in India in the 14th–15th century and used in Fustat, Egypt, recorded by Cooper Hewitt as resist-printed. White designs on a dark blue ground run in horizontal bands: a vine motif and geometric ornament of small white squares with blue centres.',
    alt: 'Torn dark blue cotton border with white vine and dotted-diamond bands.',
    source: { museum: 'chsdm', accession: '1939-13-16', record: 'https://collection.cooperhewitt.org/view/objects/asitem/id/70074', image: SI('CHSDM-ED81DEE77B1F2-000001.jpg'), credit: 'Purchased, The Au Panier Fleuri Fund' },
  },
  {
    slot: 'study-16',
    slug: 'chsdm-1953-186-11',
    title: 'Panel',
    tradition: 'Block-printed and painted',
    technique: 'Block printed and painted on plain weave',
    material: 'Quilted cotton',
    date: '18th century',
    region: 'India',
    size: '117 × 80 cm',
    description:
      'An 18th-century quilted cotton panel made in India, block printed and painted in red, dark purple, blue and gold on an undyed ground (Cooper Hewitt). Flowering sprays with small birds, corner spandrels and a central arabesque medallion fill the field, framed by wide floral borders.',
    alt: 'Rectangular panel with a cream floral field, central medallion and wide red floral borders.',
    source: { museum: 'chsdm', accession: '1953-186-11', record: 'https://collection.cooperhewitt.org/view/objects/asitem/id/108790', image: SI('CHSDM-1953-186-11MattFlynn.jpg'), credit: 'Gift of Mary E. Dreier from the estate of Katherine S. Dreier' },
    crop: { left: 8, top: 35, width: 2017, height: 2904 },
  },
  {
    slot: 'study-12',
    slug: 'chsdm-1962-175-8',
    title: 'Textile',
    tradition: 'Block-printed',
    technique: 'Block printed',
    material: 'Cotton',
    date: 'late 18th–early 19th century',
    region: 'Jaipur, Rajasthan, India',
    size: '61.3 × 48.3 cm',
    description:
      'A cotton fragment made in Jaipur in the late 18th–early 19th century, block printed in red and green on a light green ground (Cooper Hewitt). A stylized poppy plant repeats in rows, with one border stripe of small flowers on white.',
    alt: 'Light green cotton with rows of small red-flowered plants and a narrow floral border.',
    source: { museum: 'chsdm', accession: '1962-175-8', record: 'https://collection.cooperhewitt.org/view/objects/asitem/id/132065', image: SI('CHSDM-31D1B20953822-000001.jpg'), credit: 'Gift of Nasli Heeramaneck' },
  },
]

export const SOURCED_TEXTILES: SourcedTextile[] = ROWS.map((r) => ({
  ...r,
  i18n: { hi: { title: T[r.title][0], region: R[r.region][0] }, bn: { title: T[r.title][1], region: R[r.region][1] } },
}))

/** The info panel's "Details": where the piece is, how it may be used, and its real size. */
export function sourcedMetadata(t: SourcedTextile): Record<string, string> {
  return {
    Collection: MUSEUMS[t.source.museum].name,
    'Object number': t.source.accession,
    Size: t.size,
    Credit: t.source.credit,
    'Image licence': MUSEUMS[t.source.museum].licence,
    Record: t.source.record,
  }
}
