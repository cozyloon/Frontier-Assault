// Entry point — UI module wires everything; game module is loaded on demand by ui.js.
import './ui.js';
console.log('%cFRONTIER ASSAULT%c ready. Standby for Titanfall.', 'color:#ff6a2b;font-weight:bold', 'color:inherit');

// fullscreen toggle — always available, works on every screen
const fsBtn = document.getElementById('btn-fullscreen');
fsBtn.onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
};
document.addEventListener('fullscreenchange', () => {
  fsBtn.textContent = document.fullscreenElement ? '🗗' : '⛶';
  fsBtn.title = document.fullscreenElement ? 'Exit fullscreen (Esc)' : 'Toggle fullscreen (F11 also works)';
});
