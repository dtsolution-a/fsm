'use client';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { useEffect } from 'react';

const INDIA: [number, number] = [21.5, 78.9];

function Fit({ pts }: { pts: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (pts.length === 1) map.setView(pts[0], 12);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 14 });
  }, [pts, map]);
  return null;
}

export function LiveMap({ engineers }: { engineers: { engineerId: string; name: string; lat: number; lng: number; recordedAt: string }[] }) {
  const pts = engineers.map((e) => [e.lat, e.lng] as [number, number]);
  return (
    <MapContainer center={INDIA} zoom={5} scrollWheelZoom preferCanvas>
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Fit pts={pts} />
      {engineers.map((e) => (
        <CircleMarker key={e.engineerId} center={[e.lat, e.lng]} radius={9} pathOptions={{ color: '#4338ca', fillColor: '#6366f1', fillOpacity: 0.85 }}>
          <Tooltip>{e.name}<br />{new Date(e.recordedAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}</Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

export function RouteMap({ points }: { points: { lat: number; lng: number; at: string }[] }) {
  const pts = points.map((p) => [p.lat, p.lng] as [number, number]);
  return (
    <MapContainer center={INDIA} zoom={5} scrollWheelZoom preferCanvas>
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Fit pts={pts} />
      <Polyline positions={pts} pathOptions={{ color: '#4f46e5', weight: 4 }} />
      <CircleMarker center={pts[0]} radius={7} pathOptions={{ color: '#059669', fillColor: '#10b981', fillOpacity: 1 }}><Tooltip>Start</Tooltip></CircleMarker>
      <CircleMarker center={pts[pts.length - 1]} radius={7} pathOptions={{ color: '#be123c', fillColor: '#f43f5e', fillOpacity: 1 }}><Tooltip>Latest</Tooltip></CircleMarker>
    </MapContainer>
  );
}
