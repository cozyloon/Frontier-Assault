// Match runtime: scene, loop, local pilot/titan, remotes, combat, socket sync.
import * as THREE from 'three';
import { socket, state } from '../net.js';
import { MAPS, MATCH, TITAN_TACTICALS, TITAN_CHASSIS, MELEE } from '/shared/data.js';
import { buildWorld } from './world.js';
import { Input } from './input.js';
import { PilotController, PILOT_EYE } from './pilot.js';
import { TitanEntity, TitanAI, TITAN_EYE } from './titan.js';
import { Arsenal } from './weapons.js';
import { Projectiles } from './projectiles.js';
import { Effects } from './effects.js';
import { RemotePlayer } from './remote.js';
import { GruntManager } from './grunts.js';
import { Hud } from './hud.js';
import { teamColor, makeViewmodel, makeDropship, makePilotMesh, makeNameSprite } from './models.js';
import { sfx, voice } from './audio.js';

const $ = (id) => document.getElementById(id);

let G = null;   // active game instance

export function startGame(payload, onQuit, onReturnToLobby) {
  if (G) G.dispose();
  G = new Game(payload, onQuit, onReturnToLobby);
  window.__game = G;   // debug handle
}

class Game {
  constructor(payload, onQuit, onReturnToLobby) {
    this.onQuit = onQuit;
    this.onReturnToLobby = onReturnToLobby;
    this.myId = socket.id;
    this.active = true;
    this.mode = 'pilot';            // pilot | titan | dead | rodeo
    this.aiming = false;
    this.rodeoTargetId = null;

    const me = payload.players.find(p => p.id === this.myId);
    this.me = me;
    this.team = me.team;
    this.loadout = me.loadout;
    this.scores = payload.scores;
    this.timeLeft = payload.timeLeft;
    this.scoreLimit = payload.scoreLimit;
    this.meterPct = 0; this.meterReady = false;
    this.tallies = new Map();       // id -> {kills, deaths}

    // ---------- three ----------
    const canvas = $('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(100, innerWidth / innerHeight, 0.1, 1200);
    this.onResize = () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    };
    addEventListener('resize', this.onResize);

    this.world = buildWorld(this.scene, MAPS[payload.mapId] || MAPS.angel_city);
    this.effects = new Effects(this.scene);
    // camera shake driven by nearby explosions
    this.shake = 0;
    this.effects.onShake = (pos, radius) => {
      const d = this.camera.position.distanceTo(pos);
      this.addShake(Math.max(0, (radius * 2.4 - d) / (radius * 2.4)) * 0.35);
    };
    this.bobT = 0; this.stepPhase = 0; this.landDip = 0; this.wasGrounded = true;
    sfx.startAmbient();
    this.hud = new Hud();
    this.input = new Input(canvas);
    this.projectiles = new Projectiles(this.scene, this.effects, this);
    this.gruntMgr = new GruntManager(this);

    this.viewmodel = null;   // built per-weapon by refreshViewmodel()
    this.scene.add(this.camera);

    // ---------- local player ----------
    this.pilot = new PilotController(this.input, this.world.colliders, this.loadout.pilot.tactical);
    this.pilotHp = MATCH.pilotHealth;
    this.spawnSelf();
    this.arsenal = new Arsenal(this, this.loadout);
    this.refreshViewmodel();
    this.hud.setWeapon(this.arsenal.current);
    this.hud.setOrdnance(this.arsenal.ordnanceLeft, this.arsenal.ordnance.name);
    this.hud.setScores(this.scores.imc, this.scores.militia);
    this.hud.setTimer(this.timeLeft);

    this.myTitan = null;            // TitanEntity
    this.myTitanAI = null;
    this.titanTactical = TITAN_TACTICALS[this.loadout.titan.tactical];
    this.titanTacticalCd = 0;
    this.titanVortexUntil = 0;
    this.recoil = 0;

    // ---------- remotes ----------
    this.remotes = new Map();
    for (const p of payload.players) {
      if (p.id === this.myId) continue;
      this.addRemote(p);
    }

    this.raycastTargets = this.buildRaycastTargets();
    this.pwalls = [];               // {mesh, team, until}

    this.bindSocket();
    this.bindKeys();
    this.lastSend = 0;
    this.lastTime = performance.now();
    this.raycaster = new THREE.Raycaster();
    this.raycaster.camera = this.camera;   // required if a Sprite ever ends up in a raycast
    this.animFrame = requestAnimationFrame((t) => this.loop(t));

    this.startIntro();
    this.input.lock();
    this.input.onLockChange = (locked) => {
      if (!locked && this.active && !this.resultsShown) this.showPause(true);
    };
  }

  // ================= setup helpers =================
  buildRaycastTargets() {
    const t = [...this.world.meshes];
    for (const r of this.remotes.values()) {
      t.push(r.mesh);
      if (r.titan) t.push(r.titan.mesh);
    }
    // NOTE: my own titan is deliberately NOT a raycast target — it would block my shots from the cockpit
    for (const w of this.pwalls || []) t.push(w.mesh);
    if (this.gruntMgr) t.push(...this.gruntMgr.meshes());
    return t;
  }
  refreshTargets() { this.raycastTargets = this.buildRaycastTargets(); }

  addRemote(info) {
    const r = new RemotePlayer(this.scene, info);
    if (info.titan) {
      r.ensureTitan(info.titan.chassis);
      if (info.titan.doomed) r.titan.setDoomed();
      r.titan.falling = false;
    }
    this.remotes.set(info.id, r);
    this.tallies.set(info.id, { kills: info.kills || 0, deaths: info.deaths || 0, name: info.name, team: info.team });
    this.refreshTargets();
    return r;
  }

  spawnSelf() {
    const spawns = this.world.spawns[this.team];
    const s = spawns[Math.floor(Math.random() * spawns.length)];
    this.pilot.spawn(s);
    this.pilot.yaw = this.team === 'imc' ? Math.PI : 0;
    this.mode = 'pilot';
    this.pilotHp = MATCH.pilotHealth;
    this.hud.setHealth(this.pilotHp, MATCH.pilotHealth);
  }

  // ================= deployment intro: ride inside the dropship, then drop =================
  startIntro() {
    const spawn = this.pilot.pos.clone();
    this.dropship = makeDropship(teamColor(this.team));
    this.scene.add(this.dropship);
    // fly across the spawn along X at altitude; face direction of travel
    this.intro = {
      t: 0, phase: 'cabin',
      from: new THREE.Vector3(spawn.x - 220, 62, spawn.z),
      to: new THREE.Vector3(spawn.x + 220, 62, spawn.z),
      spawn
    };
    this.dropship.rotation.y = Math.PI / 2;   // nose toward +x
    // squadmates riding along in the cabin (my team's roster)
    const seats = [[-1.7, 1.5], [1.7, 0.5], [-1.7, -1.5], [1.7, -2.5], [-1.7, 3.2]];
    let si = 0;
    for (const r of this.remotes.values()) {
      if (r.team !== this.team || si >= seats.length) continue;
      const buddy = makePilotMesh(teamColor(this.team));
      const tag = makeNameSprite(r.name, this.team === 'imc' ? '#4da3ff' : '#ffb24d');
      tag.position.y = 2.0;
      buddy.add(tag);
      buddy.position.set(seats[si][0], -1.0, seats[si][1]);
      buddy.rotation.y = seats[si][0] < 0 ? -Math.PI / 2 : Math.PI / 2;   // face the aisle (model front is -z)
      this.dropship.add(buddy);
      si++;
    }
    // jumpmaster at the ramp, facing the squad
    const jm = makePilotMesh(0xff5540);
    const jmTag = makeNameSprite('JUMPMASTER', '#ff5540');
    jmTag.position.y = 2.0;
    jm.add(jmTag);
    jm.position.set(-0.6, -1.0, -4.4);
    jm.rotation.y = Math.PI;   // faces +z, toward the squad (model front is -z)
    this.dropship.add(jm);
    // seated in the cabin, looking out the open rear ramp
    this.pilot.frozen = true;
    this.pilot.yaw = Math.PI / 2;   // face the open rear ramp (world -x); mouse look stays free
    this.pilot.pitch = 0.05;
    this.hud.center('STAND BY FOR DEPLOYMENT', 2200);
    sfx.play('titanfall', 40);
    voice.say('Listen up, Pilots. The Frontier is counting on you. Make every shot count.', { priority: true });
  }

  updateIntro(dt) {
    const I = this.intro;
    I.t += dt;
    // ship crosses the spawn point exactly when the pilot exits (DROP_AT + RUN_TIME = FLY_TIME/2)
    const FLY_TIME = 11, DROP_AT = 4.6, RUN_TIME = 0.9;
    if (this.dropship) {
      const k = Math.min(1, I.t / FLY_TIME);
      this.dropship.position.lerpVectors(I.from, I.to, k);
      this.dropship.position.y += Math.sin(I.t * 2.2) * 0.15;   // gentle float
      if (Math.random() < dt * 12) {
        this.effects.tracer(
          this.dropship.position.clone().add(new THREE.Vector3(-7.2, 0.9, 0)),
          this.dropship.position.clone().add(new THREE.Vector3(-11, 0.9, 0)), 0xffa050);
      }
      if (I.t >= FLY_TIME) { this.scene.remove(this.dropship); this.dropship = null; }
    }

    if (I.phase === 'cabin') {
      // first-person seat inside the cabin, free mouse look; ship carries the camera
      if (this.dropship) {
        const seat = this.dropship.localToWorld(new THREE.Vector3(1.15, 0.45, 2.4));
        this.camera.position.copy(seat);
        // keep the pilot's network position with the ship so others see us riding in
        this.pilot.pos.copy(this.dropship.position);
        // engine rumble
        if (Math.random() < dt * 0.7) sfx.play('rocket_loop', 8);
      }
      // jumpmaster countdown
      if (I.t >= DROP_AT - 2.4 && !I.countdown) {
        I.countdown = true;
        voice.say('Three. Two. One. Go, go, go!', { priority: true });
      }
      if (I.t >= DROP_AT - 2.2 && !I.cd3) { I.cd3 = true; this.hud.center('3'); sfx.play('lock'); }
      if (I.t >= DROP_AT - 1.5 && !I.cd2) { I.cd2 = true; this.hud.center('2'); sfx.play('lock'); }
      if (I.t >= DROP_AT - 0.8 && !I.cd1) { I.cd1 = true; this.hud.center('1'); sfx.play('locked'); }
      if (I.t >= DROP_AT - 0.15 && !I.jumpWarned) {
        I.jumpWarned = true;
        this.hud.center('JUMP LIGHT GREEN — GO GO GO');
      }
      if (I.t >= DROP_AT) {
        I.phase = 'run';
        I.runT = 0;
        // squadmates sprint for the ramp
        I.buddies = this.dropship ? this.dropship.children.filter(c => c.type === 'Group') : [];
      }
    } else if (I.phase === 'run') {
      // sprint down the aisle and out the open ramp
      I.runT += dt;
      const k = Math.min(1, I.runT / RUN_TIME);
      if (this.dropship) {
        const seat = new THREE.Vector3().lerpVectors(
          new THREE.Vector3(1.15, 0.45, 2.4),        // seat
          new THREE.Vector3(0, 0.35, -7.2),          // out past the ramp
          k * k                                       // accelerate into the sprint
        );
        this.camera.position.copy(this.dropship.localToWorld(seat));
        this.pilot.pos.copy(this.camera.position);
        // face the ramp while sprinting
        this.pilot.yaw += (Math.PI / 2 - this.pilot.yaw) * Math.min(1, dt * 6);
        // head-bob + footsteps
        this.camera.position.y += Math.sin(I.runT * 22) * 0.05;
        if (Math.sin(I.runT * 22) < -0.8 && !I._stepped) { I._stepped = true; sfx.play('step'); }
        else if (Math.sin(I.runT * 22) > 0) I._stepped = false;
        // squadmates run out ahead of you
        for (const b of I.buddies) {
          b.position.z -= dt * 9;
          this.walkBuddy = (this.walkBuddy || 0) + dt * 10;
          b.userData.anim && (b.userData.anim.lLeg.rotation.x = Math.sin(this.walkBuddy) * 0.7,
                              b.userData.anim.rLeg.rotation.x = -Math.sin(this.walkBuddy) * 0.7);
          if (b.position.z < -6.6 && !b.userData.jumped) {
            b.userData.jumped = true;
            this.effects.jets(this.dropship.localToWorld(b.position.clone()));
            b.visible = false;
          }
        }
      }
      if (k >= 1) {
        I.phase = 'drop';
        this.pilot.frozen = false;
        // exit exactly where the ramp is — the ship is crossing the spawn point now
        const exit = this.dropship ? this.dropship.localToWorld(new THREE.Vector3(0, -1, -7.5)) : new THREE.Vector3(I.spawn.x, 58, I.spawn.z);
        this.pilot.pos.copy(exit);
        this.pilot.vel.set(12, 2, 0);              // carried forward out of the ramp, then gravity
        this.pilot.pitch = -0.7;
        this.hud.center('BRACE FOR IMPACT');
        sfx.play('jets');
        voice.say('Deploying now.');
        this.effects.jets(this.pilot.pos.clone());
      }
    } else if (I.phase === 'drop') {
      // ease the view back up as the ground approaches
      this.pilot.pitch += ((-0.1) - this.pilot.pitch) * Math.min(1, dt * 1.4);
      if (this.pilot.onGround) {
        this.effects.shockwave(this.pilot.pos.clone(), 8, 0xbbccdd);
        this.addShake(0.22);
        sfx.play('land');
        this.hud.center(`ATTRITION — first to ${this.scoreLimit}. Good hunting, Pilot.`, 3200);
        this.input.enabled = true;
        I.phase = 'done';
      }
    }
    if (I.phase === 'done' && !this.dropship) this.intro = null;
  }

  // ================= input =================
  bindKeys() {
    const I = this.input;
    const gate = (fn) => () => { if (!this.intro || this.intro.phase === 'done') fn(); };   // no combat while riding the dropship
    I.onKeyPress['Space'] = gate(() => {
      if (this.mode === 'pilot') {
        const kind = this.pilot.jumpPressed();
        if (kind === 'doublejump' || kind === 'walljump') {
          const jp = this.pilot.pos.clone().add(new THREE.Vector3(0, 1.1, 0));
          this.effects.jets(jp);
          this.sendFx({ type: 'jets', pos: jp.toArray() });
        }
      } else if (this.mode === 'rodeo') this.endRodeo(true);
      else if (this.mode === 'ride') this.endRide(true);
    });
    I.onKeyPress['KeyR'] = gate(() => this.arsenal.reload());
    I.onKeyPress['Digit1'] = gate(() => this.arsenal.switchTo(0));
    I.onKeyPress['Digit2'] = gate(() => this.arsenal.switchTo(1));
    I.onKeyPress['Digit3'] = gate(() => this.arsenal.switchTo(2));
    I.onKeyPress['KeyG'] = gate(() => { if (this.mode === 'pilot' || this.mode === 'titan') this.arsenal.throwOrdnance(this.camera); });
    I.onKeyPress['KeyQ'] = gate(() => this.useTactical());
    I.onKeyPress['KeyV'] = gate(() => this.requestTitanfall());
    I.onKeyPress['KeyE'] = gate(() => this.interact());
    I.onKeyPress['KeyX'] = gate(() => { if (this.mode === 'titan') socket.emit('titan:eject'); });
    I.onKeyPress['KeyF'] = gate(() => this.toggleAiMode());
    I.onKeyPress['KeyC'] = gate(() => this.melee());
    I.onKeyPress['Escape'] = () => {};
    I.onKeyPress['Tab'] = () => this.showScoreboard(true);
    document.addEventListener('keyup', this.tabUp = (e) => { if (e.code === 'Tab') this.showScoreboard(false); });

    $('btn-resume').onclick = () => { this.showPause(false); this.input.lock(); };
    $('btn-quit-match').onclick = () => { this.dispose(); this.onQuit(); };
  }

  useTactical() {
    if (this.mode === 'titan') {
      // titan tactical
      if (this.titanTacticalCd > 0 || !this.myTitan) return;
      const t = this.titanTactical;
      this.titanTacticalCd = t.cooldown;
      if (t.block) {   // Vortex Shield / Ronin Sword Block: deflects frontal fire
        this.titanVortexUntil = performance.now() + t.duration * 1000;
        this.effects.shieldDome(() => this.myTitan?.centerPos || new THREE.Vector3(), 4.2,
          t.id === 'vortex' ? 0x7ad7ff : 0xffb24d,
          () => performance.now() < this.titanVortexUntil && !!this.myTitan);
        sfx.play('vortex');
      } else if (t.id === 'esmoke') {
        const pos = this.myTitan.centerPos;
        this.effects.smoke(pos, t.radius, t.duration);
        this.sendFx({ type: 'esmoke', pos: pos.toArray(), radius: t.radius, dur: t.duration });
        this.smokeUntil = performance.now() + t.duration * 1000;
        this.smokePos = pos.clone();
      } else if (t.id === 'pwall') {
        const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
        const pos = this.myTitan.pos.clone().addScaledVector(fwd, 6);
        this.spawnPwall(pos, this.pilotYawForWall(fwd), this.team, t.duration);
        this.sendFx({ type: 'pwall', pos: pos.toArray(), yaw: this.pilotYawForWall(fwd), team: this.team, dur: t.duration });
      }
      this.hud.hint(t.name.toUpperCase() + ' ACTIVE');
    } else if (this.mode === 'pilot') {
      if (this.pilot.useTactical()) {
        this.hud.hint(this.pilot.tactical.name.toUpperCase() + ' ACTIVE');
        const kind = this.pilot.tactical.id === 'cloak' ? 'cloak' : this.pilot.tactical.id === 'stim' ? 'stim' : 'radar';
        sfx.play(kind);
        this.sendFx({ type: 'tactical', kind, pos: this.pilot.pos.toArray() });
      }
    }
  }

  pilotYawForWall(fwd) { return Math.atan2(fwd.x, fwd.z); }

  spawnPwall(pos, yaw, team, dur) {
    const mesh = this.effects.particleWall(pos, yaw, team === this.team ? 0x7ad7ff : 0xff7a5a, dur);
    mesh.userData.pwallTeam = team;
    const entry = { mesh, team, until: performance.now() + dur * 1000 };
    this.pwalls.push(entry);
    this.refreshTargets();
    setTimeout(() => {
      this.pwalls = this.pwalls.filter(w => w !== entry);
      this.refreshTargets();
    }, dur * 1000);
  }

  // melee: pilot jump-kick / titan punch / Ronin broadsword (C)
  melee() {
    if ((this._meleeCd || 0) > 0 || this.mode === 'dead' || this.mode === 'rodeo') return;
    const isRonin = this.mode === 'titan' && this.myTitan?.chassis.id === 'ronin';
    const wid = this.mode === 'titan' ? (isRonin ? 'ronin_sword' : 'titan_punch') : 'pilot_melee';
    const def = MELEE[wid];
    this._meleeCd = def.cooldown;
    this._meleeAnim = 0.28;
    sfx.play(isRonin ? 'shot_energy' : 'dash');
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    const origin = this.camera.position;
    let landed = false;
    for (const e of this.getEnemyTargets(true)) {
      const to = e.pos.clone().sub(origin);
      const d = to.length();
      if (d > def.range + (e.isTitan ? 2 : 0)) continue;
      if (to.normalize().dot(fwd) < 0.45) continue;   // ~60° front arc
      if (e.isTitan && this.isVortexBlocking(e.id, origin)) continue;
      this.sendHit(e.id, e.isTitan ? 'titan' : 'pilot', 'melee', wid, false, 1);
      landed = true;
    }
    // slash / punch visual, networked
    const p = origin.clone().addScaledVector(fwd, this.mode === 'titan' ? 4 : 1.5);
    if (isRonin) {
      this.effects.slash(p, this.pilot.yaw);
      this.sendFx({ type: 'slash', pos: p.toArray(), yaw: this.pilot.yaw });
    } else {
      this.effects.sparks(p, 3, 0xcfe0ff);
      this.sendFx({ type: 'boomlite', pos: p.toArray() });
    }
    if (landed) this.addShake(0.06);
  }

  toggleAiMode() {
    if (!this.myTitan || this.mode === 'titan') return;
    this.myTitan.aiMode = this.myTitan.aiMode === 'follow' ? 'guard' : 'follow';
    if (this.myTitan.aiMode === 'guard') this.myTitan.guardPoint.copy(this.myTitan.pos);
    this.hud.hint(`AUTO-TITAN: ${this.myTitan.aiMode.toUpperCase()} MODE`);
  }

  requestTitanfall() {
    if (this.myTitan) { this.toggleAiMode(); return; }   // V after deployment: guard/follow toggle (TF1 style)
    if (!this.meterReady) { this.hud.hint('TITAN NOT READY'); return; }
    // drop point: ahead of the player, on open ground
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const pos = this.pilot.pos.clone().addScaledVector(fwd, 14);
    socket.emit('titanfall:request', { pos: [pos.x, 0, pos.z] }, (r) => {
      if (r?.error) this.hud.hint(r.error.toUpperCase());
    });
  }

  interact() {
    if (this.mode === 'titan') { socket.emit('titan:disembark'); return; }
    if (this.mode === 'rodeo') { this.endRodeo(false); return; }
    if (this.mode !== 'pilot') return;
    if (this.mode === 'ride') { this.endRide(false); return; }
    // embark own titan?
    if (this.myTitan && !this.myTitan.falling && this.pilot.pos.distanceTo(this.myTitan.pos) < 7) {
      socket.emit('titan:embark');
      return;
    }
    for (const r of this.remotes.values()) {
      if (!r.titan || r.titan.falling) continue;
      if (this.pilot.pos.distanceTo(r.titan.pos) >= 7) continue;
      if (r.team === this.team) {
        // hitch a ride on a teammate's titan (no embark)
        this.startRide(r.id);
        return;
      }
      this.startRodeo(r.id);
      return;
    }
    this.hud.hint('NOTHING NEARBY (E = EMBARK / RODEO / RIDE)');
  }

  startRodeo(id) {
    this.mode = 'rodeo';
    this.rodeoTargetId = id;
    this.pilot.frozen = true;
    this.hud.hint('RODEO! SHOOT THE HULL — SPACE TO LEAP OFF');
    sfx.play('land');
  }

  endRodeo(leap) {
    this.mode = 'pilot';
    this.rodeoTargetId = null;
    this.pilot.frozen = false;
    if (leap) { this.pilot.vel.y = 12; this.pilot.jumpsLeft = 1; }
  }

  startRide(id) {
    this.mode = 'ride';
    this.rideTargetId = id;
    this.pilot.frozen = true;
    this.hud.hint('RIDING FRIENDLY TITAN — SPACE OR E TO HOP OFF');
  }

  endRide(leap) {
    this.mode = 'pilot';
    this.rideTargetId = null;
    this.pilot.frozen = false;
    if (leap) { this.pilot.vel.y = 10; this.pilot.jumpsLeft = 1; }
  }

  // ================= socket =================
  bindSocket() {
    const on = (ev, fn) => {
      socket.on(ev, fn);
      this.handlers = this.handlers || [];
      this.handlers.push([ev, fn]);
    };

    on('p:state', (s) => {
      if (!this.active || s.id === this.myId) return;
      const r = this.remotes.get(s.id);
      if (r) r.applyState(s);
    });

    on('fx', (fx) => this.remoteFx(fx));

    on('hitmarker', ({ dmg, headshot, part }) => {
      this.hud.hitmarker(headshot);
      sfx.play(headshot ? 'hit_crit' : 'hit');
    });

    on('health', (h) => {
      if (h.id === this.myId) {
        if (h.pilotHp < this.pilotHp) this.damageFlash();
        this.pilotHp = h.pilotHp;
        this.hud.setHealth(this.pilotHp, MATCH.pilotHealth);
        if (h.titan && this.myTitan) {
          this.myTitanHealth = h.titan;
          this.hud.setTitanBars(h.titan.shield, h.titan.maxShield, h.titan.hp, h.titan.maxHp, true);
          this.myTitan.updateHealthBar(h.titan.shield, h.titan.maxShield, h.titan.hp, h.titan.maxHp, h.titan.doomed);
          if (this.mode === 'titan') this.hud.setHealth(h.titan.hp, h.titan.maxHp);
        }
      } else {
        const r = this.remotes.get(h.id);
        if (r) {
          r.dead = h.mode === 'dead';
          if (h.titan && r.titan) r.titan.updateHealthBar(h.titan.shield, h.titan.maxShield, h.titan.hp, h.titan.maxHp, h.titan.doomed);
        }
      }
    });

    on('death', ({ victim, killer, how }) => {
      const vName = this.nameOf(victim), kName = killer ? this.nameOf(killer) : null;
      const tv = this.tallies.get(victim); if (tv) tv.deaths++;
      if (killer) { const tk = this.tallies.get(killer); if (tk) tk.kills++; }
      if (victim === this.myId) {
        // clean up rodeo/ride state so we don't respawn frozen
        this.rodeoTargetId = null;
        this.rideTargetId = null;
        this.pilot.frozen = false;
        this.mode = 'dead';
        this.hud.showRespawn(true, kName ? `Killed by ${kName}` : 'You died');
      } else {
        const r = this.remotes.get(victim);
        if (r) r.dead = true;
        this.effects.explosion(r ? r.pilotCenter() : new THREE.Vector3(), 1.5, 0xff5560);
      }
    });

    on('respawn', ({ id }) => {
      if (id === this.myId) {
        this.hud.showRespawn(false);
        this.spawnSelf();
      } else {
        const r = this.remotes.get(id);
        if (r) r.dead = false;
      }
    });

    on('killfeed', ({ killer, victim, how }) => {
      const kk = this.tallies.get(killer), vv = this.tallies.get(victim);
      const kTeam = kk?.team || 'imc', vTeam = vv?.team || 'militia';
      this.hud.killfeed(`<b class="${kTeam}">${this.nameOf(killer)}</b> ${how === 'titan_destroyed' ? '🤖' : '☠'} <b class="${vTeam}">${this.nameOf(victim)}</b>`);
    });

    on('xp', ({ key, amount }) => {
      this.hud.xpToast(key, amount);
      if (key === 'firstBlood') voice.say('First blood.');
    });

    on('match:tick', ({ timeLeft, scores, meters }) => {
      this.timeLeft = timeLeft;
      this.scores = scores;
      this.hud.setTimer(timeLeft);
      this.hud.setScores(scores.imc, scores.militia);
      const m = meters[this.myId];
      if (m) {
        const wasReady = this.meterReady;
        this.meterPct = m.meter / MATCH.titanBuildTime;
        this.meterReady = m.ready;
        this.hud.setMeter(this.meterPct, this.meterReady, this.mode === 'titan');
        if (!wasReady && m.ready) {
          this.hud.center('TITANFALL READY — PRESS V', 3000);
          sfx.play('ready');
          voice.say('Your Titan is ready. Stand by for Titanfall.');
        }
      }
    });

    on('titanfall', ({ id, pos, chassis }) => {
      const dropPos = new THREE.Vector3(pos[0], 0, pos[2]);
      // mark the landing zone (team colored, like the real game)
      const ownerTeam = id === this.myId ? this.team : (this.remotes.get(id)?.team || 'imc');
      this.effects.dropMarker(dropPos, teamColor(ownerTeam), 4);
      if (id === this.myId) {
        this.myTitan = new TitanEntity(this.scene, chassis, teamColor(this.team), this.myId);
        this.myTitan.beginFall(dropPos);
        this.myTitanAI = new TitanAI(this.myTitan, this);
        const c = this.myTitan.chassis;
        this.hud.setTitanBars(c.shield, c.shield, c.health, c.health, true);
        this.hud.center('STANDBY FOR TITANFALL');
        voice.say('Titanfall inbound.', { priority: true });
        this.refreshTargets();
      } else {
        const r = this.remotes.get(id);
        if (r) {
          r.ensureTitan(chassis).beginFall(dropPos);
          r.titanTarget.pos.copy(dropPos);
          this.refreshTargets();
        }
      }
      sfx.play('titanfall', this.distToCamera(dropPos));
    });

    on('embark', ({ id }) => {
      if (id === this.myId) {
        this.mode = 'titan';
        this.arsenal.triggerHeld = true;
        this.hud.setWeapon(this.arsenal.current);
        this.hud.setOrdnance(1, this.arsenal.titanOrdnance.name);
        sfx.play('embark');
        // brief cockpit boot transition
        const fl = $('embark-flash');
        fl.classList.remove('hidden', 'leaving');
        setTimeout(() => fl.classList.add('leaving'), 550);
        setTimeout(() => fl.classList.add('hidden'), 950);
        this.hud.center(this.myTitan ? `${TITAN_CHASSIS[this.myTitan.chassis.id].name.toUpperCase()} ONLINE — NEURAL LINK ESTABLISHED` : '');
        voice.say('Titan online. Neural link established. Welcome back, Pilot.');
      } else {
        const r = this.remotes.get(id); if (r) r.mode = 'titan';
        sfx.play('servo', 25);
      }
    });
    on('disembark', ({ id }) => {
      if (id === this.myId) {
        this.mode = 'pilot';
        sfx.play('disembark');
        if (this.myTitan) {
          const side = new THREE.Vector3(3.2, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.myTitan.yaw);
          this.pilot.pos.copy(this.myTitan.pos).add(side); this.pilot.pos.y += 1;
          this.pilot.vel.set(0, 2, 0);
        }
        this.arsenal.triggerHeld = true;
        this.hud.setWeapon(this.arsenal.current);
        this.hud.setOrdnance(this.arsenal.ordnanceLeft, this.arsenal.ordnance.name);
      } else {
        const r = this.remotes.get(id); if (r) r.mode = 'pilot';
      }
    });
    on('eject', ({ id }) => {
      if (id === this.myId) {
        this.mode = 'pilot';
        if (this.myTitan) { this.pilot.pos.copy(this.myTitan.pos); this.pilot.pos.y += 5; }
        this.pilot.vel.set(0, 34, 0);
        this.pilot.jumpsLeft = 2;
        this.hud.center('EJECT EJECT EJECT');
        sfx.play('eject');
        voice.say('Eject. Eject. Eject.', { priority: true });
        this.arsenal.triggerHeld = true;
        this.hud.setWeapon(this.arsenal.current);
      } else {
        const r = this.remotes.get(id); if (r) r.mode = 'pilot';
        sfx.play('eject', 30);
      }
    });

    on('titan:doomed', ({ id }) => {
      if (id === this.myId) {
        this.myTitan?.setDoomed();
        this.myTitan?.updateHealthBar(0, 1, 0, 1, true);
        this.hud.center('⚠ TITAN DOOMED — PRESS X TO EJECT ⚠', 4000);
        sfx.play('doom');
        voice.say('Warning. Titan critically damaged. Eject immediately.', { priority: true });
      } else {
        const t = this.remotes.get(id)?.titan;
        t?.setDoomed();
        t?.updateHealthBar(0, 1, 0, 1, true);
      }
    });

    on('titan:dead', ({ id }) => {
      let pos = null;
      if (id === this.myId) {
        if (this.rodeoTargetId) this.endRodeo(false);
        if (this.myTitan) { pos = this.myTitan.centerPos; this.myTitan.dispose(); }
        this.myTitan = null; this.myTitanAI = null;
        this.hud.setTitanBars(0, 1, 0, 1, false);
        if (this.mode === 'titan') this.mode = 'pilot';
      } else {
        const r = this.remotes.get(id);
        if (r?.titan) { pos = r.titan.centerPos; r.removeTitan(); }
        if (this.rodeoTargetId === id) this.endRodeo(true);
        if (this.rideTargetId === id) this.endRide(true);
      }
      if (pos) { this.effects.explosion(pos, 10, 0xff8a3d); sfx.play('explosion', this.distToCamera(pos)); }
      this.refreshTargets();
    });

    on('grunts', (list) => this.gruntMgr.applySnapshot(list));
    on('grunt:deploy', ({ method, pos, team }) => this.gruntMgr.playDeploy(method, pos, team));
    on('grunt:dead', ({ id, pos }) => {
      if (pos) this.effects.explosion(new THREE.Vector3().fromArray(pos), 1.2, 0xff6a5a);
      this.gruntMgr.remove(id);
    });
    on('gruntfire', ({ from, to }) => this.gruntMgr.fireFx(from, to));

    on('player:joined', (info) => { if (info.id !== this.myId && !this.remotes.has(info.id)) this.addRemote(info); });
    on('player:left', ({ id }) => {
      const r = this.remotes.get(id);
      if (r) { r.dispose(); this.remotes.delete(id); this.refreshTargets(); }
    });

    on('match:end', (res) => this.showResults(res));
  }

  remoteFx(fx) {
    if (!this.active) return;
    const v3 = (a) => new THREE.Vector3().fromArray(a);
    switch (fx.type) {
      case 'tracer': this.effects.tracer(v3(fx.from), v3(fx.to)); sfx.play('shot', this.distToCamera(v3(fx.from))); break;
      case 'beam': this.effects.beam(v3(fx.from), v3(fx.to)); sfx.play('shot_energy', this.distToCamera(v3(fx.from))); break;
      case 'rocket':
        this.projectiles.spawn({ from: v3(fx.from), dir: v3(fx.dir), speed: fx.speed, homingTargetId: fx.target || null, damage: null, color: 0xff9a4d, size: 0.25 });
        sfx.play('shot_heavy', this.distToCamera(v3(fx.from)));
        break;
      case 'boom': this.effects.explosion(v3(fx.pos), fx.radius || 4); sfx.play('explosion', this.distToCamera(v3(fx.pos))); break;
      case 'esmoke': this.effects.smoke(v3(fx.pos), fx.radius, fx.dur); break;
      case 'pwall': this.spawnPwall(v3(fx.pos), fx.yaw, fx.team, fx.dur); break;
      case 'jets': this.effects.jets(v3(fx.pos)); sfx.play('jets', this.distToCamera(v3(fx.pos))); break;
      case 'slash': this.effects.slash(v3(fx.pos), fx.yaw); sfx.play('shot_energy', this.distToCamera(v3(fx.pos))); break;
      case 'boomlite': this.effects.sparks(v3(fx.pos), 3, 0xcfe0ff); sfx.play('dash', this.distToCamera(v3(fx.pos))); break;
      case 'dash': this.effects.dashTrail(v3(fx.pos), v3(fx.dir)); sfx.play('dash', this.distToCamera(v3(fx.pos))); break;
      case 'tactical': sfx.play(fx.kind, this.distToCamera(v3(fx.pos))); break;
    }
  }

  // ================= helpers used by weapons / projectiles / AI =================
  addShake(amount) { this.shake = Math.min(0.5, this.shake + amount); }

  // rebuild the first-person gun model for the currently held weapon
  refreshViewmodel() {
    if (this.viewmodel) {
      this.camera.remove(this.viewmodel);
      this.viewmodel.traverse(o => {
        if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
        o.material?.dispose?.();
      });
    }
    this.viewmodel = makeViewmodel(this.arsenal.current.def);
    this.camera.add(this.viewmodel);
  }

  nameOf(id) { return id === this.myId ? this.me.name : (this.remotes.get(id)?.name || '???'); }
  isEnemy(id) { const r = this.remotes.get(id); return r && r.team !== this.team; }
  isEnemyGrunt(id) { const g = this.gruntMgr.grunts.get(id); return g && g.team !== this.team; }
  distToCamera(pos) { return this.camera.position.distanceTo(pos); }
  kickRecoil(amount) { this.recoil += amount; }
  getOwnerPos() { return this.pilot.pos.clone(); }

  getEnemyTargets(includeAll = false) {
    const out = [];
    for (const r of this.remotes.values()) {
      if (r.team === this.team) continue;
      if (!r.dead && r.mode === 'pilot' && !r.cloaked) out.push({ id: r.id, pos: r.pilotCenter(), isTitan: false });
      else if (!r.dead && r.mode === 'pilot' && r.cloaked && includeAll) out.push({ id: r.id, pos: r.pilotCenter(), isTitan: false, cloaked: true });
      if (r.titan && !r.titan.falling) out.push({ id: r.id, pos: r.titan.centerPos, isTitan: true });
    }
    out.push(...this.gruntMgr.enemyEntries(this.team));
    return out;
  }

  getTargetPos(id) {
    const r = this.remotes.get(id);
    if (!r) return null;
    if (r.titan && !r.titan.falling) return r.titan.centerPos;
    return r.pilotCenter();
  }

  hasLineOfSight(from, to) {
    const dir = to.clone().sub(from);
    const dist = dir.length();
    dir.normalize();
    this.raycaster.set(from, dir);
    this.raycaster.far = dist - 0.5;
    const hits = this.raycaster.intersectObjects(this.world.meshes, false);
    return hits.length === 0;
  }

  pointBlocked(p) {
    for (const c of this.world.colliders) {
      if (p.x > c.min.x && p.x < c.max.x && p.y > c.min.y && p.y < c.max.y && p.z > c.min.z && p.z < c.max.z) return true;
    }
    return false;
  }

  isVortexBlocking(targetId, shooterPos) {
    const r = this.remotes.get(targetId);
    if (!r?.titan || !r.titanVortexActive) return false;
    // vortex blocks shots arriving at the titan's front hemisphere
    const fwd = new THREE.Vector3(-Math.sin(r.titan.yaw), 0, -Math.cos(r.titan.yaw));
    const toShooter = shooterPos.clone().sub(r.titan.centerPos).normalize();
    return fwd.dot(toShooter) > 0.1;
  }

  sendHit(target, part, slot, weapon, headshot, pellets) {
    // my own vortex? absorbed handled by shooter side; nothing to do here
    socket.emit('hit', { target, part, slot, weapon, headshot, pellets });
  }
  sendFx(fx) { socket.emit('fx', fx); }

  fireAutoTitanShot(from, dir, target) {
    // auto-titan hitscan with the equipped titan primary
    this.raycaster.set(from, dir);
    this.raycaster.far = 200;
    const hit = this.raycaster.intersectObjects(this.raycastTargets, true)[0];
    const end = hit ? hit.point : from.clone().addScaledVector(dir, 200);
    this.effects.tracer(from, end, 0x9ad7ff);
    this.sendFx({ type: 'tracer', from: from.toArray(), to: end.toArray() });
    if (hit?.object.userData.gruntId && this.isEnemyGrunt(hit.object.userData.gruntId)) {
      this.sendHit(hit.object.userData.gruntId, 'pilot', 'titanPrimary', this.loadout.titan.primary, false, 1);
      return;
    }
    if (hit?.object.userData.playerId && this.isEnemy(hit.object.userData.playerId)) {
      const part = hit.object.userData.part === 'titan' ? 'titan' : 'pilot';
      if (part === 'titan' && this.isVortexBlocking(hit.object.userData.playerId, from)) return;
      this.sendHit(hit.object.userData.playerId, part, 'titanPrimary', this.loadout.titan.primary, false, 1);
    }
  }

  damageFlash() {
    const el = $('damage-overlay');
    el.classList.add('show');
    this.addShake(0.06);
    clearTimeout(this._dmgT);
    this._dmgT = setTimeout(() => el.classList.remove('show'), 220);
  }

  // ================= electric smoke damage (owner deals it) =================
  updateSmoke() {
    if (!this.smokeUntil || performance.now() > this.smokeUntil) return;
    if (!this._smokeTick || performance.now() - this._smokeTick > 500) {
      this._smokeTick = performance.now();
      for (const e of this.getEnemyTargets(true)) {
        if (e.pos.distanceTo(this.smokePos) < TITAN_TACTICALS.esmoke.radius) {
          this.sendHit(e.id, e.isTitan ? 'titan' : 'pilot', 'titanTactical', 'esmoke', false, 1);
        }
      }
    }
  }

  // ================= scoreboard / results =================
  showScoreboard(show) {
    $('scoreboard').classList.toggle('hidden', !show);
    if (!show) return;
    const rows = [...this.tallies.entries()]
      .map(([id, t]) => ({ id, ...t }))
      .concat([{ id: this.myId, ...this.myTally() }])
      .filter((v, i, a) => a.findIndex(x => x.id === v.id) === i)
      .sort((a, b) => (b.kills - a.kills));
    $('scoreboard-table').innerHTML =
      `<tr><th>PILOT</th><th>TEAM</th><th>KILLS</th><th>DEATHS</th></tr>` +
      rows.map(r => `<tr class="${r.team}"><td>${r.name}${r.id === this.myId ? ' (you)' : ''}</td><td>${r.team.toUpperCase()}</td><td>${r.kills}</td><td>${r.deaths}</td></tr>`).join('');
  }
  myTally() {
    if (!this.tallies.has(this.myId)) this.tallies.set(this.myId, { kills: 0, deaths: 0, name: this.me.name, team: this.team });
    return this.tallies.get(this.myId);
  }

  showResults(res) {
    this.resultsShown = true;
    this.input.unlock();
    if (!res.winner) voice.say('Ceasefire. The match ends in a draw.', { priority: true });
    else if (res.winner === this.team) voice.say('Mission accomplished. Your team is victorious. Good work, Pilot.', { priority: true });
    else voice.say('Mission failed. Better luck on the next drop, Pilot.', { priority: true });
    const me = res.results.find(r => r.id === this.myId);
    if (me?.profile) {
      import('../ui.js').then(ui => ui.setProfile(me.profile));
      if (me.profile.level > this.me.level) { sfx.play('levelup'); }
    }
    const rows = res.results.sort((a, b) => b.kills - a.kills).map(r =>
      `<tr><td>${r.name}</td><td>${r.team.toUpperCase()}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.titanKills}</td><td>+${r.xpEarned} XP${r.profile && r.id === this.myId ? ` → LVL ${r.profile.level}` : ''}</td></tr>`).join('');
    $('results-body').innerHTML = `
      <div class="win-banner ${res.winner || ''}">${res.winner ? res.winner.toUpperCase() + ' VICTORY' : 'DRAW'}</div>
      <div>IMC ${res.scores.imc} — ${res.scores.militia} MILITIA</div>
      <table><tr><th>PILOT</th><th>TEAM</th><th>K</th><th>D</th><th>TITANS</th><th>REWARD</th></tr>${rows}</table>
      <button class="btn primary" id="btn-results-continue">CONTINUE</button>`;
    $('results-overlay').classList.remove('hidden');
    $('btn-results-continue').onclick = () => {
      $('results-overlay').classList.add('hidden');
      this.dispose();
      this.onReturnToLobby();
    };
  }

  showPause(show) {
    $('pause-overlay').classList.toggle('hidden', !show);
    if (show) this.input.unlock();
  }

  // ================= main loop =================
  loop(t) {
    if (!this.active) return;
    this.animFrame = requestAnimationFrame((tt) => this.loop(tt));
    const dt = Math.min(0.05, (t - this.lastTime) / 1000);
    this.lastTime = t;

    const { dx, dy } = this.input.consumeMouse();
    this.aiming = this.input.mouse2Down;

    // ---- look ----
    if (this.mode !== 'dead') {
      const sens = this.aiming ? 0.0012 : 0.0022;
      this.pilot.applyLook(dx, dy, sens);
      if (this.recoil > 0) { this.pilot.pitch += this.recoil; this.recoil = 0; }
    }

    // ---- movement / simulation ----
    if (this.mode === 'pilot') {
      const r = this.pilot.update(dt);
      // camera tilt during wallrun
      this.targetRoll = r.wallRunning ? (this.pilot.wallRun.normal.dot(new THREE.Vector3(-Math.cos(this.pilot.yaw), 0, Math.sin(this.pilot.yaw))) > 0 ? -0.18 : 0.18) : 0;
    } else if (this.mode === 'titan' && this.myTitan) {
      this.driveTitan(dt);
      this.targetRoll = 0;
    } else if (this.mode === 'rodeo') {
      const r = this.remotes.get(this.rodeoTargetId);
      if (r?.titan) {
        const back = new THREE.Vector3(0, 4.4, -1.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), r.titan.yaw);
        this.pilot.pos.copy(r.titan.pos).add(back);
      } else this.endRodeo(false);
    } else if (this.mode === 'ride') {
      const r = this.remotes.get(this.rideTargetId);
      if (r?.titan && !r.dead) {
        const perch = new THREE.Vector3(1.9, 4.3, -0.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), r.titan.yaw);
        this.pilot.pos.copy(r.titan.pos).add(perch);
      } else this.endRide(false);
    }

    // TF1-style auto-rodeo: land on top of an enemy titan and you latch on
    if (this.mode === 'pilot' && !this.pilot.onGround && this.pilot.vel.y < 1) {
      for (const r of this.remotes.values()) {
        if (r.team === this.team || !r.titan || r.titan.falling) continue;
        const t = r.titan;
        const top = t.pos.y + 4.4 * t.chassis.scale;
        const dx = this.pilot.pos.x - t.pos.x, dz = this.pilot.pos.z - t.pos.z;
        if (dx * dx + dz * dz < 7 && this.pilot.pos.y > top - 1 && this.pilot.pos.y < top + 2.5) {
          this.startRodeo(r.id);
          break;
        }
      }
    }

    // my titan: falling / AI
    if (this.myTitan) {
      // hide my own titan body while embarked: clear windscreen view (others still see it)
      this.myTitan.mesh.visible = this.mode !== 'titan';
      this.myTitan.healthBar.visible = this.mode !== 'titan';
      if (this.myTitan.falling) this.myTitan.updateFall(dt, this.effects);
      else if (this.mode !== 'titan' && this.myTitanAI) this.myTitanAI.update(dt);
      this.myTitan.updateDoomFlash(dt);
      if (this.mode !== 'titan' && !this.myTitan.falling && this.pilot.pos.distanceTo(this.myTitan.pos) < 7 && this.mode === 'pilot') {
        this.hud.hint('PRESS E TO EMBARK', 500);
      }
    }
    if (this.titanTacticalCd > 0) this.titanTacticalCd -= dt;
    if (this._meleeCd > 0) this._meleeCd -= dt;
    if (this._meleeAnim > 0) this._meleeAnim -= dt;
    this.updateSmoke();

    // ---- weapons ----
    if ((!this.intro || this.intro.phase === 'done') && (this.mode === 'pilot' || this.mode === 'titan' || this.mode === 'rodeo' || this.mode === 'ride')) {
      if (this.mode === 'rodeo' && this.input.mouseDown) {
        // rodeo fire: guaranteed hull hits with current sidearm rate
        if (!this._rodeoCd || this._rodeoCd <= 0) {
          this._rodeoCd = 0.25;
          this.sendHit(this.rodeoTargetId, 'rodeo', 'sidearm', this.loadout.pilot.sidearm, false, 1);
          sfx.play('shot');
          const tp = this.getTargetPos(this.rodeoTargetId);
          if (tp) this.effects.muzzle(this.camera.position.clone());
        }
        this._rodeoCd -= dt;
      } else {
        if (this._rodeoCd) this._rodeoCd -= dt;
        this.arsenal.update(dt, this.camera, this.input.mouseDown && this.mode !== 'dead', this.aiming);
      }
    }

    // ---- HUD timers ----
    if (this.mode === 'pilot') {
      const tac = this.pilot.tactical;
      const pct = this.pilot.tacticalActive > 0 ? 1 : Math.max(0, 1 - this.pilot.tacticalCooldown / tac.cooldown);
      this.hud.setTactical(tac.name, pct);
    } else if (this.mode === 'titan') {
      this.hud.setTactical(this.titanTactical.name, Math.max(0, 1 - this.titanTacticalCd / this.titanTactical.cooldown));
    }

    // ---- radar pulse ----
    if (this.pilot.radarActive && Math.random() < dt * 8) {
      for (const e of this.getEnemyTargets(true)) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(e.isTitan ? 1.6 : 0.5, 6, 5),
          new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, opacity: 0.5, depthTest: false }));
        m.position.copy(e.pos);
        this.effects.add(m, 0.3, (it, tt) => { m.material.opacity = 0.5 * (1 - tt); });
      }
    }

    // ---- feel / overlays / camera ----
    this.updateFeel(dt);
    this.updateOverlays();
    this.updateCamera(dt);
    if (this.intro) this.updateIntro(dt);   // after camera: fly-phase chase cam overrides

    // ---- remotes / systems ----
    for (const r of this.remotes.values()) {
      if (r.titan?.falling) r.titan.updateFall(dt, this.effects);
      r.update(dt);
    }
    this.gruntMgr.update(dt);
    this.projectiles.update(dt);
    this.effects.update(dt);
    this.world.update?.(dt);

    // ---- fov / ads / sprint ----
    const sprinting = this.mode === 'pilot' && (this.input.down('ShiftLeft') || this.input.down('ShiftRight')) && this.pilot.onGround;
    const baseFov = 100 + (sprinting ? 6 : 0) + (this.pilot.stimmed ? 5 : 0);
    const targetFov = this.aiming ? (this.arsenal.current.def.scope ? 100 / this.arsenal.current.def.scope * 3 : 70) : baseFov;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 10);
    this.camera.updateProjectionMatrix();

    // ---- network send ----
    if (t - this.lastSend > 66) {
      this.lastSend = t;
      this.sendState();
    }

    this.renderer.render(this.scene, this.camera);
  }

  driveTitan(dt) {
    const T = this.myTitan;
    // heavy chassis: body yaw chases your view with limited turn rate
    let dy = this.pilot.yaw - T.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const turnRate = T.chassis.id === 'stryder' ? 4.2 : T.chassis.id === 'ogre' ? 2.4 : 3.2;
    T.yaw += THREE.MathUtils.clamp(dy, -turnRate * dt, turnRate * dt);
    const fwd = new THREE.Vector3(-Math.sin(T.yaw), 0, -Math.cos(T.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3();
    if (this.input.down('KeyW')) wish.add(fwd);
    if (this.input.down('KeyS')) wish.sub(fwd);
    if (this.input.down('KeyD')) wish.add(right);
    if (this.input.down('KeyA')) wish.sub(right);
    if (wish.lengthSq()) wish.normalize();
    if ((this.input.down('ShiftLeft') || this.input.down('ShiftRight')) && wish.lengthSq()) {
      if (!this._dashHeld) {
        if (T.dash(wish)) {
          this.effects.dashTrail(T.centerPos, wish.clone());
          this.sendFx({ type: 'dash', pos: T.centerPos.toArray(), dir: wish.toArray() });
          this.addShake(0.08);
        }
        this._dashHeld = true;
      }
    } else this._dashHeld = false;
    T.step(dt, this.world.colliders, wish);
    this.hud.setMeter(1, false, true);
  }

  updateCamera(dt) {
    if (this.mode === 'titan' && this.myTitan) {
      this.camera.position.copy(this.myTitan.eyePos);
    } else {
      this.camera.position.copy(this.pilot.pos).add(new THREE.Vector3(0, PILOT_EYE - 0.9, 0));
    }
    // head bob + landing dip
    this.camera.position.y += this.bobY || 0;
    if (this.landDip > 0) { this.camera.position.y -= this.landDip; this.landDip *= Math.exp(-9 * dt); }
    // camera shake
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.camera.position.z += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-5 * dt);
    }
    const roll = this.targetRoll || 0;
    if (this._roll === undefined) this._roll = 0;
    this._roll += (roll - this._roll) * Math.min(1, dt * 8);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pilot.pitch, this.pilot.yaw, this._roll);
    this.viewmodel.visible = (this.mode === 'pilot' || this.mode === 'rodeo' || this.mode === 'ride') && !this.scoped && this.intro?.phase !== 'cabin';
    // melee lunge: jab the viewmodel forward
    this.viewmodel.position.z = this._meleeAnim > 0 ? -0.35 * Math.sin(Math.PI * (1 - this._meleeAnim / 0.28)) : 0;
    // cloak shimmer on viewmodel
    this.viewmodel.traverse(o => {
      if (o.isMesh) { o.material.transparent = this.pilot.cloaked; o.material.opacity = this.pilot.cloaked ? 0.25 : 1; }
    });
  }

  // movement feel: view bob, footsteps, landing, wall-run audio
  updateFeel(dt) {
    const groundSpeed = Math.hypot(this.pilot.vel.x, this.pilot.vel.z);
    if (this.mode === 'pilot') {
      const moving = this.pilot.onGround && groundSpeed > 2;
      if (moving) {
        this.bobT += dt * groundSpeed * 1.5;
        this.bobY = Math.sin(this.bobT) * 0.045;
        const phase = Math.sin(this.bobT);
        if (phase < -0.7 && this.stepPhase >= -0.7) sfx.play('step');
        this.stepPhase = phase;
      } else {
        this.bobY = (this.bobY || 0) * Math.exp(-8 * dt);
      }
      // landing thump
      if (!this.wasGrounded && this.pilot.onGround) {
        const impact = Math.min(1, Math.abs(this._lastVy || 0) / 20);
        if (impact > 0.25) { sfx.play('land'); this.landDip = 0.12 * impact; this.addShake(0.05 * impact); }
      }
      this.wasGrounded = this.pilot.onGround;
      this._lastVy = this.pilot.vel.y;
      // wall-run wind
      if (this.pilot.wallRun && Math.random() < dt * 5) sfx.play('wallrun');
    } else if (this.mode === 'titan' && this.myTitan) {
      const tSpeed = Math.hypot(this.myTitan.vel.x, this.myTitan.vel.z);
      if (tSpeed > 1.5) {
        this.bobT += dt * tSpeed * 0.55;
        this.bobY = Math.sin(this.bobT) * 0.16;
        const phase = Math.sin(this.bobT);
        if (phase < -0.7 && this.stepPhase >= -0.7) { sfx.play('step_titan'); this.addShake(0.04); }
        this.stepPhase = phase;
      } else this.bobY = (this.bobY || 0) * Math.exp(-6 * dt);
    } else this.bobY = 0;
  }

  // full-screen overlay states: scope / cloak / cockpit
  updateOverlays() {
    const w = this.arsenal.current;
    this.scoped = this.aiming && !!w.def.scope && this.mode === 'pilot';
    $('scope-overlay').classList.toggle('hidden', !this.scoped);
    $('crosshair').style.opacity = this.scoped ? '0' : '';
    $('cloak-overlay').classList.toggle('hidden', !(this.mode !== 'titan' && this.pilot.cloaked));
    $('cockpit-overlay').classList.toggle('hidden', this.mode !== 'titan');
  }

  sendState() {
    const feet = this.pilot.feetPos;   // remote pilot meshes have their origin at the feet
    const s = {
      pos: [+feet.x.toFixed(2), +feet.y.toFixed(2), +feet.z.toFixed(2)],
      yaw: +this.pilot.yaw.toFixed(3),
      mode: (this.mode === 'rodeo' || this.mode === 'ride') ? 'pilot' : this.mode,
      cloak: this.pilot.cloaked,
      titan: null
    };
    if (this.myTitan && !this.myTitan.falling) {
      s.titan = {
        pos: [+this.myTitan.pos.x.toFixed(2), +this.myTitan.pos.y.toFixed(2), +this.myTitan.pos.z.toFixed(2)],
        yaw: +this.myTitan.yaw.toFixed(3),
        vortex: performance.now() < this.titanVortexUntil
      };
    }
    socket.emit('p:state', s);
  }

  dispose() {
    this.active = false;
    sfx.stopAmbient();
    for (const id of ['scope-overlay', 'cloak-overlay', 'cockpit-overlay', 'embark-flash']) $(id).classList.add('hidden');
    cancelAnimationFrame(this.animFrame);
    removeEventListener('resize', this.onResize);
    document.removeEventListener('keyup', this.tabUp);
    for (const [ev, fn] of this.handlers || []) socket.off(ev, fn);
    for (const r of this.remotes.values()) r.dispose();
    this.gruntMgr.dispose();
    this.myTitan?.dispose();
    this.input.enabled = false;
    this.input.unlock();
    this.renderer.dispose();
    this.scene.clear();
    $('pause-overlay').classList.add('hidden');
    $('respawn-overlay').classList.add('hidden');
    $('scoreboard').classList.add('hidden');
    if (G === this) G = null;
  }
}
