"""
Environment Service
Manages Demo & PoC Sandboxes organized by industry verticals.
"""
import base64
import os
import json
import re
import shlex
import shutil
from datetime import datetime
import time
import socket
import threading
from typing import Dict, List, Optional, Any, Tuple
from .docker_service import DockerService
from .acr_service import ACRService

VERTICAL_CATEGORIES = [
    {"id": "insurance", "name": "Seguros", "icon": "shield-check", "color": "blue"},
    {"id": "financials", "name": "Banca y Finanzas", "icon": "bank", "color": "emerald"},
    {"id": "telco", "name": "Telecomunicaciones", "icon": "signal", "color": "purple"},
    {"id": "healthcare", "name": "Salud", "icon": "heart-pulse", "color": "rose"},
    {"id": "retail", "name": "Retail & Consumo", "icon": "shopping-bag", "color": "amber"},
    {"id": "poc", "name": "PoC Cliente Específico", "icon": "briefcase", "color": "indigo"},
    {"id": "other", "name": "General / Otra", "icon": "layers", "color": "slate"}
]

# Environment ids end up in paths, compose project names and shell commands
ENV_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")
# Docker image tag grammar
VERSION_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$")


FIREBASE_WEB_KEYS = ("apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId", "measurementId")


def _parse_firebase_web_config(raw: str) -> Dict[str, str]:
    """Accepts either JSON or the `const firebaseConfig = {...}` snippet copied from Firebase Console."""
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return {k: str(data[k]) for k in FIREBASE_WEB_KEYS if data.get(k)}
    except ValueError:
        pass
    pairs = dict(re.findall(r"""(\w+)\s*:\s*["']([^"']*)["']""", raw))
    return {k: pairs[k] for k in FIREBASE_WEB_KEYS if pairs.get(k)}


def _is_windows_path(path: str) -> bool:
    return bool(re.match(r"^[a-zA-Z]:[/\\]", path)) or path.startswith("\\\\")


def _normalize_host_path(path: str) -> str:
    """Normalizes a user-supplied host path. Raises ValueError for paths that
    cannot be safely embedded in docker-compose YAML."""
    if any(ch in path for ch in ('"', "\n", "\r", "$")):
        raise ValueError(f"Ruta de host inválida: {path!r}")
    if _is_windows_path(path):
        return path.replace("\\", "/").rstrip("/")
    return os.path.abspath(path)


def _prepare_host_dir(host_path: str, mount: str, subdirs: str) -> Tuple[int, str, str]:
    """Creates directories on the host through a throwaway alpine container."""
    return DockerService._run_cmd(
        f"docker run --rm --security-opt label=disable "
        f"-v {shlex.quote(host_path + ':' + mount)} alpine "
        f"sh -c {shlex.quote(f'mkdir -p {subdirs} && chmod -R 777 {mount}')}",
        timeout=30
    )


class EnvService:
    def __init__(self, base_dir: str):
        self.base_dir = os.path.abspath(base_dir)
        self.data_dir = os.path.join(self.base_dir, "manager", "data")
        self.envs_file = os.path.join(self.data_dir, "environments.json")
        self.envs_dir = os.path.join(self.base_dir, "manager", "environments")
        self.root_compose = os.path.join(self.base_dir, "docker-compose.yml")
        self.firebase_key_file = os.path.join(self.data_dir, "firebase-service-account.json")
        self.firebase_web_file = os.path.join(self.data_dir, "firebase-web.json")
        self.root_env = os.path.join(self.data_dir, ".quadient_credentials.env")
        if not os.path.exists(self.root_env) and os.path.exists(os.path.join(self.base_dir, ".quadient_credentials.env")):
            self.root_env = os.path.join(self.base_dir, ".quadient_credentials.env")
        os.makedirs(self.data_dir, exist_ok=True)
        os.makedirs(self.envs_dir, exist_ok=True)
        # In-flight activations: env_id -> {"step", "total", "label"}; polled by the UI
        self._progress: Dict[str, Dict[str, Any]] = {}
        self._progress_lock = threading.Lock()

    def _read_json(self, path: str) -> Optional[Dict[str, Any]]:
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else None
        except (OSError, ValueError):
            return None

    def _write_secret_json(self, path: str, data: Dict[str, Any]) -> None:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.chmod(path, 0o600)

    def get_firebase_status(self) -> Dict[str, Any]:
        """Reports which Firebase settings are stored for the push inbox, without exposing secrets."""
        key = self._read_json(self.firebase_key_file) or {}
        web = self._read_json(self.firebase_web_file) or {}
        web_config = web.get("config") or {}
        return {
            "configured": bool(key and web_config and web.get("vapid_key")),
            "service_account": bool(key),
            "project_id": key.get("project_id", ""),
            "client_email": key.get("client_email", ""),
            "web_config": bool(web_config),
            "web_project_id": web_config.get("projectId", ""),
            "vapid_key": bool(web.get("vapid_key")),
        }

    def save_firebase_settings(self, service_account: str, web_config: str, vapid_key: str) -> Tuple[bool, str]:
        """Validates and stores the user's own Firebase project for the push inbox.

        Empty fields keep the stored value, so a single piece can be replaced later."""
        key = self._read_json(self.firebase_key_file)
        web = self._read_json(self.firebase_web_file) or {}

        if service_account:
            try:
                key = json.loads(service_account)
            except ValueError:
                return False, "La cuenta de servicio no es un JSON válido"
            if not isinstance(key, dict) or key.get("type") != "service_account" or not key.get("private_key") or not key.get("client_email"):
                return False, "El JSON no corresponde a una cuenta de servicio de Firebase (falta type, private_key o client_email)"

        if web_config:
            parsed = _parse_firebase_web_config(web_config)
            missing = [k for k in ("apiKey", "projectId", "messagingSenderId", "appId") if not parsed.get(k)]
            if missing:
                return False, f"A la configuración web le faltan campos: {', '.join(missing)}"
            web["config"] = parsed

        if vapid_key:
            if not re.match(r"^[A-Za-z0-9_-]{80,100}$", vapid_key):
                return False, "La VAPID key no tiene el formato esperado (clave pública de Cloud Messaging > Web Push certificates)"
            web["vapid_key"] = vapid_key

        if not key or not web.get("config") or not web.get("vapid_key"):
            return False, "Faltan datos: se necesitan la cuenta de servicio, la configuración web y la VAPID key"
        if key.get("project_id") != web["config"].get("projectId"):
            return False, (f"La cuenta de servicio es del proyecto '{key.get('project_id')}' pero la configuración web "
                           f"es de '{web['config'].get('projectId')}'; deben ser del mismo proyecto de Firebase")

        self._write_secret_json(self.firebase_key_file, key)
        self._write_secret_json(self.firebase_web_file, web)
        # Running environments only see the new settings after their next activation
        for env in self.list_environments():
            if env.get("enable_inbox") and env.get("compose_file"):
                self._write_inbox_env(os.path.dirname(env["compose_file"]))
        return True, f"Firebase configurado con el proyecto {key.get('project_id')}"

    def _write_inbox_env(self, target_dir: str) -> None:
        """Writes inbox.env for the push-inbox service; empty when Firebase is not set up so compose still starts."""
        lines = ["# Generated by Studio Manager"]
        if os.path.exists(self.firebase_key_file):
            with open(self.firebase_key_file, "rb") as f:
                lines.append("FIREBASE_SERVICE_ACCOUNT_KEY=" + base64.b64encode(f.read()).decode("ascii"))
        web = self._read_json(self.firebase_web_file) or {}
        if web.get("config"):
            lines.append("FIREBASE_WEB_CONFIG=" + base64.b64encode(json.dumps(web["config"]).encode("utf-8")).decode("ascii"))
        if web.get("vapid_key"):
            lines.append("FIREBASE_VAPID_KEY=" + web["vapid_key"])
        path = os.path.join(target_dir, "inbox.env")
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        os.chmod(path, 0o600)

    def get_progress(self, env_id: str) -> Optional[Dict[str, Any]]:
        with self._progress_lock:
            p = self._progress.get(env_id)
            return dict(p) if p else None

    def _set_progress(self, env_id: str, step: int, total: int, label: str):
        with self._progress_lock:
            self._progress[env_id] = {"step": step, "total": total, "label": label}

    def _ensure_default_env(self):
        """Deprecated: environments are now created explicitly by the user."""
        pass

    def list_environments(self) -> List[Dict[str, Any]]:
        if os.path.exists(self.envs_file):
            # A corrupt file must raise: returning [] here would make the next
            # _save_environments() wipe every environment.
            with open(self.envs_file, "r", encoding="utf-8") as f:
                envs = json.load(f)
            try:

                # Filter out 'default' environment completely
                envs = [e for e in envs if e.get("id") != "default"]

                # Path healing for environments if base path changed
                changed = False
                for env in envs:
                    env_id = env.get("id")
                    if not env_id:
                        continue
                    curr_compose = env.get("compose_file", "")
                    if not os.path.exists(curr_compose):
                        healed_compose = os.path.join(self.envs_dir, env_id, "docker-compose.yml")
                        if os.path.exists(healed_compose):
                            env["compose_file"] = healed_compose
                            changed = True

                    curr_env_file = env.get("env_file", "")
                    if not os.path.exists(curr_env_file):
                        healed_env = os.path.join(self.envs_dir, env_id, ".env")
                        if os.path.exists(healed_env):
                            env["env_file"] = healed_env
                            changed = True

                    # Dynamically check real running status from docker
                    containers = DockerService.get_containers_for_project(env["project_name"])

                    # Check if scaler and interactive are started (running)
                    scaler_started = any(c.get("service") == "scaler" and c.get("state") == "running" for c in containers)
                    interactive_started = any(c.get("service") == "interactive" and c.get("state") == "running" for c in containers)

                    # Once scaler and interactive are started or prepare completed successfully, hide prepare one-shot containers
                    filtered_containers = []
                    for c in containers:
                        svc = c.get("service", "")
                        name = c.get("name", "")
                        is_scaler_prep = (svc == "scaler-prepare" or "-scaler-prepare" in name)
                        is_inter_prep = (svc == "interactive-prepare" or "-interactive-prepare" in name)

                        if is_scaler_prep:
                            is_success = c.get("state") == "exited" and "Exited (0)" in c.get("status", "")
                            if scaler_started or is_success:
                                continue
                        elif is_inter_prep:
                            is_success = c.get("state") == "exited" and "Exited (0)" in c.get("status", "")
                            if interactive_started or is_success:
                                continue

                        filtered_containers.append(c)

                    env["containers"] = filtered_containers
                    running_count = sum(1 for c in filtered_containers if c.get("state") == "running")
                    total_count = len(filtered_containers)
                    if running_count > 0:
                        # "running" only when every service is up; one exited container
                        # (e.g. Interactive) must not look healthy during a demo
                        env["status"] = "running" if running_count == total_count else "partial"
                    else:
                        env["status"] = "stopped"
                    env["activation"] = self.get_progress(env_id)
                    env["active_containers"] = running_count
                    env["total_containers"] = total_count

                    # Ensure storage_path and volume_locations exist for UI
                    if "storage_path" not in env or not env.get("volume_locations"):
                        vols = env.get("volumes", {})
                        locations = {}
                        has_custom = False
                        custom_base = None
                        for k, vname in vols.items():
                            v_det = DockerService.get_volume_details(vname)
                            h_path = v_det.get("host_path", "")
                            locations[k] = h_path
                            if v_det.get("is_custom"):
                                has_custom = True
                                custom_base = os.path.dirname(h_path)
                        env["storage_path"] = custom_base if has_custom else "docker_default"
                        env["volume_locations"] = locations

                if changed:
                    self._save_environments(envs)
            except Exception:
                # Runtime enrichment is best-effort; keep the persisted data
                pass
            return envs
        return []

    def _save_environments(self, envs: List[Dict[str, Any]]):
        # Strip runtime fields before saving
        clean_envs = []
        for e in envs:
            item = dict(e)
            item.pop("containers", None)
            item.pop("status", None)
            item.pop("active_containers", None)
            item.pop("total_containers", None)
            item.pop("activation", None)
            clean_envs.append(item)
        tmp_file = self.envs_file + ".tmp"
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(clean_envs, f, indent=2, ensure_ascii=False)
        os.replace(tmp_file, self.envs_file)

    def get_environment(self, env_id: str) -> Optional[Dict[str, Any]]:
        envs = self.list_environments()
        for e in envs:
            if e["id"] == env_id:
                return e
        return None

    def get_used_ports(self) -> set:
        """Returns set of all ports used across all environments and running containers."""
        used = set()
        envs = self.list_environments()
        for e in envs:
            for p in e.get("ports", {}).values():
                if isinstance(p, int):
                    used.add(p)
        # Studio manager port
        used.add(8090)
        # Ports from running docker containers
        try:
            bound = DockerService.get_all_bound_ports()
            used.update(bound)
        except Exception:
            pass
        return used

    def allocate_next_ports(self) -> Dict[str, int]:
        """Calculates next non-conflicting port set for a new environment."""
        used_ports = self.get_used_ports()

        # Step by 10 to ensure wide non-overlapping margins
        offset = 10
        while True:
            candidate_ports = {
                "interactive": 30701 + offset,
                "scaler": 30600 + offset,
                "scaler_ips": 30354 + offset,
                "icm": 30353 + offset,
                "postgres": 5432 + offset,
                "csv_studio": 8081 + (offset % 50) if (8081 + (offset % 50)) != 8090 else 8091,
                "kafka": 9092 + (offset % 50),
                "inbox": 3000 + (offset % 50),
                "ftp": 21 if 21 not in used_ports and offset == 10 else 2121 + (offset % 50),
                "ftp_pasv_min": 21100 + (offset * 10),
                "ftp_pasv_max": 21105 + (offset * 10)
            }
            if not any(candidate_ports[k] in used_ports for k in ["interactive", "scaler", "scaler_ips", "icm", "postgres", "csv_studio", "kafka", "inbox", "ftp"]):
                return candidate_ports
            offset += 10

    def create_environment(self, data: Dict[str, Any]) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        name = data.get("name", "").strip()
        if not name:
            return False, "El nombre del ambiente es obligatorio", None

        import unicodedata
        env_id = data.get("id", "").strip().lower()
        if not env_id:
            normalized = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode('utf-8')
            env_id = re.sub(r"[^a-z0-9_-]", "-", normalized.lower()).strip("-")
            env_id = re.sub(r"-+", "-", env_id)
        if not ENV_ID_RE.match(env_id):
            return False, "Identificador de ambiente inválido (solo minúsculas, números, '-' y '_')", None

        envs = self.list_environments()
        if any(e["id"] == env_id for e in envs):
            env_id = f"{env_id}-{int(datetime.now().timestamp()) % 1000}"

        vertical = data.get("vertical", "Seguros")
        vertical_id = data.get("vertical_id", "insurance")
        description = data.get("description", "")
        version = (data.get("version") or "17.5-latest").strip()
        if not VERSION_RE.match(version):
            return False, f"Versión inválida: {version!r}", None

        enable_interactive = bool(data.get("enable_interactive", True))
        enable_scaler = bool(data.get("enable_scaler", True))
        scaler_sharedfolder = data.get("scaler_sharedfolder", "").strip() if enable_scaler else ""
        scaler_jobs_dir = data.get("scaler_jobs_dir", "").strip() if enable_scaler else ""
        enable_kafka = bool(data.get("enable_kafka", False))
        enable_inbox = bool(data.get("enable_inbox", False))
        enable_ftp = bool(data.get("enable_ftp", False))

        # Handle custom requested port
        req_inter_port = data.get("interactive_port")
        if not req_inter_port and "ports" in data and isinstance(data["ports"], dict):
            req_inter_port = data["ports"].get("interactive")

        if req_inter_port:
            try:
                p_inter = int(req_inter_port)
                offset = p_inter - 30701
                if offset < 0:
                    return False, f"El puerto de Interactive debe ser mayor o igual a 30701 (recibido: {p_inter})", None
                ports = {
                    "interactive": p_inter,
                    "scaler": 30600 + offset,
                    "scaler_ips": 30354 + offset,
                    "icm": 30353 + offset,
                    "postgres": 5432 + offset,
                    "csv_studio": 8081 + (offset % 50) if (8081 + (offset % 50)) != 8090 else 8091,
                    "kafka": 9092 + (offset % 50),
                    "inbox": 3000 + (offset % 50),
                    "ftp": 21 if 21 not in self.get_used_ports() else 2121 + (offset % 50),
                    "ftp_pasv_min": 21100 + (offset * 10),
                    "ftp_pasv_max": 21105 + (offset * 10)
                }
                # Check for conflicts
                used_ports = self.get_used_ports()
                conflicts = [p for p in ports.values() if p in used_ports]
                if conflicts:
                    return False, f"Conflicto de puertos: los puertos {conflicts} ya están asignados o en uso en el host. Por favor selecciona otro puerto o déjalo en blanco para auto-asignación.", None
            except ValueError:
                return False, "Puerto de Interactive inválido", None
        else:
            ports = self.allocate_next_ports()

        project_name = f"flex-{env_id}"

        # Storage path handling
        raw_storage = data.get("storage_path", "").strip()
        custom_storage_dir = None
        try:
            if raw_storage:
                norm = _normalize_host_path(raw_storage)
                if not norm.lower().endswith(f"/{env_id.lower()}"):
                    norm = f"{norm}/{env_id}"
                custom_storage_dir = norm
            if enable_scaler and scaler_sharedfolder:
                scaler_sharedfolder = _normalize_host_path(scaler_sharedfolder)
            if enable_scaler and scaler_jobs_dir:
                scaler_jobs_dir = _normalize_host_path(scaler_jobs_dir)
        except ValueError as e:
            return False, str(e), None

        if custom_storage_dir:
            # Create host directories and assign open permissions
            code, out, err = _prepare_host_dir(
                custom_storage_dir, "/base",
                "/base/pgdata /base/icmdata /base/filestore /base/demomode /base/sharedfolder /base/jobsdir"
            )
            if code != 0:
                return False, f"Error al inicializar la carpeta en el host '{custom_storage_dir}': {err or out}", None

        # Scaler sharedfolder host setup if custom path specified
        if enable_scaler and scaler_sharedfolder:
            code, out, err = _prepare_host_dir(scaler_sharedfolder, "/share", "/share")
            if code != 0:
                return False, f"Error al inicializar la carpeta compartida de Scaler en el host '{scaler_sharedfolder}': {err or out}", None

        # Scaler jobs directory host setup if custom path specified
        if enable_scaler and scaler_jobs_dir:
            code, out, err = _prepare_host_dir(scaler_jobs_dir, "/jobs", "/jobs")
            if code != 0:
                return False, f"Error al inicializar la carpeta Jobs de Scaler en el host '{scaler_jobs_dir}': {err or out}", None

        # Setup environment directory
        target_dir = os.path.join(self.envs_dir, env_id)
        os.makedirs(target_dir, exist_ok=True)
        compose_file = os.path.join(target_dir, "docker-compose.yml")
        env_file = os.path.join(target_dir, ".env")

        # Copy credentials from root
        root_creds = ACRService.get_credentials(self.root_env)
        root_creds["INSPIRE_VERSION"] = version
        ACRService.save_credentials(env_file, root_creds)

        # Demo Mode handling
        demo_mode = bool(data.get("demo_mode", False))
        demo_mode_src = os.path.join(self.base_dir, "Inspire", "demo-mode")
        if not os.path.exists(demo_mode_src):
            demo_mode_src = os.path.join(self.base_dir, "demo-mode")

        env_demo_mode_dir = os.path.join(target_dir, "demo-mode")
        if demo_mode and os.path.exists(demo_mode_src):
            if os.path.exists(env_demo_mode_dir):
                shutil.rmtree(env_demo_mode_dir)
            shutil.copytree(demo_mode_src, env_demo_mode_dir)

        # Generate custom docker-compose.yml
        compose_content = self._render_compose_template(
            env_id, project_name, ports, version, demo_mode=demo_mode, target_dir=target_dir,
            custom_storage_dir=custom_storage_dir, enable_interactive=enable_interactive,
            enable_scaler=enable_scaler, scaler_sharedfolder=scaler_sharedfolder,
            scaler_jobs_dir=scaler_jobs_dir,
            enable_kafka=enable_kafka, enable_inbox=enable_inbox, enable_ftp=enable_ftp
        )
        with open(compose_file, "w", encoding="utf-8") as f:
            f.write(compose_content)

        new_env = {
            "id": env_id,
            "name": name,
            "vertical": vertical,
            "vertical_id": vertical_id,
            "description": description,
            "version": version,
            "demo_mode": demo_mode,
            "enable_interactive": enable_interactive,
            "enable_scaler": enable_scaler,
            "scaler_sharedfolder": scaler_sharedfolder,
            "scaler_jobs_dir": scaler_jobs_dir,
            "enable_kafka": enable_kafka,
            "enable_inbox": enable_inbox,
            "enable_ftp": enable_ftp,
            "project_name": project_name,
            "compose_file": compose_file,
            "env_file": env_file,
            "ports": ports,
            "storage_path": custom_storage_dir or "docker_default",
            "volume_locations": {
                "pgdata": f"{custom_storage_dir}/pgdata" if custom_storage_dir else f"/var/lib/docker/volumes/{project_name}_pgdata_{env_id}/_data",
                "icmdata": f"{custom_storage_dir}/icmdata" if custom_storage_dir else f"/var/lib/docker/volumes/{project_name}_icmdata_{env_id}/_data",
                **({"filestore": f"{custom_storage_dir}/filestore" if custom_storage_dir else f"/var/lib/docker/volumes/{project_name}_filestore_{env_id}/_data"} if enable_interactive else {}),
                **({"demomode": f"{custom_storage_dir}/demomode" if custom_storage_dir else f"/var/lib/docker/volumes/{project_name}_demomode_{env_id}/_data"} if (enable_interactive and demo_mode) else {}),
                **({"sharedfolder": scaler_sharedfolder if scaler_sharedfolder else (f"{custom_storage_dir}/sharedfolder" if custom_storage_dir else f"/var/lib/docker/volumes/{project_name}_sharedfolder_{env_id}/_data")} if enable_scaler else {}),
                **({"jobsdir": scaler_jobs_dir if scaler_jobs_dir else (f"{custom_storage_dir}/jobsdir" if custom_storage_dir else f"/var/lib/docker/volumes/{project_name}_jobsdir_{env_id}/_data")} if enable_scaler else {}),
                **({"ftpdata": f"/var/lib/docker/volumes/{project_name}_ftpdata_{env_id}/_data"} if enable_ftp else {})
            },
            "volumes": {
                "pgdata": f"{project_name}_pgdata_{env_id}",
                "icmdata": f"{project_name}_icmdata_{env_id}",
                **({"filestore": f"{project_name}_filestore_{env_id}"} if enable_interactive else {}),
                **({"demomode": f"{project_name}_demomode_{env_id}"} if (enable_interactive and demo_mode) else {}),
                **({"sharedfolder": f"{project_name}_sharedfolder_{env_id}"} if enable_scaler else {}),
                **({"jobsdir": f"{project_name}_jobsdir_{env_id}"} if enable_scaler else {}),
                **({"ftpdata": f"{project_name}_ftpdata_{env_id}"} if enable_ftp else {})
            },
            "is_default": False,
            "initialized": False,
            "created_at": datetime.now().isoformat(),
            "last_active": datetime.now().isoformat()
        }

        envs.append(new_env)
        self._save_environments(envs)
        return True, "Ambiente creado exitosamente", new_env

    def update_environment(self, env_id: str, data: Dict[str, Any]) -> Tuple[bool, str]:
        envs = self.list_environments()
        target = None
        for e in envs:
            if e["id"] == env_id:
                target = e
                break
        if not target:
            return False, "Ambiente no encontrado"

        if "name" in data:
            target["name"] = data["name"].strip()
        if "description" in data:
            target["description"] = data["description"].strip()
        if "vertical" in data:
            target["vertical"] = data["vertical"]
        if "vertical_id" in data:
            target["vertical_id"] = data["vertical_id"]
        if "version" in data and data["version"]:
            new_ver = data["version"].strip()
            if not VERSION_RE.match(new_ver):
                return False, f"Versión inválida: {new_ver!r}"
            target["version"] = new_ver
            # Update .env in environment directory
            if os.path.exists(target["env_file"]):
                creds = ACRService.get_credentials(target["env_file"])
                creds["INSPIRE_VERSION"] = new_ver
                ACRService.save_credentials(target["env_file"], creds)

        # Allocate ports if missing
        ports = target.setdefault("ports", {})
        used_ports = self.get_used_ports()
        offset = ports.get("interactive", 30701) - 30701
        if "kafka" not in ports:
            ports["kafka"] = 9092 + (offset % 50)
            while ports["kafka"] in used_ports:
                ports["kafka"] += 1
        if "csv_studio" not in ports:
            ports["csv_studio"] = 8081 + (offset % 50) if (8081 + (offset % 50)) != 8090 else 8091
            while ports["csv_studio"] in used_ports:
                ports["csv_studio"] += 1
        if "inbox" not in ports:
            ports["inbox"] = 3000 + (offset % 50)
            while ports["inbox"] in used_ports:
                ports["inbox"] += 1
        if "ftp" not in ports:
            ports["ftp"] = 21 if 21 not in used_ports else 2121 + (offset % 50)
            while ports["ftp"] in used_ports:
                ports["ftp"] += 1
        if "ftp_pasv_min" not in ports:
            ports["ftp_pasv_min"] = 21100 + (offset * 10)
        if "ftp_pasv_max" not in ports:
            ports["ftp_pasv_max"] = 21105 + (offset * 10)

        # Demo mode
        if "demo_mode" in data:
            new_demo = bool(data["demo_mode"])
            target["demo_mode"] = new_demo
            if new_demo:
                target.setdefault("volumes", {})["demomode"] = f"{target['project_name']}_demomode_{env_id}"
                target.setdefault("volume_locations", {})["demomode"] = f"/var/lib/docker/volumes/{target['project_name']}_demomode_{env_id}/_data"
            else:
                target.get("volumes", {}).pop("demomode", None)
                target.get("volume_locations", {}).pop("demomode", None)

        # Interactive stack
        if "enable_interactive" in data:
            target["enable_interactive"] = bool(data["enable_interactive"])
            if target["enable_interactive"]:
                target.setdefault("volumes", {})["filestore"] = f"{target['project_name']}_filestore_{env_id}"
                target.setdefault("volume_locations", {})["filestore"] = f"/var/lib/docker/volumes/{target['project_name']}_filestore_{env_id}/_data"
            else:
                target.get("volumes", {}).pop("filestore", None)
                target.get("volume_locations", {}).pop("filestore", None)

        # Scaler sharedfolder setup
        if "scaler_sharedfolder" in data:
            s_folder = data["scaler_sharedfolder"].strip()
            if s_folder:
                try:
                    s_folder = _normalize_host_path(s_folder)
                except ValueError as e:
                    return False, str(e)
            target["scaler_sharedfolder"] = s_folder
            if target.get("enable_scaler") and s_folder:
                _prepare_host_dir(s_folder, "/share", "/share")

        # Scaler jobs directory setup
        if "scaler_jobs_dir" in data:
            j_dir = data["scaler_jobs_dir"].strip()
            if j_dir:
                try:
                    j_dir = _normalize_host_path(j_dir)
                except ValueError as e:
                    return False, str(e)
            target["scaler_jobs_dir"] = j_dir
            if target.get("enable_scaler") and j_dir:
                _prepare_host_dir(j_dir, "/jobs", "/jobs")

        # Scaler stack
        if "enable_scaler" in data:
            target["enable_scaler"] = bool(data["enable_scaler"])
            if target["enable_scaler"]:
                target.setdefault("volumes", {})["sharedfolder"] = f"{target['project_name']}_sharedfolder_{env_id}"
                s_folder = target.get("scaler_sharedfolder", "")
                target.setdefault("volume_locations", {})["sharedfolder"] = s_folder if s_folder else f"/var/lib/docker/volumes/{target['project_name']}_sharedfolder_{env_id}/_data"

                target.setdefault("volumes", {})["jobsdir"] = f"{target['project_name']}_jobsdir_{env_id}"
                j_dir = target.get("scaler_jobs_dir", "")
                target.setdefault("volume_locations", {})["jobsdir"] = j_dir if j_dir else f"/var/lib/docker/volumes/{target['project_name']}_jobsdir_{env_id}/_data"
            else:
                target.get("volumes", {}).pop("sharedfolder", None)
                target.get("volume_locations", {}).pop("sharedfolder", None)
                target.get("volumes", {}).pop("jobsdir", None)
                target.get("volume_locations", {}).pop("jobsdir", None)

        # Kafka stack
        if "enable_kafka" in data:
            target["enable_kafka"] = bool(data["enable_kafka"])

        # Push notifications inbox
        if "enable_inbox" in data:
            target["enable_inbox"] = bool(data["enable_inbox"])

        # FTP server
        if "enable_ftp" in data:
            target["enable_ftp"] = bool(data["enable_ftp"])
            if target["enable_ftp"]:
                target.setdefault("volumes", {})["ftpdata"] = f"{target['project_name']}_ftpdata_{env_id}"
                target.setdefault("volume_locations", {})["ftpdata"] = f"/var/lib/docker/volumes/{target['project_name']}_ftpdata_{env_id}/_data"
            else:
                target.get("volumes", {}).pop("ftpdata", None)
                target.get("volume_locations", {}).pop("ftpdata", None)

        # Re-render docker-compose.yml
        compose_content = self._render_compose_template(
            env_id, target["project_name"], target["ports"], target.get("version", "17.5-latest"),
            demo_mode=target.get("demo_mode", False),
            target_dir=os.path.dirname(target["compose_file"]),
            custom_storage_dir=target.get("storage_path") if target.get("storage_path") != "docker_default" else None,
            enable_interactive=target.get("enable_interactive", True),
            enable_scaler=target.get("enable_scaler", True),
            scaler_sharedfolder=target.get("scaler_sharedfolder", ""),
            scaler_jobs_dir=target.get("scaler_jobs_dir", ""),
            enable_kafka=target.get("enable_kafka", False),
            enable_inbox=target.get("enable_inbox", False),
            enable_ftp=target.get("enable_ftp", False)
        )
        with open(target["compose_file"], "w", encoding="utf-8") as f:
            f.write(compose_content)

        # If environment is currently running, apply changes live with docker compose up
        if target.get("status") in ["running", "partial"]:
            if target.get("demo_mode"):
                self._ensure_demo_mode_volume(target)
            DockerService.compose_up(target["compose_file"], target["env_file"], target["project_name"])

        self._save_environments(envs)
        return True, "Ambiente y configuración de servicios actualizados correctamente"

    def delete_environment(self, env_id: str, remove_volumes: bool = False) -> Tuple[bool, str]:
        envs = self.list_environments()
        target = None
        for e in envs:
            if e["id"] == env_id:
                target = e
                break
        if not target:
            return False, "Ambiente no encontrado"

        # Stop & down containers
        project_name = target["project_name"]
        DockerService.compose_down(target["compose_file"], project_name, remove_volumes=remove_volumes)

        if remove_volumes:
            vols = target.get("volumes", {})
            vol_names = set(vols.values()) if isinstance(vols, dict) else set()
            for vol_type in ["pgdata", "icmdata", "filestore", "demomode", "sharedfolder", "jobsdir", "ftpdata"]:
                vol_names.add(f"{project_name}_{vol_type}_{env_id}")
                vol_names.add(f"{env_id}_{vol_type}_{env_id}")

            for vname in vol_names:
                DockerService._run_cmd(f"docker volume rm -f {shlex.quote(vname)}")

            # Clean custom host storage subdirectories if applicable
            storage_path = target.get("storage_path")
            if storage_path and storage_path != "docker_default":
                DockerService._run_cmd(
                    f"docker run --rm --security-opt label=disable -v {shlex.quote(storage_path + ':/dir')} alpine "
                    f'sh -c "rm -rf /dir/pgdata /dir/icmdata /dir/filestore /dir/demomode /dir/sharedfolder /dir/jobsdir /dir/ftpdata"',
                    timeout=30
                )

        # Remove env directory
        env_dir = os.path.dirname(target["compose_file"])
        if os.path.exists(env_dir):
            try:
                shutil.rmtree(env_dir)
            except Exception:
                pass

        envs = [e for e in envs if e["id"] != env_id]
        self._save_environments(envs)
        return True, "Ambiente eliminado exitosamente"

    def _ensure_demo_mode_volume(self, target: Dict[str, Any]) -> Tuple[bool, str]:
        """Ensures the demo-mode volume is populated with users and avatar pictures."""
        if not target.get("demo_mode"):
            return True, "Demo mode no habilitado"

        env_id = target["id"]
        project_name = target["project_name"]
        vol_name = f"{project_name}_demomode_{env_id}"

        target_dir = os.path.dirname(target["compose_file"])
        demo_src = os.path.join(target_dir, "demo-mode")
        if not os.path.exists(demo_src):
            demo_src = os.path.join(self.base_dir, "Inspire", "demo-mode")
        if not os.path.exists(demo_src):
            demo_src = os.path.join(self.base_dir, "demo-mode")

        if not os.path.exists(demo_src):
            return False, f"Directorio demo-mode no encontrado en {demo_src}"

        # Create Docker volume if not exists
        storage_path = target.get("storage_path")
        demomode_host = (target.get("volume_locations") or {}).get("demomode")
        if demomode_host and storage_path and storage_path != "docker_default":
            _prepare_host_dir(demomode_host, "/dir", "/dir")
            DockerService._run_cmd(
                f"docker volume create --opt type=none --opt o=bind "
                f"--opt {shlex.quote('device=' + demomode_host)} {shlex.quote(vol_name)}"
            )
        else:
            DockerService._run_cmd(f"docker volume create {shlex.quote(vol_name)}")

        # Copy files into volume and ensure read permissions
        copy_cmd = (
            f"tar -C {shlex.quote(demo_src)} -cf - . | "
            f"docker run --rm -i --security-opt label=disable -v {shlex.quote(vol_name + ':/target')} postgres:15-alpine "
            f"sh -c 'tar -C /target -xf - && chmod -R a+rX /target'"
        )
        code, out, err = DockerService._run_cmd(copy_cmd, timeout=30)
        if code != 0:
            return False, f"Error al inicializar volumen de demo-mode: {err or out}"
        return True, "Volumen demo-mode configurado correctamente"

    def get_environment_volumes(self, env_id: str) -> List[Dict[str, Any]]:
        """Returns details of all persistent volumes for this environment including host physical paths."""
        env = self.get_environment(env_id)
        if not env:
            return []

        project_name = env.get("project_name", f"flex-{env_id}")
        vols_dict = env.get("volumes", {})
        results = []

        component_names = {
            "pgdata": "Bases de Datos (PostgreSQL)",
            "icmdata": "Paquetes y Repositorio (Inspire ICM)",
            "filestore": "Almacén de Archivos (Interactive)",
            "demomode": "Usuarios y Avatares (Demo Mode)",
            "sharedfolder": "Carpeta Compartida Host ↔ Scaler (/sharedfolder)",
            "jobsdir": "Directorio de Trabajos Scaler (/opt/scalerSharedFolder)",
            "ftpdata": "Archivos Servidor FTP (/home/vsftpd/system)"
        }

        for key, vol_name in vols_dict.items():
            details = DockerService.get_volume_details(vol_name)
            host_path = details.get("host_path")
            if not details.get("is_custom") and env.get("volume_locations", {}).get(key):
                saved_path = env["volume_locations"][key]
                if saved_path and not saved_path.startswith("/var/lib/docker"):
                    host_path = saved_path
                    details["is_custom"] = True

            results.append({
                "component": component_names.get(key, key.capitalize()),
                "key": key,
                "volume_name": vol_name,
                "host_path": host_path,
                "is_custom": details.get("is_custom", False),
                "driver": details.get("driver", "local")
            })
        return results

    def activate_demo(self, env_id: str, exclusive: bool = True) -> Tuple[bool, str]:
        with self._progress_lock:
            if env_id in self._progress:
                return False, "Este ambiente ya se está activando. Espera a que termine."
            self._progress[env_id] = {"step": 0, "total": 1, "label": "Preparando activación"}
        try:
            return self._activate_demo(env_id, exclusive)
        finally:
            with self._progress_lock:
                self._progress.pop(env_id, None)

    def _activate_demo(self, env_id: str, exclusive: bool) -> Tuple[bool, str]:
        """
        Activates a Demo environment.
        If exclusive=True (RAM-saving mode), stops all other environments first.
        Ensures ICM user 'system' and Scaler permissions are initialized before starting the stack.
        """
        envs = self.list_environments()
        target = None
        for e in envs:
            if e["id"] == env_id:
                target = e
                break
        if not target:
            return False, "Ambiente no encontrado"

        # Check credentials and ensure Docker CLI is logged in to ACR
        creds = ACRService.get_credentials(target.get("env_file", self.root_env))
        if not (creds.get("ACR_USERNAME") and creds.get("ACR_PASSWORD")):
            creds = ACRService.get_credentials(self.root_env)

        if not (creds.get("ACR_USERNAME") and creds.get("ACR_PASSWORD")):
            return False, "Credenciales de Azure no configuradas. Por favor dirígete a la pestaña 'Ajustes' (⚙️) o abre el asistente inicial para configurar tu usuario y contraseña de Azure."

        ok_login, msg_login = DockerService.login_registry(
            creds.get("ACR_REGISTRY", "quadientdistribution.azurecr.io"),
            creds.get("ACR_USERNAME"),
            creds.get("ACR_PASSWORD")
        )
        if not ok_login:
            return False, f"Fallo al autenticar Docker con Azure Container Registry: {msg_login}"

        # Steps: stop others, [5 init steps], start services
        needs_init = not target.get("initialized")
        total = 2 + (5 if needs_init else 0)
        self._set_progress(env_id, 1, total, "Liberando recursos de otras demos" if exclusive else "Preparando activación")

        stopped_others = []
        if exclusive:
            for other in envs:
                if other["id"] != env_id and other.get("status") in ("running", "partial"):
                    DockerService.compose_stop(other["compose_file"], other["project_name"])
                    stopped_others.append(other["name"])

        # Always ensure demo mode volume is populated before startup if enabled
        if target.get("demo_mode"):
            self._ensure_demo_mode_volume(target)

        # Check if environment needs initialization (new sandbox or uninitialized ICM)
        if not target.get("initialized"):
            ok_init, msg_init = self._initialize_environment(
                target, lambda step, label: self._set_progress(env_id, 1 + step, total, label)
            )
            if not ok_init:
                return False, f"Fallo al inicializar el ambiente: {msg_init}"
            target["initialized"] = True
            self._save_environments(envs)

        # Pick up a Firebase key configured after the environment was created
        if target.get("enable_inbox"):
            self._write_inbox_env(os.path.dirname(target["compose_file"]))

        # Start target environment
        self._set_progress(env_id, total, total, "Iniciando servicios")
        ok, msg = DockerService.compose_up(target["compose_file"], target["env_file"], target["project_name"])
        if ok:
            target["last_active"] = datetime.now().isoformat()
            self._save_environments(envs)
            detail = f" Ambiente '{target['name']}' activado."
            if stopped_others:
                detail += f" Se suspendieron para ahorrar RAM: {', '.join(stopped_others)}."
            return True, detail
        return False, f"Fallo al iniciar el ambiente: {msg}"

    def stop_demo(self, env_id: str) -> Tuple[bool, str]:
        env = self.get_environment(env_id)
        if not env:
            return False, "Ambiente no encontrado"
        ok, msg = DockerService.compose_stop(env["compose_file"], env["project_name"])
        return ok, msg

    def _initialize_environment(self, target: Dict[str, Any], report=lambda step, label: None) -> Tuple[bool, str]:
        """
        Initializes an environment for the first time:
        1. Starts PostgreSQL and waits until healthy.
        2. Inserts 'system' administrator user in ICM.
        3. Starts ICM and waits until running.
        4. Grants 'User impersonation' and permissions to 'system'.
        5. Runs 'scaler-prepare' to create database schemas.
        """
        compose_file = target["compose_file"]
        env_file = target["env_file"]
        project_name = target["project_name"]
        version = target.get("version", "17.5-latest")

        # Fast-path: Check if scaler-prepare already succeeded in a prior run
        if target.get("enable_scaler", True):
            scaler_prep_container = f"{project_name}-scaler-prepare"
            code, out, _ = DockerService._run_cmd(f"docker inspect --format='{{{{.State.Status}}}}:{{{{.State.ExitCode}}}}' {scaler_prep_container}")
            if code == 0 and out.strip() == "exited:0":
                return True, "Ambiente ya preparado previamente con éxito."

        creds = ACRService.get_credentials(env_file)
        acr_reg = creds.get("ACR_REGISTRY", "quadientdistribution.azurecr.io")
        lic_server = creds.get("CX_LIC_SERVER", "")

        # 1. Start postgres
        report(1, "Iniciando PostgreSQL")
        ok, msg = DockerService.compose_up(compose_file, env_file, project_name, services=["postgres"])
        if not ok:
            return False, f"Error iniciando PostgreSQL: {msg}"

        # Wait for PostgreSQL to become healthy
        pg_container = f"{project_name}-postgres"
        healthy = False
        for _ in range(30):
            code, out, _ = DockerService._run_cmd(f"docker inspect --format='{{{{.State.Health.Status}}}}' {pg_container}")
            if code == 0 and out.strip() == "healthy":
                healthy = True
                break
            time.sleep(1)

        if not healthy:
            return False, "PostgreSQL no alcanzó estado saludable a tiempo."

        # 1.1 Ensure databases exist in PostgreSQL (idempotently)
        init_sql = (
            "SELECT 'CREATE DATABASE scaler_db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'scaler_db')\\gexec\n"
            "SELECT 'CREATE DATABASE icm_db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'icm_db')\\gexec\n"
            "SELECT 'CREATE DATABASE interactive_db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'interactive_db')\\gexec\n"
            "GRANT ALL PRIVILEGES ON DATABASE scaler_db TO scaler;\n"
            "GRANT ALL PRIVILEGES ON DATABASE icm_db TO scaler;\n"
            "GRANT ALL PRIVILEGES ON DATABASE interactive_db TO scaler;\n"
        )
        DockerService._run_cmd(f"docker exec -i {pg_container} psql -U scaler -d postgres", input_data=init_sql)

        # 1.2 Populate Demo Mode volume if enabled
        if target.get("demo_mode"):
            ok_demo, msg_demo = self._ensure_demo_mode_volume(target)
            if not ok_demo:
                return False, msg_demo

        # 2. Insert admin 'system' into ICM
        report(2, "Creando usuario administrador en ICM")
        net_name = f"{project_name}_default"
        insert_cmd = (
            f"docker run --rm --network {net_name} "
            f"-e CX_LICENSE=cl -e {shlex.quote('CX_LIC_SERVER=' + lic_server)} "
            f"-e DB_TYPE=PostgreSQL -e DB_HOST=postgres -e DB_PORT=5432 "
            f"-e DB_NAME=icm_db -e DB_USER=scaler -e DB_PASS=scalerpassword123 "
            f"-e ADD_PARAMS='-insertadminname system -insertadminpassword Password12345*' "
            f"{shlex.quote(f'{acr_reg}/flex/icm:{version}')} InspireICM"
        )
        DockerService._run_cmd(insert_cmd, timeout=60)

        # 3. Start ICM service
        report(3, "Iniciando ICM")
        ok, msg = DockerService.compose_up(compose_file, env_file, project_name, services=["icm"])
        if not ok:
            return False, f"Error iniciando ICM: {msg}"

        # Wait for ICM container to be in running state
        icm_container = f"{project_name}-icm"
        for _ in range(20):
            code, out, _ = DockerService._run_cmd(f"docker inspect --format='{{{{.State.Running}}}}' {icm_container}")
            if code == 0 and out.strip() == "true":
                break
            time.sleep(1)

        # Give ICM a few seconds to initialize
        time.sleep(6)

        # 4. Grant impersonation permissions via grant_impersonation.java
        report(4, "Asignando permisos en ICM")
        grant_script = os.path.join(self.base_dir, "grant_impersonation.java")
        if os.path.exists(grant_script):
            with open(grant_script, "r", encoding="utf-8") as f:
                java_code = f.read()
            grant_cmd = (
                f"docker run -i --rm --network {net_name} "
                f"--entrypoint /bin/bash {shlex.quote(f'{acr_reg}/flex/scaler:{version}')} "
                f"-c \"cat > /tmp/grant_impersonation.java && java -cp '/opt/InspireScalerInstaller/lib/*:/opt/InspireScalerInstaller/scaler-conductor.jar' "
                f"/tmp/grant_impersonation.java icm 30353 system 'Password12345*'\""
            )
            granted = False
            err_msg = ""
            for attempt in range(5):
                code, out, err = DockerService._run_cmd(grant_cmd, timeout=60, input_data=java_code)
                if code == 0:
                    granted = True
                    break
                err_msg = err or out
                time.sleep(3)
            if not granted:
                return False, f"Error al asignar permisos a usuario 'system' en ICM: {err_msg}"

        # 5. Run scaler-prepare (if scaler is enabled)
        if target.get("enable_scaler", True):
            report(5, "Preparando bases de datos de Scaler (puede tardar varios minutos)")
            ok, msg = DockerService.compose_up(compose_file, env_file, project_name, services=["scaler-prepare"])
            if not ok:
                return False, f"Error iniciando scaler-prepare: {msg}"

            # Wait for scaler-prepare to complete
            scaler_prep_container = f"{project_name}-scaler-prepare"
            prep_success = False
            for _ in range(120):
                code, out, _ = DockerService._run_cmd(f"docker inspect --format='{{{{.State.Status}}}}:{{{{.State.ExitCode}}}}' {scaler_prep_container}")
                if code == 0:
                    parts = out.strip().split(":")
                    status = parts[0]
                    exit_code = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else -1
                    if status == "exited":
                        if exit_code == 0:
                            prep_success = True
                            break
                        else:
                            prep_logs = DockerService.container_logs(scaler_prep_container, tail=50)
                            return False, f"scaler-prepare falló con código {exit_code}: {prep_logs}"
                time.sleep(2)

            if not prep_success:
                return False, "scaler-prepare no completó en el tiempo esperado (timeout)."

        return True, "Ambiente inicializado correctamente"

    def _render_compose_template(
        self,
        env_id: str,
        project_name: str,
        ports: Dict[str, int],
        version: str,
        demo_mode: bool = False,
        target_dir: Optional[str] = None,
        custom_storage_dir: Optional[str] = None,
        enable_interactive: bool = True,
        enable_scaler: bool = True,
        scaler_sharedfolder: str = "",
        scaler_jobs_dir: str = "",
        enable_kafka: bool = False,
        enable_inbox: bool = False,
        enable_ftp: bool = False
    ) -> str:
        """Renders isolated docker-compose.yml for an environment sandbox with explicit named volumes."""
        p_inter = ports.get("interactive", 30701)
        p_scaler = ports.get("scaler", 30600)
        p_scaler_ips = ports.get("scaler_ips", 30354)
        p_icm = ports.get("icm", 30353)
        p_pg = ports.get("postgres", 5432)
        p_kafka = ports.get("kafka", 9092)
        p_csv_studio = ports.get("csv_studio", 8081)
        p_inbox = ports.get("inbox", 3000)
        p_ftp = ports.get("ftp", 2121)
        p_ftp_pasv_min = ports.get("ftp_pasv_min", 21100)
        p_ftp_pasv_max = ports.get("ftp_pasv_max", 21105)

        # Build services section
        services = []

        # 1. PostgreSQL (Mandatory)
        services.append(f"""  postgres:
    image: postgres:15-alpine
    container_name: {project_name}-postgres
    environment:
      POSTGRES_DB: postgres
      POSTGRES_USER: scaler
      POSTGRES_PASSWORD: scalerpassword123
    ports:
      - "{p_pg}:5432"
    volumes:
      - pgdata_{env_id}:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U scaler -d postgres"]
      interval: 3s
      timeout: 3s
      retries: 10""")

        # 2. ICM (Mandatory)
        services.append(f"""  icm:
    image: ${{ACR_REGISTRY:-quadientdistribution.azurecr.io}}/flex/icm:${{INSPIRE_VERSION:-{version}}}
    container_name: {project_name}-icm
    depends_on:
      postgres:
        condition: service_healthy
    env_file:
      - .env
    environment:
      CX_LICENSE: cl
      DB_TYPE: PostgreSQL
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: icm_db
      DB_USER: scaler
      DB_PASS: scalerpassword123
    ports:
      - "{p_icm}:30353"
    volumes:
      - icmdata_{env_id}:/opt/Quadient/Inspire-Designer-data/icm""")

        # 3. Scaler Stack (Optional)
        if enable_scaler:
            services.append(f"""  scaler-prepare:
    image: ${{ACR_REGISTRY:-quadientdistribution.azurecr.io}}/flex/scaler:${{INSPIRE_VERSION:-{version}}}
    container_name: {project_name}-scaler-prepare
    restart: "no"
    depends_on:
      postgres:
        condition: service_healthy
      icm:
        condition: service_started
    env_file:
      - .env
    environment:
      TYPE: prepare
      DB_TYPE: postgresql
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: scaler_db
      DB_USER: scaler
      DB_PASS: scalerpassword123
      ICM_HOST: icm
      ICM_PORT: 30353
      ICM_USER: system
      ICM_PASS: "Password12345*"
      ICM_API_AUTHENTICATION_GROUP: "Administrators"
      CX_LICENSE: cl

  scaler:
    image: ${{ACR_REGISTRY:-quadientdistribution.azurecr.io}}/flex/scaler:${{INSPIRE_VERSION:-{version}}}
    container_name: {project_name}-scaler
    depends_on:
      scaler-prepare:
        condition: service_completed_successfully
      postgres:
        condition: service_healthy
      icm:
        condition: service_started
    env_file:
      - .env
    environment:
      TYPE: run
      DB_TYPE: postgresql
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: scaler_db
      DB_USER: scaler
      DB_PASS: scalerpassword123
      ICM_HOST: icm
      ICM_PORT: 30353
      ICM_USER: system
      ICM_PASS: "Password12345*"
      CX_LICENSE: cl
    ports:
      - "{p_scaler}:30600"
      - "{p_scaler_ips}:30354"
    volumes:
      - sharedfolder_{env_id}:/sharedfolder
      - jobsdir_{env_id}:/opt/scalerSharedFolder

  ips:
    image: ${{ACR_REGISTRY:-quadientdistribution.azurecr.io}}/flex/ips:${{INSPIRE_VERSION:-{version}}}
    container_name: {project_name}-ips
    network_mode: "service:scaler"
    depends_on:
      - scaler
    volumes:
      - sharedfolder_{env_id}:/sharedfolder
    env_file:
      - .env
    environment:
      CX_LICENSE: cl
      ICM_HOST: icm
      ICM_PORT: 30353
      ICM_USER: system
      ICM_PASS: "Password12345*" """)

        # 4. Interactive Stack (Optional)
        if enable_interactive:
            interactive_volumes = [
                f"filestore_{env_id}:/opt/QuadientInteractive/stores/filestore/workingDirectory"
            ]
            if demo_mode:
                interactive_volumes.append(f"demomode_{env_id}:/opt/QuadientInteractive/config/demo-mode:ro")
            interactive_volumes_block = "    volumes:\n" + "\n".join(f"      - {v}" for v in interactive_volumes)

            scaler_dep_str = "\n      scaler:\n        condition: service_started" if enable_scaler else ""
            scaler_prep_env = '      SCALER_URL: "http://scaler:30600"\n      SCALER_USER: system\n      SCALER_PASS: "Password12345*"' if enable_scaler else '      SCALER_URL: ""'
            scaler_run_env = '      SCALER_URL: "http://scaler:30600"\n      SCALER_USER: system\n      SCALER_PASS: "Password12345*"' if enable_scaler else '      SCALER_URL: ""'

            services.append(f"""  interactive-prepare:
    image: ${{ACR_REGISTRY:-quadientdistribution.azurecr.io}}/flex/interactive:${{INSPIRE_VERSION:-{version}}}
    container_name: {project_name}-interactive-prepare
    restart: "no"
    depends_on:
      postgres:
        condition: service_healthy
      icm:
        condition: service_started{scaler_dep_str}
    env_file:
      - .env
    environment:
      TYPE: setup
      EULA_ACCEPTED: "true"
      PRODUCTION_ENVIRONMENT: "false"
      CX_LICENSE: cl
      USE_HTTP: "true"
      APPLICATION_URL: "http://localhost:{p_inter}/interactive"
      ICM_ROOT: "icm://Interactive/"
      ICM_PORT: 30353
      ICM_HOST: icm
      ICM_HOST_SECOND: icm
      ICM_PORT_SECOND: 30353
      ICM_HOST2: icm
      ICM_PORT2: 30353
      ICM_USER: system
      ICM_PASS: "Password12345*"
      GROO_ICM_USER: system
      GROO_ICM_PASS: "Password12345*"
      IPS_HOST: localhost
      IPS_PORT: 30354
      DB_TYPE: POSTGRESQL
      DB_NAME: interactive_db
      DB_HOST: postgres
      DB_PORT: 5432
      DB_USER: scaler
      DB_PASS: scalerpassword123
{scaler_prep_env}

  interactive:
    image: ${{ACR_REGISTRY:-quadientdistribution.azurecr.io}}/flex/interactive:${{INSPIRE_VERSION:-{version}}}
    container_name: {project_name}-interactive
    hostname: {project_name}-interactive
    extra_hosts:
      - "{project_name}-interactive:127.0.0.1"
    user: "0:0"
    depends_on:
      interactive-prepare:
        condition: service_completed_successfully
      postgres:
        condition: service_healthy
      icm:
        condition: service_started{scaler_dep_str}
    env_file:
      - .env
    environment:
      TYPE: run
      EULA_ACCEPTED: "true"
      CX_LICENSE: cl
      ICM_HOST: icm
      ICM_PORT: 30353
      ICM_HOST_SECOND: icm
      ICM_PORT_SECOND: 30353
      ICM_HOST2: icm
      ICM_PORT2: 30353
      ICM_USER: system
      ICM_PASS: "Password12345*"
      GROO_ICM_USER: system
      GROO_ICM_PASS: "Password12345*"
      ICM_ROOT: "icm://Interactive/"
      DB_TYPE: PostgreSql
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: interactive_db
      DB_USER: scaler
      DB_PASS: scalerpassword123
{scaler_run_env}
      IPS_HOST: localhost
      IPS_PORT: 30354
      APPLICATION_URL: "http://localhost:{p_inter}/interactive"
    ports:
      - "{p_inter}:30701"
{interactive_volumes_block}

  interactive-ips:
    image: ${{ACR_REGISTRY:-quadientdistribution.azurecr.io}}/flex/ips:${{INSPIRE_VERSION:-{version}}}
    container_name: {project_name}-interactive-ips
    network_mode: "service:interactive"
    user: "0:0"
    depends_on:
      - interactive
    volumes:
      - filestore_{env_id}:/opt/QuadientInteractive/stores/filestore/workingDirectory
    env_file:
      - .env
    environment:
      CX_LICENSE: cl
      ICM_HOST: icm
      ICM_PORT: 30353
      ICM_USER: system
      ICM_PASS: "Password12345*" """)

        # 5. Kafka Stack (Optional)
        if enable_kafka:
            # Not published to any registry: compose builds it from the bundled sources
            producer_dir = os.path.join(self.base_dir, "producer")
            services.append(f"""  kafka:
    image: apache/kafka:latest
    container_name: {project_name}-kafka
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093,EXTERNAL://0.0.0.0:29092
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092,EXTERNAL://localhost:{p_kafka}
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,EXTERNAL:PLAINTEXT
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@localhost:9093
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
      KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: 0
      KAFKA_NUM_PARTITIONS: 1
    ports:
      - "{p_kafka}:29092"

  kafka-csv-studio:
    image: kafka-csv-producer:latest
    build:
      context: "{producer_dir}"
    container_name: {project_name}-kafka-csv-studio
    depends_on:
      - kafka
    environment:
      PORT: 8080
      KAFKA_BOOTSTRAP_SERVERS: "kafka:9092"
      KAFKA_HOST: "kafka"
      KAFKA_PORT: "9092"
    ports:
      - "{p_csv_studio}:8080" """)

        # 6. Push Notifications Inbox (Optional)
        if enable_inbox:
            # Firebase credentials travel in a side env file so they never land in the compose file
            if target_dir:
                self._write_inbox_env(target_dir)
            inbox_dir = os.path.join(self.base_dir, "inbox")
            services.append(f"""  push-inbox:
    image: push-inbox:latest
    build:
      context: "{inbox_dir}"
    container_name: {project_name}-push-inbox
    env_file:
      - inbox.env
    environment:
      PORT: 3000
    ports:
      - "{p_inbox}:3000" """)

        # 7. FTP Server (Optional)
        if enable_ftp:
            services.append(f"""  ftp:
    image: fauria/vsftpd:latest
    container_name: {project_name}-ftp
    environment:
      FTP_USER: system
      FTP_PASS: "Password12345*"
      PASV_MIN_PORT: {p_ftp_pasv_min}
      PASV_MAX_PORT: {p_ftp_pasv_max}
      PASV_MIN: {p_ftp_pasv_min}
      PASV_MAX: {p_ftp_pasv_max}
      PASV_ENABLE: "YES"
      PASV_ADDRESS: ${{FTP_PASV_ADDRESS:-127.0.0.1}}
      PASV_PROMISCUOUS: "YES"
      PORT_PROMISCUOUS: "YES"
      REVERSE_LOOKUP_ENABLE: "NO"
    ports:
      - "0.0.0.0:{p_ftp}:21"
      - "0.0.0.0:{p_ftp_pasv_min}-{p_ftp_pasv_max}:{p_ftp_pasv_min}-{p_ftp_pasv_max}"
    volumes:
      - ftpdata_{env_id}:/home/vsftpd/system""")

        # Volumes section
        vol_lines = ["volumes:"]
        if custom_storage_dir:
            vol_lines.append(f"""  pgdata_{env_id}:
    name: {project_name}_pgdata_{env_id}
    driver: local
    driver_opts:
      type: none
      o: bind
      device: "{custom_storage_dir}/pgdata"
  icmdata_{env_id}:
    name: {project_name}_icmdata_{env_id}
    driver: local
    driver_opts:
      type: none
      o: bind
      device: "{custom_storage_dir}/icmdata" """)
            if enable_interactive:
                vol_lines.append(f"""  filestore_{env_id}:
    name: {project_name}_filestore_{env_id}
    driver: local
    driver_opts:
      type: none
      o: bind
      device: "{custom_storage_dir}/filestore" """)
                if demo_mode:
                    vol_lines.append(f"""  demomode_{env_id}:
    name: {project_name}_demomode_{env_id}
    driver: local
    driver_opts:
      type: none
      o: bind
      device: "{custom_storage_dir}/demomode" """)
            if enable_scaler:
                share_target = scaler_sharedfolder if scaler_sharedfolder else f"{custom_storage_dir}/sharedfolder"
                vol_lines.append(f"""  sharedfolder_{env_id}:
    name: {project_name}_sharedfolder_{env_id}
    driver: local
    driver_opts:
      type: none
      o: bind
      device: "{share_target}" """)
                jobs_target = scaler_jobs_dir if scaler_jobs_dir else f"{custom_storage_dir}/jobsdir"
                vol_lines.append(f"""  jobsdir_{env_id}:
    name: {project_name}_jobsdir_{env_id}
    driver: local
    driver_opts:
      type: none
      o: bind
      device: "{jobs_target}" """)
            if enable_ftp:
                vol_lines.append(f"""  ftpdata_{env_id}:
    name: {project_name}_ftpdata_{env_id}""")
        else:
            vol_lines.append(f"""  pgdata_{env_id}:
    name: {project_name}_pgdata_{env_id}
  icmdata_{env_id}:
    name: {project_name}_icmdata_{env_id}""")
            if enable_interactive:
                vol_lines.append(f"""  filestore_{env_id}:
    name: {project_name}_filestore_{env_id}""")
                if demo_mode:
                    vol_lines.append(f"""  demomode_{env_id}:
    name: {project_name}_demomode_{env_id}""")
            if enable_scaler:
                if scaler_sharedfolder:
                    vol_lines.append(f"""  sharedfolder_{env_id}:
    name: {project_name}_sharedfolder_{env_id}
    driver: local
    driver_opts:
      type: none
      o: bind
      device: "{scaler_sharedfolder}" """)
                else:
                    vol_lines.append(f"""  sharedfolder_{env_id}:
    name: {project_name}_sharedfolder_{env_id}""")

                if scaler_jobs_dir:
                    vol_lines.append(f"""  jobsdir_{env_id}:
    name: {project_name}_jobsdir_{env_id}
    driver: local
    driver_opts:
      type: none
      o: bind
      device: "{scaler_jobs_dir}" """)
                else:
                    vol_lines.append(f"""  jobsdir_{env_id}:
    name: {project_name}_jobsdir_{env_id}""")
            if enable_ftp:
                vol_lines.append(f"""  ftpdata_{env_id}:
    name: {project_name}_ftpdata_{env_id}""")

        # Native Docker on SELinux hosts (Fedora/RHEL) blocks access to bind-mounted
        # host folders; disable labeling like the manager itself does.
        services = [
            re.sub(r"^(    container_name: .*)$", r"\1\n    security_opt:\n      - label=disable", s, flags=re.M)
            for s in services
        ]

        return "services:\n" + "\n\n".join(services) + "\n\n" + "\n".join(vol_lines) + "\n"
