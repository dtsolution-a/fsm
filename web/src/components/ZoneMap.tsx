'use client';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import Link from 'next/link';
import { useEffect } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';

const INDIA: [number, number] = [21.5, 78.9];
const COLOR: Record<string, { stroke: string; fill: string }> = {
  delayed: { stroke: '#be123c', fill: '#f43f5e' },
  open: { stroke: '#b45309', fill: '#f59e0b' },
  clear: { stroke: '#047857', fill: '#34d399' },
};

export interface MapSite { id: string; site: string; city: string | null; client: string; clientId: string; zone: string | null; lat: number; lng: number; approx: boolean; openRequests: number; openJobs: number; delayedJobs: number; delayedRequests: number; status: 'delayed' | 'open' | 'clear' }
export interface MapZone { zoneId: string; zone: string; sites: number; mapped: number; openRequests: number; openJobs: number; delayed: number; lat: number | null; lng: number | null }

function Fit({ pts }: { pts: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (pts.length === 1) map.setView(pts[0], 12);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 13 });
  }, [pts, map]);
  return null;
}

// Stations of a branch: red = something is late, amber = work is open, green = nothing pending
export function SitesMap({ sites }: { sites: MapSite[] }) {
  const pts = sites.map((s) => [s.lat, s.lng] as [number, number]);
  return (
    <MapContainer center={INDIA} zoom={5} scrollWheelZoom preferCanvas>
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Fit pts={pts} />
      {sites.map((s) => {
        const c = COLOR[s.status];
        return (
          <CircleMarker key={s.id} center={[s.lat, s.lng]} radius={s.status === 'clear' ? 5 : s.status === 'open' ? 8 : 10} pathOptions={{ color: c.stroke, fillColor: c.fill, fillOpacity: s.approx ? 0.45 : 0.9, weight: s.approx ? 1 : 2 }}>
            <Tooltip>{s.site}</Tooltip>
            <Popup>
              <div className="text-sm"><b>{s.site}</b><br />{s.client}{s.city ? ` · ${s.city}` : ''}<br />
                {s.openRequests} request{s.openRequests === 1 ? '' : 's'} open · {s.openJobs} job{s.openJobs === 1 ? '' : 's'} open<br />
                {s.delayedJobs + s.delayedRequests > 0 ? <b style={{ color: '#be123c' }}>{s.delayedJobs} job(s) and {s.delayedRequests} request(s) delayed</b> : 'Nothing delayed'}
                {s.approx && <><br /><span style={{ color: '#64748b' }}>Approximate position (from pincode)</span></>}
                <br /><Link href={`/clients/${s.clientId}`} style={{ color: '#4338ca' }}>Open client</Link></div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}

// Zoomed out: one bubble per branch
export function ZonesMap({ zones, onPick }: { zones: MapZone[]; onPick(id: string): void }) {
  const placed = zones.filter((z) => z.lat != null && z.lng != null);
  const pts = placed.map((z) => [z.lat!, z.lng!] as [number, number]);
  return (
    <MapContainer center={INDIA} zoom={5} scrollWheelZoom preferCanvas>
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Fit pts={pts} />
      {placed.map((z) => {
        const c = COLOR[z.delayed > 0 ? 'delayed' : z.openRequests + z.openJobs > 0 ? 'open' : 'clear'];
        return (
          <CircleMarker key={z.zoneId} center={[z.lat!, z.lng!]} radius={10 + Math.min(18, Math.sqrt(z.openRequests + z.openJobs) * 2)} pathOptions={{ color: c.stroke, fillColor: c.fill, fillOpacity: 0.6 }} eventHandlers={{ click: () => onPick(z.zoneId) }}>
            <Tooltip>{z.zone}: {z.openRequests} requests, {z.openJobs} jobs, {z.delayed} delayed</Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
