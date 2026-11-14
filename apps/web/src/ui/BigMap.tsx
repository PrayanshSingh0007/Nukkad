import { useEffect, useRef, useState } from 'react';
import type { Game } from '../game/game.ts';

/**
 * The full-screen map (tap the small map, or press M): north up, the whole area, street
 * names, named places, friends and you. Drag to move around, + and − to zoom.
 */
export function BigMap({ game, onClose }: { game: Game; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const pan = useRef<{ x: number; z: number } | null>(null);
  const drag = useRef<{ px: number; py: number; x: number; z: number } | null>(null);

  useEffect(() => {
    const draw = (): void => {
      const element = canvas.current;
      const view = game.mapView();
      if (!element || !view) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = element.clientWidth;
      const h = element.clientHeight;
      if (element.width !== Math.round(w * dpr) || element.height !== Math.round(h * dpr)) {
        element.width = Math.round(w * dpr);
        element.height = Math.round(h * dpr);
      }
      if (!pan.current) pan.current = { x: view.x, z: view.z };
      const c = element.getContext('2d') as CanvasRenderingContext2D;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = '#161a21';
      c.fillRect(0, 0, w, h);
      // Metres → screen: the whole area fits the shorter side at zoom 1.
      const scale = (Math.min(w, h) / (2 * view.half)) * zoom;
      const centre = pan.current;
      const sx = (x: number): number => w / 2 + (x - centre.x) * scale;
      const sy = (z: number): number => h / 2 + (z - centre.z) * scale;
      c.imageSmoothingEnabled = true;
      c.drawImage(view.picture, sx(-view.half), sy(-view.half), 2 * view.half * scale, 2 * view.half * scale);

      // Street names along their roads; small streets only when zoomed in.
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      for (const street of view.streets) {
        if (!street.major && zoom < 1.8) continue;
        const x = sx(street.x);
        const y = sy(street.z);
        if (x < -50 || y < -20 || x > w + 50 || y > h + 20) continue;
        c.save();
        c.translate(x, y);
        c.rotate(street.angle);
        c.font = `${street.major ? 700 : 600} ${street.major ? 12 : 10.5}px system-ui, sans-serif`;
        c.lineWidth = 3;
        c.strokeStyle = 'rgba(14,17,22,0.9)';
        c.strokeText(street.name, 0, 0);
        c.fillStyle = street.major ? '#ffe2a8' : '#d8dce4';
        c.fillText(street.name, 0, 0);
        c.restore();
      }
      // Named places: a dot, and the name once zoomed in.
      for (const place of view.places) {
        const x = sx(place.x);
        const y = sy(place.z);
        if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
        c.fillStyle = place.color;
        c.strokeStyle = '#0e1116';
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(x, y, 4, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        if (zoom >= 2.4) {
          c.font = '600 10px system-ui, sans-serif';
          c.textAlign = 'left';
          c.lineWidth = 3;
          c.strokeText(place.name, x + 7, y);
          c.fillStyle = '#ffffff';
          c.fillText(place.name, x + 7, y);
          c.textAlign = 'center';
        }
      }
      // Friends with their names.
      for (const friend of view.friends) {
        const x = sx(friend.x);
        const y = sy(friend.z);
        c.fillStyle = '#4ea8ff';
        c.strokeStyle = '#ffffff';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(x, y, 6, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.font = '700 11px system-ui, sans-serif';
        c.lineWidth = 3;
        c.strokeStyle = '#0e1116';
        c.strokeText(friend.name, x, y - 13);
        c.fillStyle = '#bfe0ff';
        c.fillText(friend.name, x, y - 13);
      }
      // You.
      c.save();
      c.translate(sx(view.x), sy(view.z));
      c.rotate(-view.facing);
      c.fillStyle = '#ffffff';
      c.strokeStyle = '#0e1116';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, -11);
      c.lineTo(8, 8);
      c.lineTo(0, 4);
      c.lineTo(-8, 8);
      c.closePath();
      c.fill();
      c.stroke();
      c.restore();
    };
    const timer = setInterval(draw, 66);
    draw();
    return () => clearInterval(timer);
  }, [game, zoom]);

  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.code === 'KeyM' || event.code === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const metresPerPixel = (): number => {
    const view = game.mapView();
    const element = canvas.current;
    if (!view || !element) return 1;
    return (2 * view.half) / (Math.min(element.clientWidth, element.clientHeight) * zoom);
  };

  return (
    <div className="bigMap">
      <canvas
        ref={canvas}
        onPointerDown={(event) => {
          (event.target as HTMLElement).setPointerCapture(event.pointerId);
          const centre = pan.current ?? { x: 0, z: 0 };
          drag.current = { px: event.clientX, py: event.clientY, x: centre.x, z: centre.z };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          const k = metresPerPixel();
          pan.current = { x: start.x - (event.clientX - start.px) * k, z: start.z - (event.clientY - start.py) * k };
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      />
      <div className="bigMapBar">
        <button type="button" onClick={() => setZoom((z) => Math.min(6, z * 1.6))}>
          +
        </button>
        <button type="button" onClick={() => setZoom((z) => Math.max(1, z / 1.6))}>
          −
        </button>
        <button
          type="button"
          onClick={() => {
            pan.current = null;
          }}
        >
          Me
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="bigMapCredit">Map data © OpenStreetMap contributors</p>
    </div>
  );
}
