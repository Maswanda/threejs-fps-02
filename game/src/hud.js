// The DOM HUD: health, ammo, money, timer, score, killfeed, bomb status, crosshair,
// hit marker, damage flash, and the overlays (start / pause / buy / round end). It never
// touches the simulation; main.js pushes numbers in and reads callbacks out.
import { WEAPONS, GRENADE } from './weapons.js';

const OVERLAY_COPY = {
  start: {
    title: 'Emberline Depot',
    copy: 'Vanguard attacks, Sentinel defends. Plant the charge at A or B — or clear the site. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'Emberline Depot',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud(callbacks) {
  const $ = (id) => document.getElementById(id);
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const grenadeCount = $('grenade-count');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const timerLabel = $('timer-label');
  const scoreVan = $('score-van');
  const scoreSen = $('score-sen');
  const roundNum = $('round-num');
  const killfeed = $('killfeed');
  const bombStatus = $('bomb-status');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const damage = $('damage');
  const hint = $('hint');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const overlay = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayCopy = $('overlay-copy');
  const playButton = $('play');
  const buyMenu = $('buy-menu');
  const buyMoney = $('buy-money');
  const buyRows = $('buy-rows');
  const plantBar = $('plant-bar');
  const plantFill = $('plant-fill');

  let hitTimer = 0;
  let lastHealth = -1;
  let lastMag = -1;
  let lastReserve = -1;
  let lastMoney = -1;
  let lastTimer = -1;
  let lastScore = '';
  let buyOpen = false;

  function buildBuyRows() {
    buyRows.innerHTML = '';
    for (const def of Object.values(WEAPONS)) {
      const row = document.createElement('div');
      row.className = 'buy-row';
      row.dataset.id = def.id;
      row.innerHTML = `<span class="buy-name">${def.name}</span><span class="buy-desc">${def.damage} dmg · ${def.mag} rnd</span><span class="buy-price">$${def.price}</span><button type="button" data-buy="${def.id}">Buy</button>`;
      buyRows.appendChild(row);
    }
    const grenadeRow = document.createElement('div');
    grenadeRow.className = 'buy-row';
    grenadeRow.dataset.id = 'grenade';
    grenadeRow.innerHTML = `<span class="buy-name">${GRENADE.name}</span><span class="buy-desc">thrown with G · max ${GRENADE.maxCarry}</span><span class="buy-price">$${GRENADE.price}</span><button type="button" data-buy="grenade">Buy</button>`;
    buyRows.appendChild(grenadeRow);
    buyRows.addEventListener('click', (event) => {
      const button = event.target.closest('[data-buy]');
      if (!button) return;
      callbacks.onBuy(button.dataset.buy);
    });
  }
  buildBuyRows();

  return {
    setHealth(health) {
      const h = Math.max(0, Math.round(health));
      if (h === lastHealth) return;
      lastHealth = h;
      healthFill.style.width = `${h}%`;
      healthFill.classList.toggle('low', h <= 30);
      healthNum.textContent = String(h);
    },
    setAmmo(mag, reserve, name, grenades) {
      if (mag !== lastMag || reserve !== lastReserve) {
        lastMag = mag;
        lastReserve = reserve;
        ammoMag.textContent = String(mag);
        ammoReserve.textContent = `/ ${reserve}`;
        $('ammo').classList.toggle('empty', mag === 0);
      }
      weaponName.textContent = name;
      grenadeCount.textContent = `◉ ${grenades}`;
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = `$${value}`;
      buyMoney.textContent = `$${value}`;
    },
    setTimer(seconds, label) {
      const s = Math.max(0, Math.ceil(seconds));
      if (s === lastTimer && timerLabel.textContent === label) return;
      lastTimer = s;
      const m = Math.floor(s / 60);
      const r = s % 60;
      timerValue.textContent = `${m}:${String(r).padStart(2, '0')}`;
      timerLabel.textContent = label;
      timerValue.classList.toggle('urgent', s <= 10 && label !== 'BUY');
    },
    setScore(van, sen, round) {
      const key = `${van}-${sen}-${round}`;
      if (key === lastScore) return;
      lastScore = key;
      scoreVan.textContent = String(van);
      scoreSen.textContent = String(sen);
      roundNum.textContent = `ROUND ${round}`;
    },
    setBomb(text) {
      if (bombStatus.textContent === text) return;
      bombStatus.textContent = text;
      bombStatus.classList.toggle('hot', text.includes('PLANTED'));
    },
    setHint(text) {
      if (hint.textContent === text) return;
      hint.textContent = text;
    },
    setPlantProgress(frac) {
      if (frac === null) {
        plantBar.hidden = true;
        return;
      }
      plantBar.hidden = false;
      plantFill.style.width = `${Math.round(frac * 100)}%`;
    },
    setCrosshair(spreadPx) {
      crosshair.style.setProperty('--spread', `${Math.round(spreadPx)}px`);
    },
    hitMarker(killed) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, 110);
    },
    damageFlash() {
      damage.classList.add('on');
      setTimeout(() => damage.classList.remove('on'), 180);
    },
    killfeed(killer, victim, headshot, killerSide) {
      const entry = document.createElement('div');
      entry.className = 'feed-entry';
      entry.innerHTML = `<span class="${killerSide === 'attack' ? 'van' : 'sen'}">${killer}</span> <span class="feed-mid">${headshot ? '◉' : '—'}</span> <span class="${killerSide === 'attack' ? 'sen' : 'van'}">${victim}</span>`;
      killfeed.prepend(entry);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => entry.remove(), 5200);
    },
    showBanner(title, sub) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub;
      banner.hidden = false;
    },
    hideBanner() {
      banner.hidden = true;
    },
    showOverlay(mode, scoreText) {
      const text = OVERLAY_COPY[mode];
      overlayTitle.textContent = text.title;
      overlayCopy.textContent = mode === 'matchEnd' ? scoreText : text.copy;
      playButton.textContent = text.action;
      overlay.hidden = false;
      playButton.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    showBuy(money, owned, grenades) {
      buyOpen = true;
      this.setMoney(money);
      for (const row of buyRows.querySelectorAll('.buy-row')) {
        const id = row.dataset.id;
        const button = row.querySelector('button');
        if (id === 'grenade') {
          button.disabled = grenades >= GRENADE.maxCarry || money < GRENADE.price;
          button.textContent = grenades >= GRENADE.maxCarry ? 'Full' : 'Buy';
        } else {
          const def = WEAPONS[id];
          const has = !!owned[id];
          button.disabled = has || money < def.price;
          button.textContent = has ? 'Owned' : 'Buy';
        }
      }
      buyMenu.hidden = false;
    },
    hideBuy() {
      buyOpen = false;
      buyMenu.hidden = true;
    },
    get buyOpen() {
      return buyOpen;
    },
    onPlay(handler) {
      playButton.addEventListener('click', handler);
    },
  };
}
