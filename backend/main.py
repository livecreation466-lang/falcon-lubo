"""NOVA Backend — single file."""
import os, uuid, json, re, secrets, base64, hashlib, colorsys, random, asyncio
import datetime as dt, shutil
from functools import lru_cache
from typing import Optional, Any, Callable
from dataclasses import dataclass
import httpx, jwt, pyotp
from cryptography.fernet import Fernet
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query, Header, Body, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import (String, DateTime, Text, Boolean, Integer, JSON, LargeBinary, create_engine, text as sql_text)
from sqlalchemy.orm import sessionmaker, DeclarativeBase, Mapped, mapped_column

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="NOVA_", extra="ignore")
    name: str = "NOVA"
    database_url: str = "sqlite:///./nova.db"
    jwt_secret: str = "dev-only-change-me"
    jwt_alg: str = "HS256"
    session_ttl_minutes: int = 720
    owner_username: str = "owner"
    owner_password: str = "change-me-now"
    allowed_dirs: str = ""
    profile: str = "read_only"
    ai_provider: str = "echo"
    ai_api_key: str = ""
    ai_model: str = "gpt-4o-mini"
    mfa_required: bool = False
    rate_limit_per_min: int = 120
    retention_audit_days: int = 90
    retention_task_days: int = 30
    backup_dir: str = "./backups"
    encryption_key: str = "change-this-32-byte-key-for-encryption-0000"
    telegram_bot_token: str = ""
    telegram_owner_chat_id: str = ""
    @property
    def allowed_dir_list(self) -> list[str]:
        return [p.strip() for p in self.allowed_dirs.split(",") if p.strip()]

@lru_cache
def get_settings() -> Settings:
    return Settings()
S = get_settings()

class Base(DeclarativeBase): ...
_connect = {"check_same_thread": False} if S.database_url.startswith("sqlite") else {}
engine = create_engine(S.database_url, connect_args=_connect, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

def _uuid(): return str(uuid.uuid4())
def _now(): return dt.datetime.now(dt.timezone.utc)

class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
    title: Mapped[str] = mapped_column(String(200))
    prompt: Mapped[str] = mapped_column(Text, default="")
    tool: Mapped[str] = mapped_column(String(64), default="ai_chat")
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    risk: Mapped[str] = mapped_column(String(16), default="low")
    state: Mapped[str] = mapped_column(String(24), default="queued")
    approval_required: Mapped[bool] = mapped_column(Boolean, default=False)
    approved: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    result: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)
    action: Mapped[str] = mapped_column(String(64))
    target: Mapped[str | None] = mapped_column(String(200), nullable=True)
    severity: Mapped[str] = mapped_column(String(16), default="info")
    meta: Mapped[dict] = mapped_column(JSON, default=dict)

class RevokedSession(Base):
    __tablename__ = "revoked_sessions"
    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    ts: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)

class HologramShape(Base):
    __tablename__ = "hologram_shapes"
    name: Mapped[str] = mapped_column(String(120), primary_key=True)
    paths: Mapped[list] = mapped_column(JSON, default=list)
    color: Mapped[str] = mapped_column(String(16), default="#22d3ee")
    source: Mapped[str] = mapped_column(String(24), default="ai")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)

class SecurityEvent(Base):
    __tablename__ = "security_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)
    kind: Mapped[str] = mapped_column(String(64))
    severity: Mapped[str] = mapped_column(String(16), default="info")
    evidence: Mapped[dict] = mapped_column(JSON, default=dict)
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
    recommended: Mapped[list] = mapped_column(JSON, default=list)

class RateBucket(Base):
    __tablename__ = "rate_buckets"
    key: Mapped[str] = mapped_column(String(160), primary_key=True)
    window: Mapped[dt.datetime] = mapped_column(DateTime)
    count: Mapped[int] = mapped_column(Integer, default=0)

class MfaRecord(Base):
    __tablename__ = "mfa_records"
    username: Mapped[str] = mapped_column(String(64), primary_key=True)
    secret: Mapped[str] = mapped_column(String(64))
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    backup_codes: Mapped[list] = mapped_column(JSON, default=list)

class MemoryEntry(Base):
    __tablename__ = "memory_entries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(200))
    value: Mapped[str] = mapped_column(Text, default="")
    sensitive: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)

class Workspace(Base):
    __tablename__ = "workspaces"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    profile: Mapped[str] = mapped_column(String(24), default="read_only")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)

class Integration(Base):
    __tablename__ = "integrations"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    provider: Mapped[str] = mapped_column(String(64))
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    secret_enc: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)

class KnowledgeDoc(Base):
    __tablename__ = "knowledge_docs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)

class Backup(Base):
    __tablename__ = "backups"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    path: Mapped[str] = mapped_column(String(400))
    size: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)

class NotifRule(Base):
    __tablename__ = "notif_rules"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_kind: Mapped[str] = mapped_column(String(64), unique=True)
    channel: Mapped[str] = mapped_column(String(32), default="none")
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)

class Skill(Base):
    __tablename__ = "skills"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    steps: Mapped[list] = mapped_column(JSON, default=list)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)

Base.metadata.create_all(engine)

def audit(action, target=None, severity="info", **meta):
    with SessionLocal() as db:
        db.add(AuditEvent(action=action, target=target, severity=severity, meta=meta)); db.commit()

def sec_event(kind, severity, evidence, recommended):
    with SessionLocal() as db:
        db.add(SecurityEvent(kind=kind, severity=severity, evidence=evidence, recommended=recommended)); db.commit()

def _fernet():
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(S.encryption_key.encode()).digest()))
def enc(t): return _fernet().encrypt(t.encode())
def dec(b):
    try: return _fernet().decrypt(b).decode()
    except Exception: return ""

INJECTION = [r"ignore (all )?previous", r"you are now ", r"reveal (your )?(prompt|secret)", r"<script", r"javascript:", r"eval\s*\(", r"\.\./\.\."]
def scan_input(t):
    low = t.lower()
    for p in INJECTION:
        if re.search(p, low):
            sec_event("injection_suspected", "warn", {"preview": t[:200]}, ["review_source"])
            return False
    return True

def create_token(sub):
    now = dt.datetime.now(dt.timezone.utc)
    exp = now + dt.timedelta(minutes=S.session_ttl_minutes)
    p = {"sub": sub, "iat": int(now.timestamp()), "exp": int(exp.timestamp()), "jti": str(uuid.uuid4())}
    return jwt.encode(p, S.jwt_secret, algorithm=S.jwt_alg), exp

def decode_token(t):
    try: return jwt.decode(t, S.jwt_secret, algorithms=[S.jwt_alg])
    except jwt.PyJWTError: raise HTTPException(401, "invalid token")

async def require_owner(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token")
    c = decode_token(authorization.split(" ", 1)[1])
    with SessionLocal() as db:
        if db.get(RevokedSession, c.get("jti")): raise HTTPException(401, "revoked")
    if c.get("sub") != S.owner_username: raise HTTPException(403, "not owner")
    return c

def rate_check(key):
    now = dt.datetime.now(dt.timezone.utc).replace(second=0, microsecond=0)
    with SessionLocal() as db:
        b = db.get(RateBucket, key)
        if not b or b.window != now:
            db.merge(RateBucket(key=key, window=now, count=1)); db.commit(); return True
        if b.count >= S.rate_limit_per_min: return False
        b.count += 1; db.commit(); return True

async def rate_mw(request, call_next):
    client = request.client.host if request.client else "unknown"
    if not rate_check(f"{client}:{request.url.path}"):
        return JSONResponse({"detail": "rate limit"}, status_code=429)
    return await call_next(request)

@dataclass(frozen=True)
class ToolSpec:
    name: str; description: str; scopes: tuple; risk: str; requires_approval: bool

PROFILES = {"read_only": {"chat","read"}, "creative": {"chat","read","design"}, "coding": {"chat","read","write"}, "custom": {"chat","read","write","design","exec"}}
def allowed(p, s): return all(x in PROFILES.get(p, PROFILES["read_only"]) for x in s.scopes)

_REG = {}
def register(spec):
    def deco(fn): _REG[spec.name] = (spec, fn); return fn
    return deco

@register(ToolSpec("echo", "Echo", ("chat",), "low", False))
async def t_echo(p): return p.get("prompt", "")

@register(ToolSpec("ai_chat", "AI chat", ("chat",), "low", False))
async def t_ai(p):
    prompt = p.get("prompt", "")
    if S.ai_provider == "echo" or not S.ai_api_key: return f"[echo] {prompt}"
    if S.ai_provider == "openai":
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post("https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {S.ai_api_key}"},
                json={"model": S.ai_model, "messages": [{"role": "user", "content": prompt}]})
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]
    return prompt

class Hub:
    def __init__(self): self.clients = set(); self.lock = asyncio.Lock()
    async def connect(self, ws):
        await ws.accept()
        async with self.lock: self.clients.add(ws)
    async def disconnect(self, ws):
        async with self.lock: self.clients.discard(ws)
    async def broadcast(self, m):
        data = json.dumps(m, default=str); dead = []
        for ws in list(self.clients):
            try: await ws.send_text(data)
            except: dead.append(ws)
        for ws in dead: await self.disconnect(ws)
hub = Hub()

async def emit(tid):
    with SessionLocal() as db:
        t = db.get(Task, tid)
        if t:
            await hub.broadcast({"type": "task", "data": {"id": t.id, "created_at": t.created_at, "updated_at": t.updated_at, "title": t.title, "prompt": t.prompt, "tool": t.tool, "params": t.params, "risk": t.risk, "state": t.state, "approval_required": t.approval_required, "approved": t.approved, "result": t.result, "error": t.error}})

async def run_task(tid):
    with SessionLocal() as db:
        t = db.get(Task, tid)
        if not t: return
        t.state = "running"; db.commit(); tool, params = t.tool, dict(t.params)
    await emit(tid); err = None; res = None
    try:
        sf = _REG.get(tool)
        if not sf: raise ValueError(f"unknown tool {tool}")
        _, fn = sf; res = await fn(params)
    except Exception as e: err = f"{type(e).__name__}: {e}"
    with SessionLocal() as db:
        t = db.get(Task, tid)
        if not t: return
        if err: t.error = err; t.state = "failed"
        else: t.result = str(res)[:100000]; t.state = "completed"
        db.commit()
    await emit(tid)

async def new_task(prompt, tool=None, params=None):
    params = dict(params or {}); params.setdefault("prompt", prompt)
    chosen = tool or "ai_chat"
    sf = _REG.get(chosen)
    if not sf: raise ValueError(f"unknown tool {chosen}")
    spec, _ = sf
    if not allowed(S.profile, spec): raise PermissionError(f"profile blocks {chosen}")
    appr = spec.requires_approval or spec.risk in ("medium","high")
    with SessionLocal() as db:
        t = Task(title=(prompt[:80] or chosen), prompt=prompt, tool=chosen, params=params, risk=spec.risk, approval_required=appr, state="needs_approval" if appr else "queued")
        db.add(t); db.commit(); db.refresh(t)
    await emit(t.id)
    if not appr: asyncio.create_task(run_task(t.id))
    return t

AI_PROMPT = """Design a minimalist neon line-art icon. Return STRICT JSON only:
{"paths": ["M...", "M..."], "color": "#RRGGBB"}
viewBox 0 0 100 100. Paths use only M L C Q A Z digits dots minus space comma.
3-12 paths, 20-220 chars each. No fills. Object: """
SAFE_PATH = re.compile(r"^[MLCQAZ0-9.,\-\s]{4,400}$")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

def _validate(paths, color):
    if not isinstance(paths, list): return None
    clean = [p.strip() for p in paths if isinstance(p, str) and SAFE_PATH.match(p.strip()) and p.strip().upper().startswith("M")]
    if not clean: return None
    if not (isinstance(color, str) and HEX.match(color)): color = "#22d3ee"
    return clean[:16], color

def procedural(name):
    seed = int(hashlib.sha256(name.lower().encode()).hexdigest(), 16)
    rng = random.Random(seed); paths = []
    for _ in range(rng.randint(6, 10)):
        x1, y1 = rng.uniform(30, 55), rng.uniform(15, 85)
        x2, y2 = rng.uniform(30, 55), rng.uniform(15, 85)
        mx, my = rng.uniform(15, 50), rng.uniform(10, 90)
        paths.append(f"M{x1:.1f} {y1:.1f} Q{mx:.1f} {my:.1f} {x2:.1f} {y2:.1f}")
        paths.append(f"M{100-x1:.1f} {y1:.1f} Q{100-mx:.1f} {my:.1f} {100-x2:.1f} {y2:.1f}")
    r = rng.uniform(6, 14)
    paths.append(f"M{50-r:.1f} 50 A{r:.1f} {r:.1f} 0 1 0 {50+r:.1f} 50 A{r:.1f} {r:.1f} 0 1 0 {50-r:.1f} 50 Z")
    h = (seed % 360) / 360
    r2, g2, b2 = colorsys.hsv_to_rgb(h, 0.75, 1.0)
    return paths, "#{:02x}{:02x}{:02x}".format(int(r2*255), int(g2*255), int(b2*255))

async def gen_shape(name):
    key = name.strip().lower()[:120]
    if not key: return {"name": key, "paths": [], "color": "#22d3ee", "source": "empty"}
    with SessionLocal() as db:
        row = db.get(HologramShape, key)
        if row: return {"name": key, "paths": row.paths, "color": row.color, "source": row.source}
    try:
        raw = await t_ai({"prompt": AI_PROMPT + name})
        m = re.search(r"\{.*\}", raw, re.S)
        if m:
            data = json.loads(m.group(0))
            v = _validate(data.get("paths"), data.get("color"))
            if v:
                paths, color = v
                with SessionLocal() as db:
                    db.merge(HologramShape(name=key, paths=paths, color=color, source="ai")); db.commit()
                return {"name": key, "paths": paths, "color": color, "source": "ai"}
    except Exception: pass
    paths, color = procedural(name)
    with SessionLocal() as db:
        db.merge(HologramShape(name=key, paths=paths, color=color, source="procedural")); db.commit()
    return {"name": key, "paths": paths, "color": color, "source": "procedural"}

class LoginIn(BaseModel): username: str; password: str; otp: Optional[str] = None
class TokenOut(BaseModel): access_token: str; token_type: str = "bearer"; expires_at: dt.datetime
class TaskIn(BaseModel): prompt: str = Field(min_length=1, max_length=8000); tool: Optional[str] = None; params: dict = Field(default_factory=dict)
class TaskOut(BaseModel):
    id: str; created_at: dt.datetime; updated_at: dt.datetime
    title: str; prompt: str; tool: str; params: dict
    risk: str; state: str; approval_required: bool
    approved: Optional[bool]; result: Optional[str]; error: Optional[str]
    class Config: from_attributes = True
class ApprovalIn(BaseModel): approve: bool
class ProfileIn(BaseModel): profile: str
class ShapeIn(BaseModel): name: str
class MemoryIn(BaseModel): key: str; value: str; sensitive: bool = False
class WorkspaceIn(BaseModel): name: str; description: str = ""; profile: str = "read_only"
class IntegrationIn(BaseModel): provider: str; enabled: bool = False; secret: Optional[str] = None
class NotifIn(BaseModel): event_kind: str; channel: str = "none"; enabled: bool = False
class MfaCode(BaseModel): code: str
class ResetIn(BaseModel): confirm: str
class KbIn(BaseModel): title: str; content: str
class SkillIn(BaseModel): name: str; steps: list; enabled: bool = False

app = FastAPI(title=f"{S.name} API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(BaseHTTPMiddleware, dispatch=rate_mw)

with SessionLocal() as db:
    if not db.query(Workspace).filter(Workspace.is_default == True).first():
        db.add(Workspace(id="__default__", name="Default", is_default=True)); db.commit()

@app.get("/health")
def health():
    ok = True; checks = {}
    try:
        with SessionLocal() as db: db.execute(sql_text("SELECT 1"))
        checks["db"] = True
    except Exception as e: checks["db"] = str(e); ok = False
    try: os.makedirs(S.backup_dir, exist_ok=True); checks["backup"] = True
    except Exception as e: checks["backup"] = str(e); ok = False
    checks["ai"] = S.ai_provider
    return {"ok": ok, "name": S.name, "profile": S.profile, "checks": checks}

@app.get("/diagnostic")
def diagnostic(_=Depends(require_owner)):
    with SessionLocal() as db:
        c = {"tasks": db.query(Task).count(), "audit": db.query(AuditEvent).count(), "security": db.query(SecurityEvent).count(), "shapes": db.query(HologramShape).count()}
    return {"app": S.name, "profile": S.profile, "ai": S.ai_provider, "ai_key_set": bool(S.ai_api_key), "counts": c}

@app.post("/auth/login", response_model=TokenOut)
def login(b: LoginIn):
    ok_u = secrets.compare_digest(b.username, S.owner_username)
    ok_p = secrets.compare_digest(b.password, S.owner_password)
    if not (ok_u and ok_p):
        audit("auth.fail", severity="warn", user=b.username)
        cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=5)
        with SessionLocal() as db:
            fails = db.query(AuditEvent).filter(AuditEvent.action=="auth.fail", AuditEvent.ts>=cutoff).count()
        if fails >= 5:
            sec_event("repeated_auth_failure", "high", {"user": b.username, "count_5min": fails}, ["revoke_sessions","rotate_password","enable_mfa"])
        raise HTTPException(401, "invalid credentials")
    with SessionLocal() as db: rec = db.get(MfaRecord, b.username)
    if rec and rec.enabled:
        if not b.otp: raise HTTPException(400, "OTP required")
        if not pyotp.TOTP(rec.secret).verify(b.otp, valid_window=1): raise HTTPException(401, "invalid OTP")
    token, exp = create_token(b.username)
    audit("auth.login")
    return TokenOut(access_token=token, expires_at=exp)

@app.post("/auth/logout")
def logout(c=Depends(require_owner)):
    with SessionLocal() as db: db.merge(RevokedSession(jti=c["jti"])); db.commit()
    audit("auth.logout"); return {"ok": True}

@app.get("/auth/me")
def me(c=Depends(require_owner)): return {"user": c["sub"]}

@app.post("/mfa/setup")
def mfa_setup(c=Depends(require_owner)):
    secret = pyotp.random_base32(); codes = [secrets.token_hex(4).upper() for _ in range(8)]
    with SessionLocal() as db:
        db.merge(MfaRecord(username=S.owner_username, secret=secret, enabled=False, backup_codes=codes)); db.commit()
    url = f"otpauth://totp/{S.name}:{S.owner_username}?secret={secret}&issuer={S.name}"
    return {"secret": secret, "otpauth_url": url, "backup_codes": codes}

@app.post("/mfa/verify")
def mfa_verify(b: MfaCode, c=Depends(require_owner)):
    with SessionLocal() as db: rec = db.get(MfaRecord, S.owner_username)
    if not rec: raise HTTPException(400, "run /mfa/setup first")
    if not pyotp.TOTP(rec.secret).verify(b.code, valid_window=1): raise HTTPException(400, "invalid code")
    with SessionLocal() as db:
        r = db.get(MfaRecord, S.owner_username); r.enabled = True; db.commit()
    audit("mfa.enabled", severity="warn"); return {"ok": True}

@app.post("/mfa/disable")
def mfa_disable(c=Depends(require_owner)):
    with SessionLocal() as db:
        r = db.get(MfaRecord, S.owner_username)
        if r: r.enabled = False; db.commit()
    return {"ok": True}

@app.get("/tools")
def list_tools(_=Depends(require_owner)):
    return {n: {"description": s.description, "scopes": list(s.scopes), "risk": s.risk, "requires_approval": s.requires_approval, "allowed": allowed(S.profile, s)} for n, (s, _) in _REG.items()}

@app.post("/profile")
def set_profile(b: ProfileIn, _=Depends(require_owner)):
    if b.profile not in PROFILES: raise HTTPException(400, "unknown profile")
    old = S.profile; S.profile = b.profile
    audit("profile.change", severity="warn")
    sec_event("permission_change", "warn", {"from": old, "to": b.profile}, ["verify"])
    return {"profile": S.profile}

@app.get("/tasks", response_model=list[TaskOut])
def list_tasks(limit: int = 100, _=Depends(require_owner)):
    with SessionLocal() as db:
        return list(db.query(Task).order_by(Task.created_at.desc()).limit(limit))

@app.post("/tasks", response_model=TaskOut)
async def create_task(b: TaskIn, _=Depends(require_owner)):
    if not scan_input(b.prompt): raise HTTPException(400, "blocked")
    try: return await new_task(b.prompt, b.tool, b.params)
    except (ValueError, PermissionError) as e: raise HTTPException(400, str(e))

@app.post("/tasks/{tid}/approve", response_model=TaskOut)
async def approve(tid: str, b: ApprovalIn, _=Depends(require_owner)):
    with SessionLocal() as db:
        t = db.get(Task, tid)
        if not t: raise HTTPException(404)
        if not t.approval_required: raise HTTPException(400, "no approval needed")
        if b.approve: t.approved = True; db.commit()
        else: t.state = "cancelled"; db.commit()
    await emit(tid)
    if b.approve: await run_task(tid)
    with SessionLocal() as db: return db.get(Task, tid)

@app.get("/audit")
def audit_list(limit: int = 200, _=Depends(require_owner)):
    with SessionLocal() as db:
        rows = db.query(AuditEvent).order_by(AuditEvent.id.desc()).limit(limit).all()
        return [{"id": r.id, "ts": r.ts, "action": r.action, "severity": r.severity, "target": r.target} for r in rows]

@app.post("/pause-all")
def pause_all(_=Depends(require_owner)):
    with SessionLocal() as db:
        n = db.query(Task).filter(Task.state.in_(["queued","needs_approval","running"])).update({"state": "cancelled"})
        db.commit()
    return {"cancelled": n}

@app.get("/security-events")
def sec_list(limit: int = 100, unacked_only: bool = False, _=Depends(require_owner)):
    with SessionLocal() as db:
        q = db.query(SecurityEvent).order_by(SecurityEvent.id.desc())
        if unacked_only: q = q.filter(SecurityEvent.acknowledged == False)
        rows = q.limit(limit).all()
        return [{"id": r.id, "ts": r.ts, "kind": r.kind, "severity": r.severity, "evidence": r.evidence, "acknowledged": r.acknowledged, "recommended": r.recommended} for r in rows]

@app.post("/security-events/{eid}/ack")
def sec_ack(eid: int, _=Depends(require_owner)):
    with SessionLocal() as db:
        e = db.get(SecurityEvent, eid)
        if not e: raise HTTPException(404)
        e.acknowledged = True; db.commit()
    return {"ok": True}

@app.post("/voice/generate")
async def voice_gen(b: ShapeIn, _=Depends(require_owner)):
    return await gen_shape(b.name)

@app.get("/memory")
def get_mem(_=Depends(require_owner)):
    with SessionLocal() as db:
        rows = db.query(MemoryEntry).order_by(MemoryEntry.id.desc()).all()
        return {"entries": [{"id": r.id, "key": r.key, "value": r.value} for r in rows]}

@app.post("/memory")
def add_mem(b: MemoryIn, _=Depends(require_owner)):
    with SessionLocal() as db:
        m = MemoryEntry(key=b.key, value=b.value, sensitive=b.sensitive)
        db.add(m); db.commit(); db.refresh(m)
    return {"id": m.id}

@app.delete("/memory/{mid}")
def del_mem(mid: int, _=Depends(require_owner)):
    with SessionLocal() as db:
        m = db.get(MemoryEntry, mid)
        if not m: raise HTTPException(404)
        db.delete(m); db.commit()
    return {"ok": True}

@app.delete("/memory")
def clear_mem(_=Depends(require_owner)):
    with SessionLocal() as db:
        n = db.query(MemoryEntry).delete(); db.commit()
    return {"deleted": n}

@app.get("/workspaces")
def list_ws(_=Depends(require_owner)):
    with SessionLocal() as db:
        rows = db.query(Workspace).all()
        return [{"id": r.id, "name": r.name, "profile": r.profile, "is_default": r.is_default} for r in rows]

@app.post("/workspaces")
def create_ws(b: WorkspaceIn, _=Depends(require_owner)):
    with SessionLocal() as db:
        if db.query(Workspace).filter(Workspace.name == b.name).first(): raise HTTPException(400, "exists")
        w = Workspace(name=b.name, description=b.description, profile=b.profile)
        db.add(w); db.commit(); db.refresh(w)
    return {"id": w.id}

@app.delete("/workspaces/{wid}")
def del_ws(wid: str, _=Depends(require_owner)):
    with SessionLocal() as db:
        w = db.get(Workspace, wid)
        if not w or w.is_default: raise HTTPException(400, "cannot delete")
        db.delete(w); db.commit()
    return {"ok": True}

@app.get("/integrations")
def list_int(_=Depends(require_owner)):
    with SessionLocal() as db:
        rows = db.query(Integration).all()
        return [{"id": r.id, "name": r.name, "provider": r.provider, "enabled": r.enabled, "has_secret": r.secret_enc is not None} for r in rows]

@app.post("/integrations")
def upsert_int(b: IntegrationIn, _=Depends(require_owner)):
    with SessionLocal() as db:
        i = db.get(Integration, b.provider)
        blob = enc(b.secret) if b.secret else None
        if i:
            i.enabled = b.enabled
            if blob is not None: i.secret_enc = blob
        else:
            db.add(Integration(id=b.provider, name=b.provider, provider=b.provider, enabled=b.enabled, secret_enc=blob))
        db.commit()
    return {"ok": True}

@app.delete("/integrations/{provider}")
def del_int(provider: str, _=Depends(require_owner)):
    with SessionLocal() as db:
        i = db.get(Integration, provider)
        if not i: raise HTTPException(404)
        i.enabled = False; i.secret_enc = None; db.commit()
    return {"ok": True}

@app.get("/kb")
def kb_list(_=Depends(require_owner)):
    with SessionLocal() as db:
        rows = db.query(KnowledgeDoc).all()
        return [{"id": r.id, "title": r.title, "preview": r.content[:200]} for r in rows]

@app.post("/kb")
def kb_add(b: KbIn, _=Depends(require_owner)):
    if not scan_input(b.content): raise HTTPException(400, "blocked")
    with SessionLocal() as db:
        d = KnowledgeDoc(title=b.title, content=b.content)
        db.add(d); db.commit(); db.refresh(d)
    return {"id": d.id}

@app.delete("/kb/{did}")
def kb_del(did: str, _=Depends(require_owner)):
    with SessionLocal() as db:
        d = db.get(KnowledgeDoc, did)
        if not d: raise HTTPException(404)
        db.delete(d); db.commit()
    return {"ok": True}

@app.get("/kb/search")
def kb_search(q: str, _=Depends(require_owner)):
    with SessionLocal() as db:
        rows = db.query(KnowledgeDoc).filter(KnowledgeDoc.content.contains(q)).limit(20).all()
        return [{"id": r.id, "title": r.title, "excerpt": r.content[:300]} for r in rows]

@app.get("/skills")
def skill_list(_=Depends(require_owner)):
    with SessionLocal() as db:
        rows = db.query(Skill).all()
        return [{"id": s.id, "name": s.name, "steps": s.steps, "enabled": s.enabled} for s in rows]

@app.post("/skills")
def skill_add(b: SkillIn, _=Depends(require_owner)):
    with SessionLocal() as db:
        if db.query(Skill).filter(Skill.name == b.name).first(): raise HTTPException(400, "exists")
        s = Skill(name=b.name, steps=b.steps, enabled=b.enabled)
        db.add(s); db.commit(); db.refresh(s)
    return {"id": s.id}

@app.delete("/skills/{sid}")
def skill_del(sid: str, _=Depends(require_owner)):
    with SessionLocal() as db:
        s = db.get(Skill, sid)
        if not s: raise HTTPException(404)
        db.delete(s); db.commit()
    return {"ok": True}

@app.get("/notifications")
def notif_list(_=Depends(require_owner)):
    with SessionLocal() as db:
        rows = db.query(NotifRule).all()
        return [{"event_kind": r.event_kind, "channel": r.channel, "enabled": r.enabled} for r in rows]

@app.post("/notifications")
def notif_set(b: NotifIn, _=Depends(require_owner)):
    with SessionLocal() as db:
        r = db.query(NotifRule).filter(NotifRule.event_kind == b.event_kind).first()
        if r: r.channel = b.channel; r.enabled = b.enabled
        else: db.add(NotifRule(event_kind=b.event_kind, channel=b.channel, enabled=b.enabled))
        db.commit()
    return {"ok": True}

@app.post("/backup")
def backup(_=Depends(require_owner)):
    os.makedirs(S.backup_dir, exist_ok=True)
    db_path = S.database_url.replace("sqlite:///", "")
    if not os.path.exists(db_path): raise HTTPException(400, "sqlite only")
    ts = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    target = os.path.join(S.backup_dir, f"nova-{ts}.db")
    shutil.copy2(db_path, target)
    size = os.path.getsize(target)
    with SessionLocal() as db:
        db.add(Backup(path=target, size=size)); db.commit()
    return {"path": target, "size": size}

@app.get("/backups")
def backups(_=Depends(require_owner)):
    with SessionLocal() as db:
        rows = db.query(Backup).order_by(Backup.created_at.desc()).all()
        return [{"id": b.id, "path": b.path, "size": b.size, "created_at": b.created_at} for b in rows]

@app.post("/retention/apply")
def retention(_=Depends(require_owner)):
    now = dt.datetime.now(dt.timezone.utc)
    with SessionLocal() as db:
        a = db.query(AuditEvent).filter(AuditEvent.ts < now - dt.timedelta(days=S.retention_audit_days)).delete()
        t = db.query(Task).filter(Task.created_at < now - dt.timedelta(days=S.retention_task_days), Task.state.in_(["completed","failed","cancelled"])).delete()
        db.commit()
    return {"audit_deleted": a, "tasks_deleted": t}

@app.post("/reset")
def reset(b: ResetIn, _=Depends(require_owner)):
    if b.confirm != "RESET": raise HTTPException(400, 'send {"confirm":"RESET"}')
    with SessionLocal() as db:
        for M in (Task, AuditEvent, SecurityEvent, MemoryEntry, HologramShape, RevokedSession):
            db.query(M).delete()
        db.commit()
    return {"ok": True}

@app.websocket("/ws")
async def ws(websocket: WebSocket, token: str = Query(...)):
    try: c = decode_token(token)
    except HTTPException: await websocket.close(code=4401); return
    with SessionLocal() as db:
        if db.get(RevokedSession, c.get("jti")): await websocket.close(code=4401); return
    await hub.connect(websocket)
    try:
        while True: await websocket.receive_text()
    except WebSocketDisconnect: await hub.disconnect(websocket)
