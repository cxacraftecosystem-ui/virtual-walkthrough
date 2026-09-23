/**
 * Procedural model library — one component per ProceduralModelId.
 * Every model: origin at floor centre, front faces +z, built to config.footprint/height.
 */
import type { ComponentType } from 'react'
import type { ProceduralModelId } from '../config/objects'
import { Column, GrandDesk, Planter, SpeakerPlaceholder, TextileBanner, TheatreSeating } from './atrium'
import { DryingLine, GardenBench, PlantBed, Tree, WaterChannel } from './courtyard'
import { Crate, Stool, Vessel } from './props'
import type { ModelProps } from './types'
import { Centrepiece } from './centrepiece'
import { Pedestal, Vitrine } from './display'
import { MapWall } from './mapWall'
import { ArtisanCapture } from './artisan'
import { PrintStudioTable, VisitorsWall } from './printStudio'
import { ShopCounter, ShopShelf, ShopTable, StoleRail } from './shop'
import { Bookcase, DrawingWall, LoungeSet, PatternLectern, ReadingTable, ResourceBoard } from './library'
import { CreditsPanel } from './credits'
import { BlockShelf, CarvingBench, DyeVat, FabricRolls, PigmentStation, PrintingTable, WashTank } from './workshop'

export type { ModelProps } from './types'

export const PROCEDURAL_MODELS: Record<ProceduralModelId, ComponentType<ModelProps>> = {
  'printing-table': PrintingTable,
  'dye-vat': DyeVat,
  'drying-line': DryingLine,
  'block-shelf': BlockShelf,
  'pigment-station': PigmentStation,
  'wash-tank': WashTank,
  'fabric-rolls': FabricRolls,
  'carving-bench': CarvingBench,
  'textile-banner': TextileBanner,
  'plant-bed': PlantBed,
  tree: Tree,
  'water-channel': WaterChannel,
  'grand-desk': GrandDesk,
  planter: Planter,
  speaker: SpeakerPlaceholder,
  'theatre-seating': TheatreSeating,
  'garden-bench': GardenBench,
  column: Column,
  vessel: Vessel,
  stool: Stool,
  crate: Crate,
  centrepiece: Centrepiece,
  'map-wall': MapWall,
  vitrine: Vitrine,
  pedestal: Pedestal,
  'print-studio': PrintStudioTable,
  'visitors-wall': VisitorsWall,
  splat: ArtisanCapture,
  'shop-shelf': ShopShelf,
  'shop-table': ShopTable,
  'shop-counter': ShopCounter,
  'stole-rail': StoleRail,
  bookcase: Bookcase,
  'reading-table': ReadingTable,
  'lounge-set': LoungeSet,
  'pattern-lectern': PatternLectern,
  'drawing-wall': DrawingWall,
  'resource-board': ResourceBoard,
  'credits-panel': CreditsPanel,
}
