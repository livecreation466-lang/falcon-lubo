"use client";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const tok = () => typeof window !== "undefined" ? localStorage.getItem("nova_token") : null;

async function req(path: string, init: RequestInit = {}) {
  const h = new Headers(init.headers || {});
  h.set("Content-Type", "application/json");
  const t = tok(); if (t) h.set("Authorization", `Bearer ${t}`);
  const r = await fetch(`${API}${path}`, { ...init, headers: h });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

type Tab = "dash" | "sec" | "mem" | "ws" | "int" | "kb" | "skill" | "notif" | "back" | "reset";

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("dash");
  const [ok, setOk] = useState(false);
  useEffect(() => { if (!tok()) window.location.href = "/"; else setOk(true); }, []);
  if (!ok) return null;
  const tabs: {id: Tab; label: string}[] = [
    {id:"dash",label:"Dashboard"},{id:"sec",label:"Security"},{id:"mem",label:"Memory"},
    {id:"ws",label:"Workspaces"},{id:"int",label:"Integrations"},{id:"kb",label:"Knowledge"},
    {id:"skill",label:"Skills"},{id:"notif",label:"Notifications"},{id:"back",label:"Backup"},
    {id:"reset",label:"Reset"},
  ];
  return (
    <div className="min-h-screen p-3 space-y-3">
      <div className="glass neon-border rounded-2xl p-3 flex justify-between items-center">
        <div className="text-cyan-200 tracking-[0.3em] text-sm">NOVA · OWNER ADMIN</div>
        <a href="/" className="text-xs px-3 py-1 rounded bg-cyan-500/20 border border-cyan-400/50 text-cyan-100">← Back</a>
      </div>
      <div className="flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`text-xs px-3 py-1.5 rounded border transition
              ${tab === t.id ? "bg-cyan-500/30 border-cyan-300/70 text-cyan-100"
                             : "bg-black/40 border-cyan-500/20 text-cyan-300/70"}`}>{t.label}</button>
        ))}
      </div>
      <div className="glass neon-border rounded-2xl p-4">
        {tab === "dash" && <Dash />}
        {tab === "sec" && <Sec />}
        {tab === "mem" && <Mem />}
        {tab === "ws" && <Ws />}
        {tab === "int" && <Ints />}
        {tab === "kb" && <Kb />}
        {tab === "skill" && <Sk />}
        {tab === "notif" && <Nt />}
        {tab === "back" && <Bk />}
        {tab === "reset" && <Rs />}
      </div>
    </div>
  );
}

function Dash() {
  const [d, setD] = useState<any>(null); const [h, setH] = useState<any>(null);
  useEffect(() => { req("/diagnostic").then(setD).catch(()=>{}); req("/health").then(setH).catch(()=>{}); }, []);
  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${h?.ok ? "bg-emerald-400" : "bg-red-400"}`} />
        <span className="text-cyan-200">System {h?.ok ? "healthy" : "issues"}</span>
      </div>
      <pre className="bg-black/40 p-3 rounded overflow-auto text-cyan-100/90 max-h-96">{JSON.stringify({d,h},null,2)}</pre>
    </div>
  );
}

function Sec() {
  const [ev, setEv] = useState<any[]>([]); const [mfa, setMfa] = useState<any>(null); const [code, setCode] = useState("");
  const load = () => req("/security-events").then(setEv).catch(()=>{});
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-4 text-xs">
      <div>
        <div className="text-cyan-300/70 uppercase tracking-widest mb-2">MFA</div>
        {!mfa ? (
          <div className="flex gap-2">
            <button onClick={() => req("/mfa/setup",{method:"POST"}).then(setMfa)} className="px-3 py-1.5 rounded bg-cyan-500/20 border border-cyan-400/50 text-cyan-100">Setup</button>
            <button onClick={() => req("/mfa/disable",{method:"POST"}).then(()=>alert("disabled"))} className="px-3 py-1.5 rounded bg-red-500/20 border border-red-400/50 text-red-200">Disable</button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="font-mono text-cyan-200 break-all bg-black/40 p-2 rounded text-[10px]">{mfa.otpauth_url}</div>
            <div className="text-amber-300">Backup: {mfa.backup_codes?.join(", ")}</div>
            <input value={code} onChange={(e)=>setCode(e.target.value)} placeholder="6-digit"
              className="bg-black/40 border border-cyan-500/30 rounded px-2 py-1 text-cyan-100" />
            <button onClick={() => req("/mfa/verify",{method:"POST",body:JSON.stringify({code})}).then(()=>alert("enabled"))}
              className="ml-2 px-3 py-1 rounded bg-emerald-500/20 border border-emerald-400/50 text-emerald-200">Verify</button>
          </div>
        )}
      </div>
      <div>
        <div className="text-cyan-300/70 uppercase tracking-widest mb-2">Events ({ev.length})</div>
        <div className="space-y-1 max-h-72 overflow-auto">
          {ev.map((e) => (
            <div key={e.id} className={`border-l-2 pl-2 ${e.acknowledged ? "border-slate-500/40" : "border-amber-400"}`}>
              <div className="text-cyan-100">{e.kind} · {e.severity}</div>
              {!e.acknowledged && <button onClick={() => req(`/security-events/${e.id}/ack`,{method:"POST"}).then(load)}
                className="mt-1 text-[10px] px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/50 text-amber-200">Ack</button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Mem() {
  const [d, setD] = useState<any>({ entries: [] });
  const [k, setK] = useState(""); const [v, setV] = useState("");
  const load = () => req("/memory").then(setD).catch(()=>{});
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-2 text-xs">
      <div className="flex gap-2">
        <input value={k} onChange={(e)=>setK(e.target.value)} placeholder="key" className="flex-1 bg-black/40 border border-cyan-500/30 rounded px-2 py-1 text-cyan-100" />
        <input value={v} onChange={(e)=>setV(e.target.value)} placeholder="value" className="flex-[2] bg-black/40 border border-cyan-500/30 rounded px-2 py-1 text-cyan-100" />
        <button onClick={() => req("/memory",{method:"POST",body:JSON.stringify({key:k,value:v})}).then(()=>{setK("");setV("");load();})}
          className="px-3 py-1 rounded bg-cyan-500/20 border border-cyan-400/50 text-cyan-100">Add</button>
      </div>
      {d.entries.map((e: any) => (
        <div key={e.id} className="flex justify-between bg-black/30 rounded px-2 py-1 border border-cyan-500/20">
          <span className="text-cyan-100">{e.key}: {e.value}</span>
          <button onClick={() => req(`/memory/${e.id}`,{method:"DELETE"}).then(load)} className="text-red-300 text-[10px]">del</button>
        </div>
      ))}
      <button onClick={() => req("/memory",{method:"DELETE"}).then(load)} className="px-3 py-1 rounded bg-red-500/20 border border-red-400/50 text-red-200">Clear All</button>
    </div>
  );
}

function Ws() {
  const [list, setList] = useState<any[]>([]);
  const [n, setN] = useState(""); const [p, setP] = useState("read_only");
  const load = () => req("/workspaces").then(setList).catch(()=>{});
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-2 text-xs">
      <div className="flex gap-2">
        <input value={n} onChange={(e)=>setN(e.target.value)} placeholder="name" className="flex-1 bg-black/40 border border-cyan-500/30 rounded px-2 py-1 text-cyan-100" />
        <select value={p} onChange={(e)=>setP(e.target.value)} className="bg-black/40 border border-cyan-500/30 rounded px-2 py-1 text-cyan-100">
          {["read_only","creative","coding","custom"].map(x => <option key={x}>{x}</option>)}
        </select>
        <button onClick={() => req("/workspaces",{method:"POST",body:JSON.stringify({name:n,profile:p})}).then(()=>{setN("");load();})}
          className="px-3 py-1 rounded bg-cyan-500/20 border border-cyan-400/50 text-cyan-100">Add</button>
      </div>
      {list.map((w) => (
        <div key={w.id} className="flex justify-between bg-black/30 rounded px-2 py-1 border border-cyan-500/20">
          <span className="text-cyan-100">{w.name} · {w.profile}</span>
          {!w.is_default && <button onClick={() => req(`/workspaces/${w.id}`,{method:"DELETE"}).then(load)} className="text-red-300 text-[10px]">del</button>}
        </div>
      ))}
    </div>
  );
}

function Ints() {
  const [list, setList] = useState<any[]>([]);
  const [p, setP] = useState("openai"); const [s, setS] = useState("");
  const load = () => req("/integrations").then(setList).catch(()=>{});
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-2 text-xs">
      <div className="flex gap-2">
        <select value={p} onChange={(e)=>setP(e.target.value)} className="bg-black/40 border border-cyan-500/30 rounded px-2 py-1 text-cyan-100">
          {["openai","telegram","image","calendar","email","cloud","tasks"].map(x => <option key={x}>{x}</option>)}
        </select>
        <input value={s} onChange={(e)=>setS(e.target.value)} placeholder="secret (optional)" className="flex-1 bg-black/40 border border-cyan-500/30 rounded px-2 py-1 text-cyan-100" />
        <button onClick={() => req("/integrations",{method:"POST",body:JSON.stringify({provider:p,enabled:true,secret:s})}).then(()=>{setS("");load();})}
          className="px-3 py-1 rounded bg-cyan-500/20 border border-cyan-400/50 text-cyan-100">Save</button>
      </div>
      {list.map((i) => (
        <div key={i.id} className="flex justify-between bg-black/30 rounded px-2 py-1 border border-cyan-500/20">
          <span className="text-cyan-100">{i.name} {i.enabled ? "· on" : "· off"} {i.has_secret ? "· 🔐" : ""}</span>
          <button onClick={() => req(`/integrations/${i.provider}`,{method:"DELETE"}).then(load)} className="text-red-300 text-[10px]">del</button>
        </div>
      ))}
    </div>
  );
}

function Kb() {
  const [list, setList] = useState<any[]>([]);
  const [t, setT] = useState(""); const [c, setC] = useState("");
  const load = () => req("/kb").then(setList).catch(()=>{});
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-2 text-xs">
      <input value={t} onChange={(e)=>setT(e.target.value)} placeholder="title" className="w-full bg-black/40 border border-cyan-500/30 rounded px-2 py-1 text-cyan-100" />
      <textarea value={c} onChange={(e)=>setC(e.target.value)} placeholder="content" rows={3}
        className="w-full bg-black/40 border border-cyan-500/30 rounded px-2 py-1 text-cyan-100" />
      <button onClick={() => req("/kb",{method:"POST",body:JSON.stringify({title:t,content:c})}).then(()=>{setT("");setC("");load();})}
        className="px-3 py-1 rounded bg-cyan-500/20 border border-cyan-400/50 text-cyan-100">Add</button>
      {list.map((d) => (
        <div key={d.id} className="bg-black/30 rounded px-2 py-1 border border-cyan-500/20 flex justify-between">
          <span className="text-cyan-100">{d.title} <span className="text-slate-400">{d.preview}</span></span>
          <button onClick={() => req(`/kb/${d.id}`,{method:"DELETE"}).then(load)} className="text-red-300 text-[10px]">del</button>
        </div>
      ))}
    </div>
  );
}

function Sk() {
  const [list, setList] = useState<any[]>([]);
  const [n, setN] = useState(""); const [steps, setSteps] = useState('[{"tool":"echo","prompt":"hi"}]');
  const load = () => req("/skills").then(setList).catch(()=>{});
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-2 text-xs">
      <input value={n} onChange={(e)=>setN(e.target.value)} placeholder="skill name" className="w-full bg-black/40 border border-cyan-500/30 rounded px-2 py-1 text-cyan-100" />
      <textarea value={steps} onChange={(e)=>setSteps(e.target.value)} rows={3}
        className="w-full bg-black/40 border border-cyan-500/30 rounded px-2 py-1 text-cyan-100 font-mono" />
      <button onClick={() => { try { req("/skills",{method:"POST",body:JSON.stringify({name:n,steps:JSON.parse(steps)})}).then(()=>{setN("");load();}); } catch(e:any){alert(e.message);} }}
        className="px-3 py-1 rounded bg-cyan-500/20 border border-cyan-400/50 text-cyan-100">Add</button>
      {list.map((s) => (
        <div key={s.id} className="bg-black/30 rounded px-2 py-1 border border-cyan-500/20 flex justify-between">
          <span className="text-cyan-100">{s.name}</span>
          <button onClick={() => req(`/skills/${s.id}`,{method:"DELETE"}).then(load)} className="text-red-300 text-[10px]">del</button>
        </div>
      ))}
    </div>
  );
}

function Nt() {
  const [list, setList] = useState<any[]>([]);
  const kinds = ["login","task_start","approval_needed","task_completed","task_failed","security_event"];
  const load = () => req("/notifications").then(setList).catch(()=>{});
  useEffect(() => { load(); }, []);
  const get = (k: string) => list.find(x => x.event_kind === k) || { channel: "none", enabled: false };
  return (
    <div className="space-y-2 text-xs">
      {kinds.map((k) => {
        const cur = get(k);
        return (
          <div key={k} className="flex items-center gap-2 bg-black/30 rounded px-2 py-1 border border-cyan-500/20">
            <span className="text-cyan-100 flex-1">{k}</span>
            <select value={cur.channel}
              onChange={(e) => req("/notifications",{method:"POST",body:JSON.stringify({event_kind:k,channel:e.target.value,enabled:e.target.value!=="none"})}).then(load)}
              className="bg-black/40 border border-cyan-500/30 rounded px-2 py-0.5 text-cyan-100">
              <option value="none">none</option><option value="telegram">telegram</option><option value="log">log</option>
            </select>
          </div>
        );
      })}
    </div>
  );
}

function Bk() {
  const [list, setList] = useState<any[]>([]);
  const load = () => req("/backups").then(setList).catch(()=>{});
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-2 text-xs">
      <div className="flex gap-2">
        <button onClick={() => req("/backup",{method:"POST"}).then(load)} className="px-3 py-1 rounded bg-emerald-500/20 border border-emerald-400/50 text-emerald-200">Create Backup</button>
        <button onClick={() => req("/retention/apply",{method:"POST"}).then(r=>alert(JSON.stringify(r)))} className="px-3 py-1 rounded bg-amber-500/20 border border-amber-400/50 text-amber-200">Apply Retention</button>
      </div>
      {list.map((b) => (
        <div key={b.id} className="bg-black/30 rounded px-2 py-1 border border-cyan-500/20 text-cyan-100">{b.path} · {Math.round(b.size/1024)}KB</div>
      ))}
    </div>
  );
}

function Rs() {
  const [c, setC] = useState("");
  return (
    <div className="space-y-2 text-xs">
      <div className="text-red-300">⚠ Safe Reset deletes tasks, audits, security events, memory, hologram cache. Keeps workspaces, integrations, backups.</div>
      <input value={c} onChange={(e)=>setC(e.target.value)} placeholder='Type "RESET"'
        className="bg-black/40 border border-red-500/40 rounded px-3 py-1.5 w-full text-cyan-100" />
      <button disabled={c !== "RESET"} onClick={() => req("/reset",{method:"POST",body:JSON.stringify({confirm:"RESET"})}).then(()=>alert("Done"))}
        className="px-3 py-1.5 rounded bg-red-500/20 border border-red-400/50 text-red-200 disabled:opacity-40">Confirm Reset</button>
    </div>
  );
            }
