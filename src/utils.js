export function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

export function rng(seed){
  // mulberry32
  let t = seed >>> 0;
  return function(){
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(s){
  let h = 2166136261;
  for (let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pick(arr, r){ return arr[Math.floor(r()*arr.length)]; }

export function id(prefix, r){
  return `${prefix}_${Math.floor(r()*1e9).toString(36)}_${Date.now().toString(36)}`;
}

export function formatWeek(week, total){
  return `Week ${week} of ${total}`;
}
