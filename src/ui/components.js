export function el(tag, attrs={}, children=[]){
  const node = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs || {})){
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const ch of (Array.isArray(children) ? children : [children])){
    if (ch == null) continue;
    if (typeof ch === "string") node.appendChild(document.createTextNode(ch));
    else node.appendChild(ch);
  }
  return node;
}

export function card(title, subtitle, bodyChildren){
  return el("div", { class:"card" }, [
    el("div", { class:"spread" }, [
      el("div", {}, [
        el("div", { class:"h2" }, title),
        subtitle ? el("div", { class:"p" }, subtitle) : null
      ])
    ]),
    el("div", { class:"sep" }),
    ...(bodyChildren || [])
  ]);
}

export function badge(text){
  return el("span", { class:"badge" }, text);
}

export function button(text, { primary=false, danger=false, small=false, onClick } = {}){
  const cls = ["btn", primary && "btnPrimary", danger && "btnDanger", small && "btnSmall"].filter(Boolean).join(" ");
  return el("button", { class: cls, onclick: onClick }, text);
}

export function interestBar(value0to100){
  const wrap = el("div", { class:"barWrap" }, [
    el("div", { class:"barFill", style:`width:${Math.max(0, Math.min(100, value0to100))}%` })
  ]);
  return wrap;
}

export function tabs(items, activeKey, onPick){
  return el("div", { class:"tabs" },
    items.map(it =>
      el("button", {
        class: "tab " + (it.key === activeKey ? "tabActive" : ""),
        onclick: () => onPick(it.key)
      }, it.label)
    )
  );
}
