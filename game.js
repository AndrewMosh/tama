const SAVE_KEY = "tamapal-save-v1";
const RECORD_KEY = "tamapal-record";
const SOUND_KEY = "tamapal-sound";

const GROWTH = [
  { id: "baby", at: 0 },
  { id: "child", at: 75 },
  { id: "teen", at: 180 },
  { id: "adult", at: 360 },
];

const HATCH_SECONDS = 10;

const $ = (id) => document.getElementById(id);

const game = {
  state: null,
  play: null,
  audioCtx: null,
  soundOn: true,
  lastSave: 0,
  lastMode: "",
  pulseTimer: 0,

  freshState() {
    return {
      started: false,
      name: "",
      hatched: false,
      eggTime: 0,
      stage: "egg",
      age: 0,
      hunger: 70,
      happiness: 80,
      energy: 80,
      hygiene: 90,
      health: 100,
      poops: 0,
      poopTimer: 0,
      sleeping: false,
      sleepLeft: 0,
      dead: false,
      menu: "",
      message: "",
      messageUntil: 0,
      lastTick: Date.now(),
    };
  },

  freshPlay() {
    return { active: false, pos: 0, dir: 1, hits: 0, tries: 0, speed: 68 };
  },

  clamp(value) {
    return Math.max(0, Math.min(100, value));
  },

  formatAge(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(total / 60);
    const remainder = total % 60;
    if (minutes <= 0) return `${remainder}s`;
    return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
  },

  titleCase(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  },

  stageFor(age) {
    let stage = "baby";
    for (const row of GROWTH) {
      if (age >= row.at) stage = row.id;
    }
    return stage;
  },

  nextGrowthLabel() {
    const marks = [
      ["a child", 75],
      ["a teen", 180],
      ["an adult", 360],
    ];
    for (const [label, at] of marks) {
      if (this.state.age < at) return `${label} in ${this.formatAge(at - this.state.age)}`;
    }
    return "all grown up";
  },

  readRecord() {
    return Number(localStorage.getItem(RECORD_KEY) || 0);
  },

  rememberRecord() {
    const previous = this.readRecord();
    if (this.state.age > previous) {
      localStorage.setItem(RECORD_KEY, String(this.state.age));
    }
  },

  setMessage(text) {
    this.state.message = text;
    this.state.messageUntil = Date.now() + 2800;
  },

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.state));
    } catch {
      // Ignore blocked or quota-limited storage; the game still runs in-session.
    }
  },

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return this.freshState();

      const data = JSON.parse(raw);
      const base = this.freshState();

      for (const key of Object.keys(base)) {
        if (key in data) base[key] = data[key];
      }

      base.name = String(base.name || "").slice(0, 14);
      base.menu = "";

      for (const key of [
        "eggTime",
        "age",
        "hunger",
        "happiness",
        "energy",
        "hygiene",
        "health",
        "poops",
        "poopTimer",
        "sleepLeft",
        "messageUntil",
        "lastTick",
      ]) {
        base[key] = Number(base[key]) || 0;
      }

      base.started = Boolean(base.started);
      base.hatched = Boolean(base.hatched);
      base.sleeping = Boolean(base.sleeping);
      base.dead = Boolean(base.dead);

      if (!["egg", "baby", "child", "teen", "adult"].includes(base.stage)) {
        base.stage = "egg";
      }

      return base;
    } catch {
      return this.freshState();
    }
  },

  hatchNow() {
    if (!this.state.started || this.state.hatched || this.state.dead) return;

    this.state.hatched = true;
    this.state.stage = "baby";
    this.state.age = 0;
    this.state.hunger = 68;
    this.state.happiness = 82;
    this.state.energy = 78;
    this.state.hygiene = 92;
    this.state.health = 100;
    this.state.poops = 0;
    this.state.poopTimer = 0;

    this.setMessage(`${this.state.name} hatched!`);
    $("screen").classList.add("evolve");
    window.setTimeout(() => $("screen").classList.remove("evolve"), 700);
    this.chime();
    this.spawnFloater("♥");
  },

  advanceStage() {
    const next = this.stageFor(this.state.age);
    if (next === this.state.stage) return;

    this.state.stage = next;
    const article = next === "adult" ? "an" : "a";
    this.setMessage(next === "adult" ? "All grown up!" : `Grew into ${article} ${next}!`);
    $("screen").classList.add("evolve");
    window.setTimeout(() => $("screen").classList.remove("evolve"), 700);
    this.beep(720, 0.12);
    this.spawnFloater("✦");
  },

  die() {
    if (this.state.dead) return;

    this.state.dead = true;
    this.state.health = 0;
    this.state.sleeping = false;
    this.state.sleepLeft = 0;
    this.state.menu = "";
    this.play.active = false;
    this.rememberRecord();
    this.save();
  },

  applyAwake(dt) {
    let left = dt;

    while (left > 0.0001 && !this.state.dead) {
      const step = Math.min(1, left);
      this.state.age += step;
      this.state.hunger = this.clamp(this.state.hunger - 0.28 * step);
      this.state.happiness = this.clamp(this.state.happiness - 0.16 * step);
      this.state.energy = this.clamp(this.state.energy - 0.2 * step);
      this.state.hygiene = this.clamp(this.state.hygiene - (0.1 + this.state.poops * 0.08) * step);
      this.state.poopTimer += step;

      if (this.state.poopTimer >= 48 && this.state.poops < 4) {
        this.state.poops += 1;
        this.state.poopTimer = 0;
        this.state.hygiene = this.clamp(this.state.hygiene - 8);
        this.state.happiness = this.clamp(this.state.happiness - 4);
      }

      let bad = 0;
      if (this.state.hunger < 18) bad += 1;
      if (this.state.happiness < 18) bad += 1;
      if (this.state.energy < 12) bad += 1;
      if (this.state.hygiene < 18) bad += 1;
      if (this.state.poops >= 3) bad += 1;

      if (bad > 0) {
        this.state.health = this.clamp(this.state.health - (0.35 + bad * 0.22) * step);
      } else if (
        this.state.hunger > 50 &&
        this.state.happiness > 50 &&
        this.state.hygiene > 50 &&
        this.state.energy > 35
      ) {
        this.state.health = this.clamp(this.state.health + 0.28 * step);
      }

      if (this.state.health <= 0) {
        this.die();
        return;
      }

      left -= step;
    }

    if (!this.state.dead) this.advanceStage();
  },

  simulate(dt) {
    if (!this.state.started || this.state.dead || dt <= 0) return;

    if (!this.state.hatched) {
      const need = Math.max(0, HATCH_SECONDS - this.state.eggTime);
      if (dt < need) {
        this.state.eggTime += dt;
        return;
      }

      this.state.eggTime = HATCH_SECONDS;
      const rest = dt - need;
      this.hatchNow();
      if (rest > 0) this.simulate(rest);
      return;
    }

    let left = dt;
    if (this.state.sleeping) {
      const step = Math.min(left, Math.max(0, this.state.sleepLeft));
      this.state.age += step;
      this.state.energy = this.clamp(this.state.energy + 4.2 * step);
      this.state.hunger = this.clamp(this.state.hunger - 0.15 * step);
      this.state.sleepLeft -= step;
      left -= step;

      if (this.state.sleepLeft <= 0.001) {
        this.state.sleeping = false;
        this.state.sleepLeft = 0;
        this.state.happiness = this.clamp(this.state.happiness + 6);
        this.state.energy = this.clamp(this.state.energy + 4);
        this.setMessage("Good morning!");
        this.beep(480, 0.1, "triangle");
      }
    }

    if (left > 0 && !this.state.sleeping && !this.state.dead) {
      this.applyAwake(left);
    } else if (!this.state.dead) {
      this.advanceStage();
    }
  },

  getMode() {
    if (!this.state.started) return "name";
    if (this.state.dead) return "dead";
    if (!this.state.hatched) return "egg";
    if (this.play.active) return "play";
    if (this.state.sleeping) return "sleep";
    if (this.state.menu === "feed") return "feed";
    return "main";
  },

  ready() {
    return this.state.started && this.state.hatched && !this.state.dead && !this.state.sleeping && !this.play.active;
  },

  currentMood() {
    if (this.state.dead) return "dead";
    if (!this.state.hatched) return "egg";
    if (this.state.sleeping) return "sleep";
    if (this.state.health < 35) return "sick";
    if (this.state.poops > 0 || this.state.hygiene < 28) return "dirty";
    if (this.state.hunger < 30) return "hungry";
    if (this.state.energy < 25) return "sleepy";
    if (this.state.happiness > 78) return "happy";
    if (this.state.happiness < 35) return "sad";
    return "ok";
  },

  currentMessage() {
    if (!this.state.started) return "Name the egg to begin";
    if (this.state.dead) return "They went back to the garden";
    if (this.state.sleeping) return `Sleeping… ${Math.max(1, Math.ceil(this.state.sleepLeft))}s`;
    if (this.play.active) {
      const noun = this.play.hits === 1 ? "hit" : "hits";
      return `Tap Catch in the pale box · ${this.play.hits} ${noun}`;
    }
    if (this.state.message && Date.now() < this.state.messageUntil) return this.state.message;
    if (!this.state.hatched) return "Tap the egg to hatch it";
    if (this.state.health < 35) return "Feeling sick…";
    if (this.state.poops > 0) return "Needs a cleanup";
    if (this.state.hunger < 30) return "Tummy is rumbling";
    if (this.state.energy < 25) return "So sleepy…";
    if (this.state.happiness < 30) return "Wants to play";
    return "Doing just fine";
  },

  setBar(id, value, lowAt) {
    const bar = $(id);
    bar.style.width = `${this.clamp(value)}%`;
    bar.parentElement.classList.toggle("low", value < lowAt);
  },

  updatePoops() {
    const box = $("poops");
    if (box.childElementCount === this.state.poops) return;

    box.replaceChildren();
    for (let i = 0; i < this.state.poops; i += 1) {
      const poop = document.createElement("span");
      poop.className = "poop";
      poop.style.left = `${12 + i * 22}%`;
      box.appendChild(poop);
    }
  },

  render() {
    const mode = this.getMode();
    const pet = $("pet");
    let crack = 0;

    if (!this.state.hatched) {
      if (this.state.eggTime > 7.5) crack = 3;
      else if (this.state.eggTime > 5) crack = 2;
      else if (this.state.eggTime > 2.5) crack = 1;
    }

    pet.dataset.stage = this.state.dead ? this.state.stage : this.state.hatched ? this.state.stage : "egg";
    pet.dataset.mood = this.currentMood();
    pet.dataset.crack = String(crack);
    pet.disabled = mode !== "egg";

    $("nameplate").textContent = this.state.started ? this.state.name : "A new egg";
    $("stageLabel").textContent = this.state.hatched ? this.titleCase(this.state.stage) : "Egg";
    $("ageLabel").textContent = this.state.hatched ? this.formatAge(this.state.age) : "";
    $("growthLabel").textContent = !this.state.started
      ? ""
      : this.state.dead
        ? `Lived ${this.formatAge(this.state.age)}`
        : this.state.hatched
          ? this.nextGrowthLabel()
          : `Hatches in ${Math.max(0, Math.ceil(HATCH_SECONDS - this.state.eggTime))}s`;

    $("stats").hidden = !this.state.hatched;
    $("eggProgress").hidden = !this.state.started || this.state.hatched || this.state.dead;

    if (this.state.hatched) {
      this.setBar("barHunger", this.state.hunger, 25);
      this.setBar("barHappy", this.state.happiness, 25);
      this.setBar("barEnergy", this.state.energy, 20);
      this.setBar("barHygiene", this.state.hygiene, 25);
      this.setBar("barHealth", this.state.health, 35);
    } else {
      $("barEgg").style.width = `${this.clamp((this.state.eggTime / HATCH_SECONDS) * 100)}%`;
    }

    this.updatePoops();
    $("message").textContent = this.currentMessage();
    $("submenu").hidden = mode !== "feed";
    $("minigame").hidden = mode !== "play";
    $("playScore").textContent = this.play.active ? `${this.play.tries}/5 tries` : "";
    if (this.play.active) $("marker").style.left = `${this.play.pos}%`;

    $("overlay").hidden = mode !== "name" && mode !== "dead";
    $("namePanel").hidden = mode !== "name";
    $("deathPanel").hidden = mode !== "dead";
    $("screen").classList.toggle("asleep", mode === "sleep");

    const best = Math.max(this.readRecord(), this.state.dead ? this.state.age : 0);
    $("recordLine").hidden = this.readRecord() <= 0;
    $("recordLine").textContent = `Longest life: ${this.formatAge(this.readRecord())}`;
    $("deathText").textContent = this.state.name ? `${this.state.name} lived ${this.formatAge(this.state.age)}.` : "";
    $("deathRecord").textContent = best > 0 ? `Longest life: ${this.formatAge(best)}` : "";

    $("btnFeed").textContent = mode === "feed" ? "Back" : "Feed";
    $("btnPlay").textContent = mode === "play" ? "Catch" : "Play";
    $("btnSleep").textContent = mode === "sleep" ? "Wake" : "Sleep";
    $("btnFeed").disabled = mode !== "main" && mode !== "feed";
    $("btnPlay").disabled = mode !== "main" && mode !== "play" && mode !== "feed";
    $("btnClean").disabled = mode !== "main" && mode !== "feed";
    $("btnSleep").disabled = mode !== "main" && mode !== "feed" && mode !== "sleep";
    $("btnPlay").classList.toggle("accent", mode === "play");
    $("btnRelease").hidden = !this.state.started || this.state.dead;

    if (mode !== this.lastMode) {
      this.lastMode = mode;
      if (mode === "name") $("nameInput").focus();
    }
  },

  spawnFloater(text) {
    const floater = document.createElement("span");
    floater.className = "floater";
    floater.textContent = text;
    $("fx").appendChild(floater);
    window.setTimeout(() => floater.remove(), 800);
  },

  pulse() {
    $("pet").dataset.anim = "eat";
    window.clearTimeout(this.pulseTimer);
    this.pulseTimer = window.setTimeout(() => {
      $("pet").dataset.anim = "";
    }, 650);
  },

  ensureAudio() {
    if (!this.audioCtx) this.audioCtx = new AudioContext();
    if (this.audioCtx.state === "suspended") this.audioCtx.resume();
  },

  beep(freq, dur, type = "sine", gain = 0.045) {
    if (!this.soundOn) return;

    try {
      this.ensureAudio();
      const osc = this.audioCtx.createOscillator();
      const amp = this.audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      amp.gain.value = gain;
      osc.connect(amp);
      amp.connect(this.audioCtx.destination);
      osc.start();
      amp.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + dur);
      osc.stop(this.audioCtx.currentTime + dur);
    } catch {
      // Audio is optional; if browser restrictions block it, ignore quietly.
    }
  },

  chime() {
    this.beep(523, 0.08);
    window.setTimeout(() => this.beep(659, 0.08), 90);
    window.setTimeout(() => this.beep(784, 0.12), 180);
  },

  onFeed() {
    if (this.state.menu === "feed") {
      this.state.menu = "";
      return;
    }
    if (!this.ready()) return;
    this.state.menu = "feed";
  },

  giveFood(kind) {
    if (this.state.menu !== "feed" || !this.ready()) return;

    this.state.menu = "";
    if (kind === "meal" && this.state.hunger >= 94) {
      this.state.hygiene = this.clamp(this.state.hygiene - 12);
      this.state.happiness = this.clamp(this.state.happiness - 6);
      this.setMessage("Way too full");
      this.beep(150, 0.12, "square", 0.03);
    } else if (kind === "meal") {
      this.state.hunger = this.clamp(this.state.hunger + 36);
      this.state.happiness = this.clamp(this.state.happiness + 5);
      this.setMessage("Yum!");
      this.beep(430, 0.08);
      this.spawnFloater("♥");
    } else {
      this.state.hunger = this.clamp(this.state.hunger + 14);
      this.state.happiness = this.clamp(this.state.happiness + 14);
      if (this.state.hunger >= 100) this.state.hygiene = this.clamp(this.state.hygiene - 5);
      this.setMessage("Sweet!");
      this.beep(560, 0.08);
      this.spawnFloater("✦");
    }

    this.pulse();
    this.save();
  },

  startPlay() {
    if (!this.ready()) return;
    if (this.state.energy < 16) {
      this.setMessage("Too sleepy to play");
      this.beep(140, 0.1, "square", 0.03);
      return;
    }

    this.state.menu = "";
    this.play.active = true;
    this.play.pos = 0;
    this.play.dir = 1;
    this.play.hits = 0;
    this.play.tries = 0;
    this.play.speed = 68;
  },

  catchStar() {
    if (!this.play.active) return;

    const hit = this.play.pos >= 38 && this.play.pos <= 62;
    this.play.tries += 1;
    const marker = $("marker");
    marker.classList.remove("hit", "miss");

    if (hit) {
      this.play.hits += 1;
      marker.classList.add("hit");
      this.beep(760, 0.05);
    } else {
      marker.classList.add("miss");
      this.beep(170, 0.07, "square", 0.03);
    }

    this.play.speed += 16;
    if (this.play.tries >= 5) this.finishPlay();
  },

  finishPlay() {
    if (!this.play.active) return;

    const hits = this.play.hits;
    this.play.active = false;
    const gain = 8 + hits * 11;
    this.state.happiness = this.clamp(this.state.happiness + gain);
    this.state.energy = this.clamp(this.state.energy - 16);
    this.state.hunger = this.clamp(this.state.hunger - 9);

    const line = hits === 5 ? "Perfect game!" : hits >= 3 ? "That was fun!" : "Thanks for trying";
    this.setMessage(`${line}  +${gain} joy`);
    this.beep(520, 0.1);
    if (hits >= 3) this.spawnFloater("♥");
    this.save();
  },

  moveMarker(dt) {
    let left = Math.min(dt, 0.2);
    while (left > 0) {
      const step = Math.min(0.016, left);
      this.play.pos += this.play.dir * this.play.speed * step;

      if (this.play.pos >= 100) {
        this.play.pos = 100;
        this.play.dir = -1;
      } else if (this.play.pos <= 0) {
        this.play.pos = 0;
        this.play.dir = 1;
      }

      left -= step;
    }
  },

  onPlay() {
    if (this.play.active) this.catchStar();
    else this.startPlay();
  },

  onClean() {
    if (!this.ready()) return;

    this.state.menu = "";
    if (this.state.poops === 0 && this.state.hygiene > 92) {
      this.setMessage("Already sparkling");
      return;
    }

    const hadPoop = this.state.poops > 0;
    this.state.poops = 0;
    this.state.hygiene = 100;
    this.state.happiness = this.clamp(this.state.happiness + (hadPoop ? 8 : 3));
    this.setMessage(hadPoop ? "All clean!" : "Scrub-a-dub");
    this.beep(620, 0.08);
    this.spawnFloater("✿");
    this.save();
  },

  onSleep() {
    if (!this.state.started || !this.state.hatched || this.state.dead || this.play.active) return;
    if (this.state.sleeping) {
      this.state.sleeping = false;
      this.state.sleepLeft = 0;
      this.state.happiness = this.clamp(this.state.happiness - 5);
      this.setMessage("Up already?");
      this.save();
      return;
    }
    if (!this.ready()) return;
    if (this.state.energy > 92) {
      this.setMessage("Not sleepy yet");
      return;
    }

    this.state.menu = "";
    this.state.sleeping = true;
    this.state.sleepLeft = 16;
    this.setMessage("Zzz…");
    this.beep(300, 0.14, "triangle", 0.04);
    this.save();
  },

  startNamedPet(name) {
    this.state = this.freshState();
    this.state.started = true;
    this.state.name = name;
    this.state.lastTick = Date.now();
    this.play = this.freshPlay();
    this.save();
    this.beep(560, 0.08);
  },

  newEgg(keepName) {
    const name = keepName ? this.state.name : "";
    this.rememberRecord();
    this.state = this.freshState();
    this.state.lastTick = Date.now();
    this.play = this.freshPlay();

    if (keepName && name) {
      this.state.started = true;
      this.state.name = name;
    } else {
      $("nameInput").value = name || "";
    }

    this.save();
  },

  frame() {
    const now = Date.now();
    let dt = (now - this.state.lastTick) / 1000;
    if (dt < 0) dt = 0;

    if (!this.state.started) {
      this.state.lastTick = now;
      this.render();
      requestAnimationFrame(() => this.frame());
      return;
    }

    const away = dt > 180;
    this.simulate(away ? 180 : dt);
    if (!away && this.play.active) this.moveMarker(dt);
    this.state.lastTick = now;

    if (away && this.state.hatched && !this.state.dead) {
      this.setMessage(`${this.state.name} missed you.`);
    }

    if (now - this.lastSave > 1000) {
      this.save();
      this.lastSave = now;
    }

    this.render();
    requestAnimationFrame(() => this.frame());
  },

  faceMarkup(cx, cy) {
    return `
      <g class="eyes-open">
        <ellipse cx="${cx - 14}" cy="${cy}" rx="5" ry="6.2" fill="#24301a"/>
        <ellipse cx="${cx + 14}" cy="${cy}" rx="5" ry="6.2" fill="#24301a"/>
        <ellipse cx="${cx - 12.4}" cy="${cy - 1.6}" rx="1.5" ry="1.8" fill="#fff"/>
        <ellipse cx="${cx + 15.6}" cy="${cy - 1.6}" rx="1.5" ry="1.8" fill="#fff"/>
      </g>
      <g class="eyes-shut">
        <path d="M${cx - 20} ${cy} q6 -7 12 0" fill="none" stroke="#24301a" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M${cx + 8} ${cy} q6 -7 12 0" fill="none" stroke="#24301a" stroke-width="2.5" stroke-linecap="round"/>
      </g>
      <ellipse cx="${cx - 24}" cy="${cy + 12}" rx="6" ry="3.4" fill="#f2a0b4"/>
      <ellipse cx="${cx + 24}" cy="${cy + 12}" rx="6" ry="3.4" fill="#f2a0b4"/>
      <path class="mouth mouth-happy" d="M${cx - 10} ${cy + 16} q10 12 20 0" fill="none" stroke="#24301a" stroke-width="2.5" stroke-linecap="round"/>
      <path class="mouth mouth-ok" d="M${cx - 8} ${cy + 18} q8 8 16 0" fill="none" stroke="#24301a" stroke-width="2.5" stroke-linecap="round"/>
      <path class="mouth mouth-sad" d="M${cx - 10} ${cy + 24} q10 -10 20 0" fill="none" stroke="#24301a" stroke-width="2.5" stroke-linecap="round"/>
      <ellipse class="mouth mouth-hungry" cx="${cx}" cy="${cy + 20}" rx="4.5" ry="3.6" fill="#24301a"/>
      <path class="mouth mouth-sick" d="M${cx - 11} ${cy + 20} q5 5 10 -1 t10 1" fill="none" stroke="#24301a" stroke-width="2.5" stroke-linecap="round"/>
      <path class="mouth mouth-sleepy" d="M${cx - 8} ${cy + 18} h16" fill="none" stroke="#24301a" stroke-width="2.5" stroke-linecap="round"/>
      <path class="sweat" d="M${cx + 34} ${cy - 8} q7 12 0 18 q-9 -7 0 -18z" fill="#e7f7ff" stroke="#24301a" stroke-width="1.6"/>
      <g class="stink">
        <path d="M${cx + 36} ${cy - 20} q8 -8 3 -16" fill="none" stroke="#24301a" stroke-width="2" stroke-linecap="round"/>
        <path d="M${cx + 46} ${cy - 16} q6 -7 2 -13" fill="none" stroke="#24301a" stroke-width="2" stroke-linecap="round"/>
      </g>
    `;
  },

  buildPet() {
    const baby = `
      <g class="stage stage-baby">
        <ellipse cx="80" cy="128" rx="26" ry="6" fill="#24301a" opacity="0.12"/>
        <ellipse class="body" cx="80" cy="96" rx="34" ry="30" fill="#ffe08a" stroke="#24301a" stroke-width="3"/>
        <ellipse cx="58" cy="120" rx="11" ry="7" fill="#ffd36b" stroke="#24301a" stroke-width="3"/>
        <ellipse cx="102" cy="120" rx="11" ry="7" fill="#ffd36b" stroke="#24301a" stroke-width="3"/>
        ${this.faceMarkup(80, 94)}
      </g>`;

    const child = `
      <g class="stage stage-child">
        <ellipse cx="80" cy="130" rx="28" ry="6" fill="#24301a" opacity="0.12"/>
        <path d="M80 52 v18" stroke="#2f8a3d" stroke-width="3" stroke-linecap="round"/>
        <ellipse cx="94" cy="52" rx="12" ry="7" fill="#6fbf73" stroke="#24301a" stroke-width="2.4" transform="rotate(28 94 52)"/>
        <ellipse class="body" cx="80" cy="98" rx="36" ry="32" fill="#ffe08a" stroke="#24301a" stroke-width="3"/>
        <ellipse cx="56" cy="124" rx="12" ry="7" fill="#ffd36b" stroke="#24301a" stroke-width="3"/>
        <ellipse cx="104" cy="124" rx="12" ry="7" fill="#ffd36b" stroke="#24301a" stroke-width="3"/>
        ${this.faceMarkup(80, 98)}
      </g>`;

    const teen = `
      <g class="stage stage-teen">
        <ellipse cx="80" cy="132" rx="32" ry="6" fill="#24301a" opacity="0.12"/>
        <ellipse cx="40" cy="104" rx="12" ry="7" fill="#ffd36b" stroke="#24301a" stroke-width="3" transform="rotate(-24 40 104)"/>
        <ellipse cx="120" cy="104" rx="12" ry="7" fill="#ffd36b" stroke="#24301a" stroke-width="3" transform="rotate(24 120 104)"/>
        <path d="M80 46 v16" stroke="#2f8a3d" stroke-width="3" stroke-linecap="round"/>
        <ellipse cx="98" cy="44" rx="16" ry="8" fill="#5eb365" stroke="#24301a" stroke-width="2.4" transform="rotate(24 98 44)"/>
        <ellipse class="body" cx="80" cy="96" rx="34" ry="36" fill="#ffe08a" stroke="#24301a" stroke-width="3"/>
        <ellipse cx="58" cy="126" rx="12" ry="7" fill="#ffd36b" stroke="#24301a" stroke-width="3"/>
        <ellipse cx="102" cy="126" rx="12" ry="7" fill="#ffd36b" stroke="#24301a" stroke-width="3"/>
        ${this.faceMarkup(80, 96)}
      </g>`;

    const adult = `
      <g class="stage stage-adult">
        <ellipse cx="80" cy="134" rx="36" ry="6" fill="#24301a" opacity="0.12"/>
        <ellipse cx="36" cy="108" rx="13" ry="8" fill="#ffd36b" stroke="#24301a" stroke-width="3" transform="rotate(-30 36 108)"/>
        <ellipse cx="124" cy="108" rx="13" ry="8" fill="#ffd36b" stroke="#24301a" stroke-width="3" transform="rotate(30 124 108)"/>
        <ellipse cx="58" cy="42" rx="16" ry="8" fill="#5eb365" stroke="#24301a" stroke-width="2.4" transform="rotate(-28 58 42)"/>
        <ellipse cx="104" cy="40" rx="18" ry="9" fill="#6fbf73" stroke="#24301a" stroke-width="2.4" transform="rotate(26 104 40)"/>
        <path d="M80 48 v14" stroke="#2f8a3d" stroke-width="3" stroke-linecap="round"/>
        <ellipse class="body" cx="80" cy="98" rx="40" ry="36" fill="#ffe08a" stroke="#24301a" stroke-width="3"/>
        <ellipse cx="80" cy="108" rx="12" ry="10" fill="#fff3c9"/>
        <ellipse cx="56" cy="128" rx="13" ry="8" fill="#ffd36b" stroke="#24301a" stroke-width="3"/>
        <ellipse cx="104" cy="128" rx="13" ry="8" fill="#ffd36b" stroke="#24301a" stroke-width="3"/>
        ${this.faceMarkup(80, 96)}
      </g>`;

    const egg = `
      <g class="stage stage-egg">
        <ellipse cx="80" cy="128" rx="28" ry="6" fill="#24301a" opacity="0.12"/>
        <ellipse cx="80" cy="86" rx="36" ry="46" fill="#f7f3e7" stroke="#24301a" stroke-width="3"/>
        <ellipse cx="66" cy="70" rx="10" ry="14" fill="#fff" opacity="0.75"/>
        <path class="crack crack-1" d="M68 52 l10 12 -8 8" fill="none" stroke="#24301a" stroke-width="2.4" stroke-linecap="round"/>
        <path class="crack crack-2" d="M98 66 l-12 8 7 12" fill="none" stroke="#24301a" stroke-width="2.4" stroke-linecap="round"/>
        <path class="crack crack-3" d="M76 96 l10 8 -6 12" fill="none" stroke="#24301a" stroke-width="2.4" stroke-linecap="round"/>
      </g>`;

    const ghost = `
      <g class="stage stage-ghost">
        <path d="M48 78 q32 -46 64 0 v46 q-10 -12 -21 0 q-11 -12 -22 0 q-10 -12 -21 0z" fill="#f7f6ef" stroke="#24301a" stroke-width="3"/>
        <circle cx="70" cy="84" r="4" fill="#24301a"/>
        <circle cx="96" cy="84" r="4" fill="#24301a"/>
        <circle cx="112" cy="118" r="7" fill="#f2a0b4" stroke="#24301a" stroke-width="2"/>
        <path d="M112 108 v8 M108 114 h8" stroke="#24301a" stroke-width="1.6" stroke-linecap="round"/>
      </g>`;

    const zzz = `
      <g class="zzz">
        <text x="108" y="36" font-size="14" font-family="Verdana" fill="#24301a">z</text>
        <text x="122" y="22" font-size="18" font-family="Verdana" fill="#24301a">Z</text>
      </g>`;

    $("pet").innerHTML = `<svg class="sprite" viewBox="0 0 160 150" aria-hidden="true">${egg}${baby}${child}${teen}${adult}${ghost}${zzz}</svg>`;
  },

  bindEvents() {
    $("namePanel").addEventListener("submit", (event) => {
      event.preventDefault();
      const name = $("nameInput").value.trim().slice(0, 14) || "Mochi";
      this.startNamedPet(name);
    });

    $("pet").addEventListener("click", () => {
      if (this.state.started && !this.state.hatched && !this.state.dead) {
        this.state.eggTime = HATCH_SECONDS;
        this.hatchNow();
        this.save();
      }
    });

    $("btnFeed").addEventListener("click", () => this.onFeed());
    $("btnMeal").addEventListener("click", () => this.giveFood("meal"));
    $("btnSnack").addEventListener("click", () => this.giveFood("snack"));
    $("btnCancelFeed").addEventListener("click", () => {
      this.state.menu = "";
    });
    $("btnPlay").addEventListener("click", () => this.onPlay());
    $("track").addEventListener("click", () => {
      if (this.play.active) this.catchStar();
    });
    $("btnClean").addEventListener("click", () => this.onClean());
    $("btnSleep").addEventListener("click", () => this.onSleep());
    $("btnAgain").addEventListener("click", () => this.newEgg(true));
    $("btnRename").addEventListener("click", () => this.newEgg(false));
    $("btnRelease").addEventListener("click", () => {
      if (!this.state.started || this.state.dead) return;
      const label = this.state.hatched ? `Let ${this.state.name} go and start a new egg?` : "Restart this egg?";
      if (!window.confirm(label)) return;
      this.newEgg(true);
    });
    $("btnSound").addEventListener("click", () => {
      this.soundOn = !this.soundOn;
      localStorage.setItem(SOUND_KEY, this.soundOn ? "on" : "off");
      $("btnSound").textContent = this.soundOn ? "Sound on" : "Sound off";
      if (this.soundOn) this.beep(600, 0.06);
    });

    window.addEventListener("keydown", (event) => {
      const typing = event.target instanceof HTMLInputElement;
      if (typing) return;

      const key = event.key.toLowerCase();
      if (key === "f") this.onFeed();
      if (key === "p") this.onPlay();
      if (key === "c") this.onClean();
      if (key === "s") this.onSleep();
      if (key === "escape") this.state.menu = "";
      if (event.code === "Space" && this.play.active) {
        event.preventDefault();
        this.catchStar();
      }
    });

    window.addEventListener("pagehide", () => this.save());
  },

  boot() {
    this.soundOn = localStorage.getItem(SOUND_KEY) !== "off";
    $("btnSound").textContent = this.soundOn ? "Sound on" : "Sound off";
    this.buildPet();

    this.state = this.load();
    this.play = this.freshPlay();

    const gap = (Date.now() - Number(this.state.lastTick || Date.now())) / 1000;
    this.state.lastTick = Date.now();

    if (this.state.started && gap > 2) {
      this.simulate(Math.min(gap, 180));
      if (gap > 30 && this.state.hatched && !this.state.dead) {
        this.setMessage(`${this.state.name} missed you.`);
      }
    }

    this.bindEvents();
    requestAnimationFrame(() => this.frame());
  },
};

game.boot();
