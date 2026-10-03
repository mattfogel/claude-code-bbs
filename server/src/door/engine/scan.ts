// Sector displays, port reports and scanners (research 01 §5.3, §5.4).

import { DENSITY, MARSHALS, portSells, type PortClass } from '../../../../plugin/shared/door/data'
import type { DensityRow, PortItem, PortReport, SectorView } from '../../../../plugin/shared/door/protocol'
import { capacity } from './prices'
import type { PortRec } from './types'

/** Everything the engine needs to draw a sector. */
export type SectorContents = {
  id: number
  warps: number[]
  concord: boolean
  beacon?: string
  navhaz: number
  port?: PortRec
  planets: SectorView['planets']
  traders: SectorView['traders']
  /** Phase 2: sector fighters, mines and limpets, and the Marshals in port. */
  fighters?: SectorView['fighters']
  mines?: SectorView['mines']
  marshals?: string[]
}

export function sectorView(c: SectorContents): SectorView {
  const view: SectorView = {
    id: c.id,
    region: c.concord ? 'concord' : 'uncharted',
    planets: c.planets,
    traders: c.traders,
    ships: [],
    navhaz: c.navhaz,
    mines: c.mines ?? [],
    hallucinations: [],
    marshals: c.marshals ?? [],
    warps: c.warps,
  }
  if (c.beacon) view.beacon = c.beacon
  if (c.fighters) view.fighters = c.fighters
  if (c.port) view.port = { name: c.port.name, class: c.port.class }
  return view
}

/** The density a scanner reads for a sector. */
export function densityOf(c: SectorContents): number {
  const mines = (c.mines ?? []).reduce((a, m) => a + m.count * (m.kind === 'contact' ? DENSITY.contactMine : DENSITY.limpet), 0)
  const marshals = (c.marshals ?? []).reduce((a, name) => a + (MARSHALS.find(m => m.name === name)?.density ?? 0), 0)
  return (
    (c.fighters ? c.fighters.count * DENSITY.fighter : 0) +
    mines +
    marshals +
    (c.port ? DENSITY.port : 0) +
    c.planets.length * DENSITY.planet +
    c.traders.length * DENSITY.mannedShip +
    c.navhaz * DENSITY.navhazPct +
    (c.beacon ? DENSITY.beacon : 0)
  )
}

export function densityRow(c: SectorContents): DensityRow {
  return { sector: c.id, density: densityOf(c), warps: c.warps.length, navhaz: c.navhaz, anomaly: (c.mines ?? []).some(m => m.kind === 'limpet' && m.count > 0) }
}

/** A commerce report for a standard port; undefined for specials. */
export function portReport(port: PortRec, seenAt: string): PortReport | undefined {
  if (port.class < 1 || port.class > 8) return undefined
  const cls = port.class as PortClass
  const item = (c: 0 | 1 | 2): PortItem => {
    const cap = capacity(port, c)
    return { status: portSells(cls, c) ? 'selling' : 'buying', trading: port.amount[c], pct: cap ? Math.round((100 * port.amount[c]) / cap) : 0 }
  }
  return { sector: port.sector, name: port.name, class: cls, seenAt, items: [item(0), item(1), item(2)] }
}
