import { generateLeague } from "./gen/league.js";
import { generateNCAAProspects, generateInternationalPool } from "./gen/prospects.js";
import { HOURS_BANK_MAX, HOURS_PER_WEEK, SEASON_WEEKS } from "./data/constants.js";
import { clamp } from "./utils.js";

const KEY_ACTIVE = "dynasty_active_slot";
const KEY_SAVE_PREFIX = "dynasty_save_"; // dynasty_save_A, etc.

let STATE = null;

export function getState(){ return STATE; }

export function ensureAppState(loadedOrNull){
  if (loadedOrNull){
    STATE = loadedOrNull;
    return;
  }
  STATE = newGameState();
}

export function newGameState(){
  const year = 1;
  const league = generateLeague({ seed: "v1_seed" });

  return {
    meta: {
      version: "0.1.0",
      createdAt: Date.now()
    },
    activeSaveSlot: null,
    game: {
      year,
      week: 1,
      seasonWeeks: SEASON_WEEKS,
      hours: {
        available: 25,
        banked: 0,
        bankMax: HOURS_BANK_MAX
      },
      league,
      scouting: {
        tab: "NCAA",
        ncaa: generateNCAAProspects({ year, count: 100, seed: "ncaa" }),
        intlPool: generateInternationalPool({ year, count: 100, seed: "intl" }),
        intlDiscoveredIds: [],
        intlLocation: null // continentKey or null
      },
      userTeamIndex: 0, // v1: first team
      inbox: [] // notifications
    }
  };
}

export function setActiveSaveSlot(slot){
  STATE.activeSaveSlot = slot;
  localStorage.setItem(KEY_ACTIVE, slot);
}

export function getActiveSaveSlot(){
  return localStorage.getItem(KEY_ACTIVE) || null;
}

export function loadActiveOrNull(){
  const slot = getActiveSaveSlot();
  if (!slot) return null;
  const raw = localStorage.getItem(KEY_SAVE_PREFIX + slot);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function saveToSlot(slot){
  STATE.activeSaveSlot = slot;
  localStorage.setItem(KEY_ACTIVE, slot);
  localStorage.setItem(KEY_SAVE_PREFIX + slot, JSON.stringify(STATE));
  return true;
}

export function loadFromSlot(slot){
  const raw = localStorage.getItem(KEY_SAVE_PREFIX + slot);
  if (!raw) return null;
  try{
    const parsed = JSON.parse(raw);
    STATE = parsed;
    setActiveSaveSlot(slot);
    return STATE;
  } catch {
    return null;
  }
}

export function deleteSlot(slot){
  localStorage.removeItem(KEY_SAVE_PREFIX + slot);
  const active = getActiveSaveSlot();
  if (active === slot) localStorage.removeItem(KEY_ACTIVE);
}

export function advanceWeek(){
  const g = STATE.game;

  // Advance to next week (v1: no schedule yet)
  g.week += 1;

  // Add hours weekly
  const banked = g.hours.banked;
  const availableCarry = g.hours.available;

  // We keep "available" separate from "banked".
  // Weekly reset: add any remaining available into bank, then grant 25 new available.
  const newBanked = clamp(banked + availableCarry, 0, g.hours.bankMax);
  g.hours.banked = newBanked;
  g.hours.available = HOURS_PER_WEEK;

  if (g.week > g.seasonWeeks){
    g.week = g.seasonWeeks;
    g.inbox.unshift({ t: Date.now(), msg: "End of regular season reached (v1). Playoffs coming soon." });
  }
}

export function spendHours(n){
  const h = STATE.game.hours;
  let need = n;

  // spend from available first
  const aSpend = Math.min(h.available, need);
  h.available -= aSpend;
  need -= aSpend;

  if (need > 0){
    const bSpend = Math.min(h.banked, need);
    h.banked -= bSpend;
    need -= bSpend;
  }

  return need === 0;
}
