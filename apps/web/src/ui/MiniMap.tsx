import { useEffect, useRef } from 'react';
import type { Game } from '../game/game.ts';

const SIZE = 168;

/**
 * The round map in the corner, like a car's GPS: it turns with your camera so "up" is where
 * you look, zooms out while you drive, and shows friends (blue), named places (coloured dots)
 * and you (the white arrow). North is marked on the rim.
 */
export function MiniMap({ game, onOpen }: { game: Game; onOpen: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let zoom = 1;
    const draw = (): void => {
      const element = canvas.current;
      const view = game.mapView();
      if (!element || !view) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (element.width !== SIZE * dpr) {
        element.width = SIZE * dpr;
        element.height = SIZE * dpr;
      }
      const c = element.getContext('2d') as CanvasRenderingContext2D;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, SIZE, SIZE);
      const r = SIZE / 2;
      // Metres shown from the centre to the rim: further out while driving.
      zoom += ((view.driving ? 1.9 : 1) - zoom) * 0.08;
      const reach = 110 * zoom;
      const pxPerMetre = r / reach;
      const toMap = view.picture.width / (2 * view.half); // picture pixels per metre
      c.save();
      c.beginPath();
      c.arc(r, r, r - 2, 0, Math.PI * 2);
      c.clip();
      c.fillStyle = '#1c2129';
      c.fillRect(0, 0, SIZE, SIZE);
      c.translate(r, r);
      c.rotate(view.yaw);
      // The map picture, scaled so 1 m = pxPerMetre, centred on you.
      const s = pxPerMetre / toMap;
      c.imageSmoothingEnabled = true;
      c.drawImage(view.picture, -(view.x + view.half) * toMap * s, -(view.z + view.half) * toMap * s, view.picture.width * s, view.picture.height * s);
      const at = (x: number, z: number): [number, number] => [(x - view.x) * pxPerMetre, (z - view.z) * pxPerMetre];
      for (const place of view.places) {
        const [px, py] = at(place.x, place.z);
        if (Math.hypot(px, py) > r) continue;
        c.fillStyle = place.color;
        c.beginPath();
        c.arc(px, py, 3, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.6)';
        c.lineWidth = 1;
        c.stroke();
      }
      for (const friend of view.friends) {
        let [px, py] = at(friend.x, friend.z);
        const d = Math.hypot(px, py);
        if (d > r - 8) {
          px *= (r - 8) / d; // friends far away sit on the rim, pointing the way
          py *= (r - 8) / d;
        }
        c.fillStyle = '#4ea8ff';
        c.strokeStyle = '#ffffff';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(px, py, 5, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      }
      // North marker on the rim.
      const nx = Math.sin(0) * (r - 10);
      const ny = -(r - 10);
      c.restore();
      c.save();
      c.translate(r, r);
      c.rotate(view.yaw);
      c.translate(nx, ny);
      c.rotate(-view.yaw);
      c.fillStyle = '#f2b134';
      c.font = '800 11px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('N', 0, 0);
      c.restore();
      // You: an arrow pointing where your body faces (the map is turned to the camera).
      c.save();
      c.translate(r, r);
      c.rotate(view.yaw - view.facing);
      c.fillStyle = view.inside ? '#f2b134' : '#ffffff';
      c.strokeStyle = '#0e1116';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, -9);
      c.lineTo(7, 7);
      c.lineTo(0, 3);
      c.lineTo(-7, 7);
      c.closePath();
      c.fill();
      c.stroke();
      c.restore();
      // Rim.
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(r, r, r - 2, 0, Math.PI * 2);
      c.stroke();
    };
    const timer = setInterval(draw, 66);
    return () => clearInterval(timer);
  }, [game]);

  return <canvas ref={canvas} className="miniMap" style={{ width: SIZE, height: SIZE }} aria-label="Map — tap to open" onClick={onOpen} />;
}
