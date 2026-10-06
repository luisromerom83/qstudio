"""
Environment Service
Manages Demo & PoC Sandboxes organized by industry verticals.
"""
import os
import json
import re
import shutil
from datetime import datetime
import time
import socket
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

class EnvService:
    def __init__(self, base_dir: str):
        self.base_dir = os.path.abspath(base_dir)
        self.data_dir = os.path.join(self.base_dir, "manager", "data")
        self.envs_file = os.path.join(self.data_dir, "environments.json")
        self.envs_dir = os.path.join(self.base_dir, "manager", "environments")
        self.root_compose = os.path.join(self.base_dir, "docker-compose.yml")
        self.root_env = os.path.join(self.data_dir, ".quadient_credentials.env")
        if not os.path.exists(self.root_env) and os.path.exists(os.path.join(self.base_dir, ".quadient_credentials.env")):
            self.root_env = os.path.join(self.base_dir, ".quadient_credentials.env")
        os.makedirs(self.data_dir, exist_ok=True)
        os.makedirs(self.envs_dir, exist_ok=True)
        self._ensure_default_env()

    def _ensure_default_env(self):
        """Ensures the initial/current environment is registered and self-contained."""
        envs = self.list_environments()
        default_target = None
        for e in envs:
            if e.get("id") == "default":
                default_target = e
                break

        target_dir = os.path.join(self.envs_dir, "default")
        compose_file = os.path.join(target_dir, "docker-compose.yml")
        env_file = os.path.join(target_dir, ".env")
        demo_mode_dir = os.path.join(target_dir, "demo-mode")

        ports = {
            "interactive": 30701,
            "scaler": 30600,
            "scaler_ips": 30354,
            "icm": 30353,
            "postgres": 5432,
            "csv_studio": 8080
        }
        project_name = "flex-default"
        version = "17.5-latest"

        # If not existing or pointing to old root compose, create clean isolated environment
        needs_creation = (
            default_target is None or
            not os.path.exists(compose_file) or
            "kafka-csv-producer" in default_target.get("project_name", "") or
            "kafka-csv-producer" in default_target.get("compose_file", "") or
            not default_target.get("demo_mode")
        )

        if needs_creation:
            os.makedirs(target_dir, exist_ok=True)

            # Copy demo-mode assets for default
            demo_mode_src = os.path.join(self.base_dir, "Inspire", "demo-mode")
            if not os.path.exists(demo_mode_src):
                demo_mode_src = os.path.join(self.base_dir, "demo-mode")

            if os.path.exists(demo_mode_src) and not os.path.exists(demo_mode_dir):
                shutil.copytree(demo_mode_src, demo_mode_dir)

            # Generate compose file
            compose_content = self._render_compose_template(
                "default", project_name, ports, version, demo_mode=True, target_dir=target_dir
            )
            with open(compose_file, "w", encoding="utf-8") as f:
                f.write(compose_content)

            # Copy credentials if available
            root_creds = ACRService.get_credentials(self.root_env)
            root_creds["INSPIRE_VERSION"] = version
            ACRService.save_credentials(env_file, root_creds)

            new_default = {
                "id": "default",
                "name": "Demo Base / General",
                "vertical": "Seguros",
                "vertical_id": "insurance",
                "description": "Ambiente de demostración base con Inspire Interactive, Scaler, ICM, IPS y PostgreSQL.",
                "version": version,
                "demo_mode": True,
                "project_name": project_name,
                "compose_file": compose_file,
                "env_file": env_file,
                "ports": ports,
                "volumes": {
                    "pgdata": f"{project_name}_pgdata_default",
                    "icmdata": f"{project_name}_icmdata_default",
                    "filestore": f"{project_name}_filestore_default",
                    "demomode": f"{project_name}_demomode_default"
                },
                "is_default": True,
                "initialized": False,
                "created_at": datetime.now().isoformat(),
                "last_active": datetime.now().isoformat()
            }

            if default_target:
                envs = [new_default if e.get("id") == "default" else e for e in envs]
            else:
                envs.insert(0, new_default)
            self._save_environments(envs)

    def list_environments(self) -> List[Dict[str, Any]]:
        if os.path.exists(self.envs_file):
            try:
                with open(self.envs_file, "r", encoding="utf-8") as f:
                    envs = json.load(f)

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
                    env["containers"] = containers
                    running_count = sum(1 for c in containers if c.get("state") == "running")
                    total_count = len(containers)
                    if running_count > 0:
                        env["status"] = "running" if running_count >= 3 else "partial"
                    else:
                        env["status"] = "stopped"
                    env["active_containers"] = running_count
                    env["total_containers"] = total_count

                if changed:
                    self._save_environments(envs)

                return envs
            except Exception:
                pass
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
            clean_envs.append(item)
        with open(self.envs_file, "w", encoding="utf-8") as f:
            json.dump(clean_envs, f, indent=2, ensure_ascii=False)

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
                "csv_studio": 8081 + (offset % 50) if (8081 + (offset % 50)) != 8090 else 8091
            }
            if not any(p in used_ports for p in candidate_ports.values()):
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

        envs = self.list_environments()
        if any(e["id"] == env_id for e in envs):
            env_id = f"{env_id}-{int(datetime.now().timestamp()) % 1000}"

        vertical = data.get("vertical", "Seguros")
        vertical_id = data.get("vertical_id", "insurance")
        description = data.get("description", "")
        version = data.get("version", "17.5-latest")

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
                    "csv_studio": 8081 + (offset % 50) if (8081 + (offset % 50)) != 8090 else 8091
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
            env_id, project_name, ports, version, demo_mode=demo_mode, target_dir=target_dir
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
            "project_name": project_name,
            "compose_file": compose_file,
            "env_file": env_file,
            "ports": ports,
            "volumes": {
                "pgdata": f"{project_name}_pgdata_{env_id}",
                "icmdata": f"{project_name}_icmdata_{env_id}",
                "filestore": f"{project_name}_filestore_{env_id}",
                **({"demomode": f"{project_name}_demomode_{env_id}"} if demo_mode else {})
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
            new_ver = data["version"]
            target["version"] = new_ver
            # Update .env in environment directory
            if os.path.exists(target["env_file"]):
                creds = ACRService.get_credentials(target["env_file"])
                creds["INSPIRE_VERSION"] = new_ver
                ACRService.save_credentials(target["env_file"], creds)

        if "demo_mode" in data:
            new_demo = bool(data["demo_mode"])
            target["demo_mode"] = new_demo
            # Update volumes dictionary
            if new_demo:
                target["volumes"]["demomode"] = f"{target['project_name']}_demomode_{env_id}"
            else:
                target["volumes"].pop("demomode", None)

            # Re-render compose template
            compose_content = self._render_compose_template(
                env_id, target["project_name"], target["ports"], target.get("version", "17.5-latest"),
                demo_mode=new_demo, target_dir=os.path.dirname(target["compose_file"])
            )
            with open(target["compose_file"], "w", encoding="utf-8") as f:
                f.write(compose_content)

        self._save_environments(envs)
        return True, "Ambiente actualizado correctamente"

    def delete_environment(self, env_id: str, remove_volumes: bool = False) -> Tuple[bool, str]:
        if env_id == "default":
            return False, "No se puede eliminar el ambiente base predeterminado"
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
            for vol_type in ["pgdata", "icmdata", "filestore", "demomode"]:
                DockerService._run_cmd(f"docker volume rm '{project_name}_{vol_type}_{env_id}'")

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
        DockerService._run_cmd(f"docker volume create '{vol_name}'")

        # Copy files into volume and ensure read permissions
        copy_cmd = (
            f"tar -C '{demo_src}' -cf - . | "
            f"docker run --rm -i -v '{vol_name}:/target' postgres:15-alpine "
            f"sh -c 'tar -C /target -xf - && chmod -R a+rX /target'"
        )
        code, out, err = DockerService._run_cmd(copy_cmd, timeout=30)
        if code != 0:
            return False, f"Error al inicializar volumen de demo-mode: {err or out}"
        return True, "Volumen demo-mode configurado correctamente"

    def activate_demo(self, env_id: str, exclusive: bool = True) -> Tuple[bool, str]:
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

        stopped_others = []
        if exclusive:
            for other in envs:
                if other["id"] != env_id and other.get("status") == "running":
                    DockerService.compose_stop(other["compose_file"], other["project_name"])
                    stopped_others.append(other["name"])

        # Always ensure demo mode volume is populated before startup if enabled
        if target.get("demo_mode"):
            self._ensure_demo_mode_volume(target)

        # Check if environment needs initialization (new sandbox or uninitialized ICM)
        if not target.get("initialized"):
            ok_init, msg_init = self._initialize_environment(target)
            if not ok_init:
                return False, f"Fallo al inicializar el ambiente: {msg_init}"
            target["initialized"] = True
            self._save_environments(envs)

        # Start target environment
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

    def _initialize_environment(self, target: Dict[str, Any]) -> Tuple[bool, str]:
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

        creds = ACRService.get_credentials(env_file)
        acr_reg = creds.get("ACR_REGISTRY", "quadientdistribution.azurecr.io")
        lic_server = creds.get("CX_LIC_SERVER", "")

        # 1. Start postgres
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
        net_name = f"{project_name}_default"
        insert_cmd = (
            f"docker run --rm --network {net_name} "
            f"-e CX_LICENSE=cl -e CX_LIC_SERVER='{lic_server}' "
            f"-e DB_TYPE=PostgreSQL -e DB_HOST=postgres -e DB_PORT=5432 "
            f"-e DB_NAME=icm_db -e DB_USER=scaler -e DB_PASS=scalerpassword123 "
            f"-e ADD_PARAMS='-insertadminname system -insertadminpassword Password12345*' "
            f"{acr_reg}/flex/icm:{version} InspireICM"
        )
        DockerService._run_cmd(insert_cmd, timeout=60)

        # 3. Start ICM service
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
        grant_script = os.path.join(self.base_dir, "grant_impersonation.java")
        if os.path.exists(grant_script):
            with open(grant_script, "r", encoding="utf-8") as f:
                java_code = f.read()
            grant_cmd = (
                f"docker run -i --rm --network {net_name} "
                f"--entrypoint /bin/bash {acr_reg}/flex/scaler:{version} "
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

        # 5. Run scaler-prepare
        ok, msg = DockerService.compose_up(compose_file, env_file, project_name, services=["scaler-prepare"])
        if not ok:
            return False, f"Error iniciando scaler-prepare: {msg}"

        # Wait for scaler-prepare to complete
        scaler_prep_container = f"{project_name}-scaler-prepare"
        prep_success = False
        for _ in range(60):
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

    def _render_compose_template(self, env_id: str, project_name: str, ports: Dict[str, int], version: str, demo_mode: bool = False, target_dir: Optional[str] = None) -> str:
        """Renders isolated docker-compose.yml for an environment sandbox with explicit named volumes."""
        p_inter = ports.get("interactive", 30701)
        p_scaler = ports.get("scaler", 30600)
        p_scaler_ips = ports.get("scaler_ips", 30354)
        p_icm = ports.get("icm", 30353)
        p_pg = ports.get("postgres", 5432)

        interactive_volumes = [
            f"filestore_{env_id}:/opt/QuadientInteractive/stores/filestore/workingDirectory"
        ]
        if demo_mode:
            interactive_volumes.append(f"demomode_{env_id}:/opt/QuadientInteractive/config/demo-mode:ro")
        interactive_volumes_block = "    volumes:\n" + "\n".join(f"      - {v}" for v in interactive_volumes) + "\n"

        demo_named_vol = f"  demomode_{env_id}:\n    name: {project_name}_demomode_{env_id}\n" if demo_mode else ""

        template = f"""services:
  postgres:
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
      retries: 10

  icm:
    image: ${{ACR_REGISTRY:-quadientdistribution.azurecr.io}}/flex/icm:${{INSPIRE_VERSION:-{version}}}
    container_name: {project_name}-icm
    depends_on:
      postgres:
        condition: service_healthy
    env_file:
      - .env
    environment:
      CX_LICENSE: cl
      CX_LIC_SERVER: ${{CX_LIC_SERVER}}
      DB_TYPE: PostgreSQL
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: icm_db
      DB_USER: scaler
      DB_PASS: scalerpassword123
    ports:
      - "{p_icm}:30353"
    volumes:
      - icmdata_{env_id}:/opt/Quadient/Inspire-Designer-data/icm

  scaler-prepare:
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
      CX_LIC_SERVER: ${{CX_LIC_SERVER}}

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
      CX_LIC_SERVER: ${{CX_LIC_SERVER}}
    ports:
      - "{p_scaler}:30600"
      - "{p_scaler_ips}:30354"

  ips:
    image: ${{ACR_REGISTRY:-quadientdistribution.azurecr.io}}/flex/ips:${{INSPIRE_VERSION:-{version}}}
    container_name: {project_name}-ips
    network_mode: "service:scaler"
    depends_on:
      - scaler
    env_file:
      - .env
    environment:
      CX_LICENSE: cl
      CX_LIC_SERVER: ${{CX_LIC_SERVER}}
      ICM_HOST: icm
      ICM_PORT: 30353
      ICM_USER: system
      ICM_PASS: "Password12345*"

  interactive-prepare:
    image: ${{ACR_REGISTRY:-quadientdistribution.azurecr.io}}/flex/interactive:${{INSPIRE_VERSION:-{version}}}
    container_name: {project_name}-interactive-prepare
    restart: "no"
    depends_on:
      postgres:
        condition: service_healthy
      icm:
        condition: service_started
      scaler:
        condition: service_started
    env_file:
      - .env
    environment:
      TYPE: setup
      EULA_ACCEPTED: "true"
      PRODUCTION_ENVIRONMENT: "false"
      CX_LICENSE: cl
      CX_LIC_SERVER: ${{CX_LIC_SERVER}}
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
      SCALER_URL: "http://scaler:30600"
      SCALER_USER: system
      SCALER_PASS: "Password12345*"

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
        condition: service_started
      scaler:
        condition: service_started
    env_file:
      - .env
    environment:
      TYPE: run
      EULA_ACCEPTED: "true"
      CX_LICENSE: cl
      CX_LIC_SERVER: ${{CX_LIC_SERVER}}
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
      SCALER_URL: "http://scaler:30600"
      SCALER_USER: system
      SCALER_PASS: "Password12345*"
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
      CX_LIC_SERVER: ${{CX_LIC_SERVER}}
      ICM_HOST: icm
      ICM_PORT: 30353
      ICM_USER: system
      ICM_PASS: "Password12345*"

volumes:
  pgdata_{env_id}:
    name: {project_name}_pgdata_{env_id}
  icmdata_{env_id}:
    name: {project_name}_icmdata_{env_id}
  filestore_{env_id}:
    name: {project_name}_filestore_{env_id}
{demo_named_vol}"""
        return template
