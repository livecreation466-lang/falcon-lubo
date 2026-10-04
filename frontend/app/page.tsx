"use client";
import { useEffect, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const tok = () => typeof window !== "undefined" ? localStorage.getItem("nova_token") : null;

type ShapeDef = { aliases: string[]; paths: string[]; defaultColor: string };
const SHAPES: Record<string, ShapeDef> = {
  star: { aliases: ["star","sitara","tara"], defaultColor: "#fde047",
    paths: ["M50 5 L61 40 L98 40 L68 62 L79 96 L50 74 L21 96 L32 62 L2 40 L39 40 Z"] },
  tree: { aliases: ["tree","ped"], defaultColor: "#22c55e",
    paths: ["M50 92 L50 55","M50 55 L30 45 L45 45 L28 32 L40 32 L30 20 L45 20 L50 5 L55 20 L70 20 L60 32 L72 32 L55 45 L70 45 Z"] },
  car: { aliases: ["car","gaadi","gadi"], defaultColor: "#f472b6",
    paths: ["M15 72 L15 55 L28 42 L72 42 L85 55 L85 72 Z","M28 55 L33 46 L67 46 L72 55"] },
  cat: { aliases: ["cat","billi"], defaultColor: "#fbbf24",
    paths: ["M28 88 L28 50 L18 22 L38 34 L62 34 L82 22 L72 50 L72 88 Z","M42 55 L42 56","M58 55 L58 56"] },
  heart: { aliases: ["heart","dil","love"], defaultColor: "#ef4444",
    paths: ["M50 88 C10 60 8 32 28 22 C40 16 50 26 50 36 C50 26 60 16 72 22 C92 32 90 60 50 88 Z"] },
  sun: { aliases: ["sun","suraj"], defaultColor: "#fb923c",
    paths: ["M50 50 m0 -18 a18 18 0 1 0 0 36 a18 18 0 1 0 0 -36","M50 20 L50 5","M50 80 L50 95","M20 50 L5 50","M80 50 L95 50"] },
  moon: { aliases: ["moon","chand"], defaultColor: "#c4b5fd",
    paths: ["M50 5 A45 45 0 1 0 50 95 A35 35 0 1 1 50 5 Z"] },
  robot: { aliases: ["robot","yantra"], defaultColor: "#a3e635",
    paths: ["M35 25 L65 25 L65 55 L35 55 Z","M42 44 L58 44","M50 25 L50 10","M40 55 L40 80 L60 80 L60 55"] },
};
const dynCache = new Map<string, ShapeDef>();

async function fetchShape(name: string): Promise<ShapeDef> {
  const key = name.toLowerCase().trim();
  if (dynCache.has(key)) return dynCache.get(key)!;
  const r = await fetch(`${API}/voice/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok()}` },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) throw new Error(await r.text());
  const d = await r.json();
  const def: ShapeDef = { aliases: [key], paths: d.paths || [], defaultColor: d.color || "#22d3ee" };
  dynCache.set(key, def); return def;
}

function createRecognizer(lang: string, cb: (t: string, f: boolean) => void) {
  const C = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!C) return null;
  const r: any = new C(); r.lang = lang; r.continuous = true; r.interimResults = true;
  r.onresult = (e: any) => { for (let i = e.resultIndex; i < e.results.length; i++) cb(e.results[i][0].transcript, e.results[i].isFinal); };
  return { start: () => r.start(), stop: () => r.stop(), abort: () => r.abort() };
}

function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text); u.lang = "hi-IN"; u.rate = 1.05;
  window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
}

function Hologram({ paths, color, scale, spin, morphKey }:
  { paths: string[]; color: string; scale: number; spin: boolean; morphKey?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const st = useRef({ paths, color, prevPaths: paths, prevColor: color, scale, spin, morphT: 1, angle: 0 });
  useEffect(() => {
    const s = st.current;
    if (s.paths !== paths) { s.prevPaths = s.paths; s.prevColor = s.color; s.paths = paths; s.morphT = 0; }
  }, [morphKey, paths]);
  useEffect(() => { st.current.color = color; }, [color]);
  useEffect(() => { st.current.scale = scale; }, [scale]);
  useEffect(() => { st.current.spin = spin; }, [spin]);
  useEffect(() => {
    const canvas = canvasRef.current!; const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1; let raf = 0;
    function resize() {
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize(); const ro = new ResizeObserver(resize); ro.observe(canvas);
    const parts = Array.from({ length: 80 }, () => ({
      a: Math.random() * Math.PI * 2, r: 55 + Math.random() * 100,
      s: 0.15 + Math.random() * 0.55, o: 0.25 + Math.random() * 0.65, sz: 0.8 + Math.random() * 1.8,
    }));
    let last = performance.now();
    function draw(paths: string[], col: string, alpha: number, mul: number, cx: number, cy: number, base: number, ang: number) {
      if (alpha <= 0.001 || !paths.length) return;
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.translate(cx, cy); ctx.rotate(ang); ctx.scale(base * mul, base * mul); ctx.translate(-50, -50);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      const p2ds = paths.map((d) => { try { return new Path2D(d); } catch { return null; } }).filter(Boolean) as Path2D[];
      ctx.shadowColor = col; ctx.shadowBlur = 48; ctx.strokeStyle = col; ctx.lineWidth = 5;
      for (const p of p2ds) ctx.stroke(p);
      ctx.shadowBlur = 22; ctx.lineWidth = 2.5;
      for (const p of p2ds) ctx.stroke(p);
      ctx.shadowBlur = 8; ctx.shadowColor = "#fff"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.4;
      for (const p of p2ds) ctx.stroke(p);
      ctx.restore();
    }
    function frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const s = st.current;
      s.morphT = Math.min(1, s.morphT + dt * 2.4);
      if (s.spin) s.angle += dt * 0.9;
      const r = canvas.getBoundingClientRect();
      const cx = r.width / 2, cy = r.height / 2;
      const base = Math.min(r.width, r.height) / 160;
      ctx.clearRect(0, 0, r.width, r.height);
      ctx.fillStyle = "rgba(5,6,15,0.35)"; ctx.fillRect(0, 0, r.width, r.height);
      for (const p of parts) {
        p.a += p.s * dt;
        const x = cx + Math.cos(p.a) * p.r * base; const y = cy + Math.sin(p.a) * p.r * base;
        ctx.globalAlpha = p.o * (0.6 + 0.4 * Math.sin(now / 400 + p.a));
        ctx.fillStyle = s.color; ctx.shadowColor = s.color; ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(x, y, p.sz, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      const t = s.morphT;
      if (s.prevPaths !== s.paths && t < 1) draw(s.prevPaths, s.prevColor, 1 - t, s.scale * (1 + t * 0.5), cx, cy, base, s.angle);
      const grow = s.prevPaths === s.paths ? 1 : 0.55 + t * 0.45;
      draw(s.paths, s.color, t, s.scale * grow, cx, cy, base, s.angle);
      ctx.save(); ctx.globalAlpha = 0.05; ctx.fillStyle = "#22d3ee"; ctx.shadowBlur = 0;
      for (let y = (now / 50) % 6; y < r.height; y += 6) ctx.fillRect(0, y, r.width, 1);
      ctx.restore();
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);
  return <canvas ref={canvasRef} className="w-full h-full block" />;
}

function Orb({ state }: { state: string }) {
  const pulse = state === "listening" || state === "running";
  return (
    <div className="relative flex items-center justify-center w-28 h-28">
      <div className={`absolute inset-0 rounded-full orb ${pulse ? "animate-pulse" : ""}`} />
      <div className="absolute inset-4 rounded-full border border-cyan-300/30" />
      <div className="relative text-[10px] uppercase tracking-widest text-cyan-100/80">{state}</div>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [u, setU] = useState("owner"); const [p, setP] = useState("");
  const [otp, setOtp] = useState(""); const [needOtp, setNeedOtp] = useState(false);
  const [err, setErr] = useState("");
  async function go(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    try {
      const r = await fetch(`${API}/auth/login`, { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p, otp: otp || undefined }) });
      if (!r.ok) { const t = await r.text(); if (t.includes("OTP")) setNeedOtp(true); throw new Error(t); }
      const d = await r.json(); localStorage.setItem("nova_token", d.access_token); onDone();
    } catch (e: any) { setErr(e.message); }
  }
  return (
    <form onSubmit={go} className="glass neon-border rounded-2xl p-6 w-full max-w-sm space-y-4">
      <h1 className="text-xl font-semibold tracking-widest text-cyan-200">NOVA ACCESS</h1>
      <input value={u} onChange={e=>setU(e.target.value)} placeholder="owner"
             className="w-full bg-black/40 border border-cyan-500/30 rounded px-3 py-2 outline-none text-cyan-100"/>
      <input type="password" value={p} onChange={e=>setP(e.target.value)} placeholder="password"
             className="w-full bg-black/40 border border-cyan-500/30 rounded px-3 py-2 outline-none text-cyan-100"/>
      {needOtp && <input value={otp} onChange={e=>setOtp(e.target.value)} placeholder="6-digit OTP"
             className="w-full bg-black/40 border border-cyan-500/30 rounded px-3 py-2 outline-none text-cyan-100"/>}
      {err && <div className="text-red-400 text-sm">{err}</div>}
      <button className="w-full py-2 rounded bg-cyan-500/20 border border-cyan-400/50 text-cyan-100">Authenticate</button>
    </form>
  );
}

export default function Page() {
  const [authed, setAuthed] = useState(false);
  const [shapeName, setShapeName] = useState("star");
  const [shapeDef, setShapeDef] = useState<ShapeDef>(SHAPES.star);
  const [color, setColor] = useState(SHAPES.star.defaultColor);
  const [scale, setScale] = useState(1);
  const [spin, setSpin] = useState(true);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [lastCmd, setLastCmd] = useState("");
  const [voiceOut, setVoiceOut] = useState(true);
  const [tasks, setTasks] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [sec, setSec] = useState<any[]>([]);
  const [tools, setTools] = useState<Record<string, any>>({});
  const recRef = useRef<any>(null);

  useEffect(() => { if (tok()) setAuthed(true); }, []);

  useEffect(() => {
    if (!authed) return;
    const load = async () => {
      try {
        const h = { Authorization: `Bearer ${tok()}` };
        const [t, a, s, tl] = await Promise.all([
          fetch(`${API}/tasks`, { headers: h }).then(r=>r.json()),
          fetch(`${API}/audit`, { headers: h }).then(r=>r.json()),
          fetch(`${API}/security-events?unacked_only=true`, { headers: h }).then(r=>r.json()).catch(()=>[]),
          fetch(`${API}/tools`, { headers: h }).then(r=>r.json()),
        ]);
        setTasks(t); setAudit(a); setSec(s); setTools(tl);
      } catch {}
    };
    load();
    const int = setInterval(load, 6000);
    return () => clearInterval(int);
  }, [authed]);

  async function goToShape(raw: string) {
    const name = raw.trim().toLowerCase();
    if (!name) return;
    for (const [canon, def] of Object.entries(SHAPES)) {
      if (canon === name || def.aliases.includes(name)) {
        setShapeName(canon); setShapeDef(def); setColor(def.defaultColor);
        setLastCmd(`shape → ${canon}`); if (voiceOut) speak(`${canon} ban gaya`);
        return;
      }
    }
    setLastCmd(`generating "${name}"…`);
    try {
      const def = await fetchShape(name);
      setShapeName(name); setShapeDef(def); setColor(def.defaultColor);
      setLastCmd(`shape → ${name}`); if (voiceOut) speak(`${name} ban gaya`);
    } catch { setLastCmd(`failed: ${name}`); }
  }

  function handleCommand(text: string) {
    const t = text.toLowerCase().trim();
    if (!t) return;
    if (/\b(reset|clear|hata|band)\b/.test(t)) {
      setShapeName("star"); setShapeDef(SHAPES.star); setColor(SHAPES.star.defaultColor);
      setScale(1); setSpin(false); setLastCmd("reset"); if (voiceOut) speak("reset"); return;
    }
    if (/\b(spin|ghuma|rotate)\b/.test(t)) { setSpin(true); return; }
    if (/\b(stop|ruk|thamb)\b/.test(t)) { setSpin(false); return; }
    if (/\b(bigger|bada|zoom in)\b/.test(t)) { setScale((s) => Math.min(3, s + 0.25)); return; }
    if (/\b(smaller|chota|zoom out)\b/.test(t)) { setScale((s) => Math.max(0.3, s - 0.25)); return; }
    const colors: Record<string, string> = {
      red: "#ff3b5c", laal: "#ff3b5c", lal: "#ff3b5c",
      blue: "#3b82f6", neela: "#3b82f6", nila: "#3b82f6",
      green: "#22c55e", hara: "#22c55e", yellow: "#eab308", peela: "#eab308",
      purple: "#a855f7", pink: "#ec4899", orange: "#f97316",
      cyan: "#22d3ee", white: "#ffffff", black: "#1a1a1a", golden: "#facc15", sona: "#facc15",
    };
    for (const [k, v] of Object.entries(colors)) {
      if (new RegExp(`\\b${k}\\b`).test(t)) { setColor(v); setLastCmd(`color → ${k}`); if (voiceOut) speak(k); return; }
    }
    const stop = new Set(["banao","bana","banade","karo","kar","do","make","a","an","the","ka","ki","ke","please","bhai","hey","nova","create","draw","turn","into","to"]);
    const words = t.replace(/[^\w\u0900-\u097F\s]/g, " ").split(/\s+/).filter((w) => w && !stop.has(w));
    goToShape(words.join(" ").trim() || t);
  }

  function startListening() {
    const rec = createRecognizer("en-IN", (text, isFinal) => {
      setTranscript(text);
      if (isFinal) { setTranscript(""); handleCommand(text); }
    });
    if (!rec) { alert("Chrome use karo"); return; }
    recRef.current = rec; rec.start(); setListening(true);
  }
  function stopListening() { recRef.current?.stop(); recRef.current = null; setListening(false); }

  async function pauseAll() {
    await fetch(`${API}/pause-all`, { method: "POST", headers: { Authorization: `Bearer ${tok()}` } });
    setTasks(tasks.map((t) => ["queued","running","needs_approval"].includes(t.state) ? {...t, state:"cancelled"} : t));
  }
  async function approveTask(id: string, ok: boolean) {
    await fetch(`${API}/tasks/${id}/approve`, { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok()}` },
      body: JSON.stringify({ approve: ok }) });
  }

  if (!authed) return <div className="min-h-screen flex items-center justify-center"><Login onDone={() => setAuthed(true)} /></div>;

  const state = listening ? "listening" : tasks.some(t => t.state === "running") ? "running" : "idle";

  return (
    <div className="min-h-screen p-3 space-y-3">
      <div className="glass neon-border rounded-2xl p-3 flex items-center justify-between flex-wrap gap-2">
        <div className="text-cyan-200 tracking-[0.3em] text-sm">NOVA · HOLOGRAM</div>
        <div className="flex gap-2">
          <a href="/admin" className="text-xs px-3 py-1 rounded bg-fuchsia-500/20 border border-fuchsia-400/50 text-fuchsia-100">⚙ Admin</a>
          <button onClick={pauseAll} className="text-xs px-3 py-1 rounded bg-red-500/20 border border-red-400/40 text-red-200">Pause All</button>
          <button onClick={() => { localStorage.removeItem("nova_token"); setAuthed(false); }}
                  className="text-xs px-3 py-1 rounded bg-slate-500/20 border border-slate-400/40 text-slate-200">Logout</button>
        </div>
      </div>

      {sec.length > 0 && (
        <div className="glass rounded-2xl p-3 border border-red-500/40 text-xs text-red-200">
          ⚠ {sec.length} unacknowledged security events — <a href="/admin" className="underline">Review in Admin</a>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-[180px_1fr_300px]">
        <div className="space-y-3">
          <div className="glass neon-border rounded-2xl p-4 flex flex-col items-center gap-3">
            <Orb state={state} />
            <button onClick={listening ? stopListening : startListening}
              className={`w-full py-3 rounded-xl border text-xs tracking-widest uppercase transition
                ${listening ? "bg-red-500/20 border-red-400/60 text-red-100 animate-pulse"
                            : "bg-cyan-500/20 border-cyan-400/60 text-cyan-100"}`}>
              {listening ? "● Listening" : "🎤 Bolo"}
            </button>
            <label className="text-[10px] text-cyan-200 flex items-center gap-2">
              <input type="checkbox" checked={voiceOut} onChange={(e) => setVoiceOut(e.target.checked)} />
              Voice reply
            </label>
            {transcript && <div className="text-xs text-cyan-300 text-center">"{transcript}"</div>}
            {lastCmd && <div className="text-[10px] text-cyan-400/70 text-center break-all">{lastCmd}</div>}
          </div>

          <div className="glass neon-border rounded-2xl p-3">
            <div className="text-[10px] uppercase tracking-widest text-cyan-300/70 mb-2">Tools</div>
            {Object.entries(tools).map(([n, s]: any) => (
              <div key={n} className="flex justify-between text-[10px] py-0.5">
                <span className={s.allowed ? "text-cyan-100" : "text-slate-500 line-through"}>{n}</span>
                <span className="text-fuchsia-300/80">{s.risk}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 min-w-0">
          <div className="glass neon-border rounded-2xl overflow-hidden relative" style={{ aspectRatio: "16/10", minHeight: 280 }}>
            <Hologram paths={shapeDef.paths} color={color} scale={scale} spin={spin} morphKey={shapeName} />
            <div className="absolute top-2 left-3 text-[10px] uppercase tracking-widest text-cyan-300/70">◉ LIVE · {shapeName}</div>
            <div className="absolute bottom-2 left-3 right-3 flex flex-wrap gap-1">
              {["star","tree","car","cat","sun","moon","robot","heart"].map((n) => (
                <button key={n} onClick={() => goToShape(n)}
                  className={`text-[10px] px-2 py-0.5 rounded border
                    ${shapeName === n ? "bg-cyan-500/30 border-cyan-300/70 text-cyan-100"
                                      : "bg-black/40 border-cyan-500/20 text-cyan-300/70"}`}>{n}</button>
              ))}
            </div>
          </div>

          <div className="glass neon-border rounded-2xl p-3">
            <form onSubmit={(e) => { e.preventDefault(); handleCommand(input); setInput(""); }} className="flex gap-2">
              <input value={input} onChange={(e) => setInput(e.target.value)}
                placeholder='Bolo: "dragon", "red karo"…'
                className="flex-1 bg-black/40 border border-cyan-500/30 rounded px-3 py-2 outline-none text-sm text-cyan-100" />
              <button className="px-4 py-2 rounded bg-cyan-500/20 border border-cyan-400/50 text-cyan-100 text-sm">Create</button>
            </form>
          </div>
        </div>

        <div className="space-y-3">
          <div className="glass neon-border rounded-2xl p-3 max-h-72 overflow-auto">
            <div className="text-[10px] uppercase tracking-widest text-cyan-300/70 mb-2">Task Queue</div>
            {tasks.length === 0 && <div className="text-slate-500 text-xs">No tasks yet.</div>}
            {tasks.map((t) => (
              <div key={t.id} className="border border-cyan-500/20 rounded p-2 mb-2 bg-black/30 text-xs">
                <div className="flex justify-between gap-1">
                  <div className="text-cyan-100 truncate flex-1">{t.prompt || t.title}</div>
                  <div className={`text-[9px] uppercase ${t.state === "completed" ? "text-emerald-300" : t.state === "failed" ? "text-red-300" : t.state === "needs_approval" ? "text-amber-300" : "text-slate-300"}`}>{t.state}</div>
                </div>
                {t.state === "needs_approval" && (
                  <div className="flex gap-1 mt-1">
                    <button onClick={() => approveTask(t.id, true)} className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 text-[10px]">Approve</button>
                    <button onClick={() => approveTask(t.id, false)} className="px-2 py-0.5 rounded bg-red-500/20 border border-red-400/50 text-red-200 text-[10px]">Reject</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="glass neon-border rounded-2xl p-3 max-h-72 overflow-auto">
            <div className="text-[10px] uppercase tracking-widest text-cyan-300/70 mb-2">Activity Feed</div>
            {audit.slice(0, 30).map((a) => (
              <div key={a.id} className={`text-[10px] py-0.5 border-l-2 pl-2 ${a.severity === "warn" ? "border-amber-400" : "border-cyan-500/40"}`}>
                <div className="text-cyan-200">{a.action}</div>
                <div className="text-slate-500">{a.target || ""}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
        }
