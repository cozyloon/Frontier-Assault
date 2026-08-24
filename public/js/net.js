// Socket.io wrapper — single connection shared by UI and game.
export const socket = io({ transports: ['websocket', 'polling'] });

export function call(event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

export const state = {
  profile: null,     // logged-in profile from server
  lobby: null,       // current lobby detail
  myId: null
};
socket.on('connect', () => { state.myId = socket.id; });
