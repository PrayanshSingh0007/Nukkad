import * as THREE from 'three';

const WIDTH = 256;
const HEIGHT = 64;

/** A name floating above a player's head. Drawn on a small canvas, visible through walls. */
export class NameTag {
  readonly sprite: THREE.Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private text = '';

  constructor(name: string) {
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: this.texture, depthTest: false, transparent: true });
    this.sprite = new THREE.Sprite(material);
    this.sprite.scale.set(1.6, 0.4, 1);
    this.sprite.renderOrder = 10;
    this.set(name, false);
  }

  /** Redraws only when the text changes. */
  set(name: string, away: boolean): void {
    const text = away ? `${name} · reconnecting…` : name;
    if (text === this.text) return;
    this.text = text;
    const c = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    c.clearRect(0, 0, WIDTH, HEIGHT);
    c.font = '600 28px system-ui, -apple-system, Roboto, sans-serif';
    const width = Math.min(WIDTH - 8, c.measureText(text).width + 28);
    c.fillStyle = away ? 'rgba(60,60,70,0.6)' : 'rgba(20,24,32,0.72)';
    c.beginPath();
    c.roundRect((WIDTH - width) / 2, 10, width, 44, 22);
    c.fill();
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, WIDTH / 2, 33, WIDTH - 24);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.sprite.material.dispose();
    this.sprite.removeFromParent();
  }
}
