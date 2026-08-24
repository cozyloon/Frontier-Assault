// Keyboard + mouse input with pointer lock.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = {};
    this.mouseDown = false;
    this.mouse2Down = false;
    this.dx = 0; this.dy = 0;
    this.locked = false;
    this.onKeyPress = {};   // code -> fn (fires on keydown once)
    this.enabled = true;

    document.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (!e.repeat && this.onKeyPress[e.code]) this.onKeyPress[e.code](e);
      this.keys[e.code] = true;
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    document.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked || !this.enabled) return;
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.mouse2Down = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.mouse2Down = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.dx += e.movementX; this.dy += e.movementY;
    });
    document.addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }
  lock() { this.canvas.requestPointerLock(); }
  unlock() { document.exitPointerLock(); }
  consumeMouse() { const d = { dx: this.dx, dy: this.dy }; this.dx = 0; this.dy = 0; return d; }
  down(code) { return !!this.keys[code]; }
}
