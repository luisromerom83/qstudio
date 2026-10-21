"""
Docker & Docker Compose Service
Handles container lifecycle, healthchecks, stats and logs.
"""
import subprocess
import json
import os
import shlex
from typing import Dict, List, Optional, Any, Tuple

class DockerService:
    # Whether docker commands must be wrapped in 'sg docker' (resolved once per process)
    _use_sg: Optional[bool] = None

    @classmethod
    def _needs_sg(cls) -> bool:
        if cls._use_sg is None:
            try:
                res = subprocess.run(["docker", "info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
                use_sg = res.returncode != 0
            except Exception:
                use_sg = True
            if not use_sg:
                # Only cache success; a failing daemon may come back later
                cls._use_sg = False
            return use_sg
        return cls._use_sg

    @classmethod
    def _run_cmd(cls, cmd: str, timeout: int = 60, cwd: Optional[str] = None, input_data: Optional[str] = None) -> Tuple[int, str, str]:
        """Runs a shell command, automatically wrapping in 'sg docker -c' if required.
        Any user-supplied value interpolated into `cmd` MUST be escaped with shlex.quote."""
        if cls._needs_sg():
            full_cmd = ["sg", "docker", "-c", cmd]
        else:
            full_cmd = ["bash", "-c", cmd]

        try:
            proc = subprocess.run(
                full_cmd,
                input=input_data,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=timeout,
                cwd=cwd
            )
            return proc.returncode, proc.stdout.strip(), proc.stderr.strip()
        except subprocess.TimeoutExpired:
            return -1, "", "Comando excedió el tiempo límite (timeout)"
        except Exception as e:
            return -1, "", str(e)

    @classmethod
    def test_docker_available(cls) -> Tuple[bool, str]:
        code, out, err = cls._run_cmd("docker version --format '{{.Server.Version}}'")
        if code == 0:
            return True, f"Docker Engine {out} conectado"
        return False, f"No se pudo conectar al daemon de Docker: {err}"

    @classmethod
    def get_all_bound_ports(cls) -> set:
        """Returns set of all host ports currently bound by Docker containers."""
        code, out, _ = cls._run_cmd("docker ps --format '{{.Ports}}'")
        ports = set()
        if code == 0 and out:
            import re
            for m in re.finditer(r":(\d+)->", out):
                try:
                    ports.add(int(m.group(1)))
                except ValueError:
                    pass
        return ports

    @classmethod
    def get_compose_projects(cls) -> List[Dict[str, Any]]:
        """Returns list of running or stopped compose projects."""
        code, out, _ = cls._run_cmd("docker compose ls --all --format json")
        if code == 0 and out:
            try:
                return json.loads(out)
            except Exception:
                pass
        return []

    @classmethod
    def get_containers_for_project(cls, project_name: str) -> List[Dict[str, Any]]:
        """Lists containers belonging to a specific compose project."""
        cmd = f"docker ps -a --filter {shlex.quote('label=com.docker.compose.project=' + project_name)} --format '{{{{json .}}}}'"
        code, out, _ = cls._run_cmd(cmd)
        containers = []
        if code == 0 and out:
            for line in out.splitlines():
                line = line.strip()
                if line:
                    try:
                        c = json.loads(line)
                        containers.append({
                            "id": c.get("ID", ""),
                            "name": c.get("Names", ""),
                            "service": c.get("Labels", "").split("com.docker.compose.service=")[-1].split(",")[0] if "com.docker.compose.service=" in c.get("Labels", "") else c.get("Names", ""),
                            "image": c.get("Image", ""),
                            "status": c.get("Status", ""),
                            "state": c.get("State", ""),
                            "ports": c.get("Ports", ""),
                            "created": c.get("CreatedAt", "")
                        })
                    except Exception:
                        pass
        return containers

    @classmethod
    def get_container_stats(cls, container_id_or_name: str) -> Dict[str, str]:
        """Gets CPU and Memory usage for a running container."""
        cmd = f"docker stats --no-stream --format '{{{{json .}}}}' {shlex.quote(container_id_or_name)}"
        code, out, _ = cls._run_cmd(cmd, timeout=5)
        if code == 0 and out:
            try:
                data = json.loads(out)
                return {
                    "cpu": data.get("CPUPerc", "0%"),
                    "memory": data.get("MemUsage", "0B / 0B")
                }
            except Exception:
                pass
        return {"cpu": "--", "memory": "--"}

    @classmethod
    def container_action(cls, container_name_or_id: str, action: str) -> Tuple[bool, str]:
        """Performs start, stop, restart on a single container."""
        if action not in ["start", "stop", "restart", "pause", "unpause"]:
            return False, f"Acción inválida: {action}"
        cmd = f"docker {action} {shlex.quote(container_name_or_id)}"
        code, out, err = cls._run_cmd(cmd, timeout=30)
        if code == 0:
            return True, f"Contenedor {action} completado"
        return False, err or out

    @classmethod
    def container_logs(cls, container_name_or_id: str, tail: int = 150) -> str:
        """Fetches last N lines of container logs."""
        cmd = f"docker logs --tail {int(tail)} --timestamps {shlex.quote(container_name_or_id)}"
        code, out, err = cls._run_cmd(cmd, timeout=10)
        logs = out if out else err
        return logs or "No hay registros disponibles."

    @classmethod
    def compose_up(cls, compose_file: str, env_file: str, project_name: str, services: Optional[List[str]] = None,
                   timeout: int = 180) -> Tuple[bool, str]:
        cwd = os.path.dirname(os.path.abspath(compose_file))
        svc_str = " ".join(shlex.quote(s) for s in services) if services else ""
        cmd = f"docker compose -f {shlex.quote(compose_file)} -p {shlex.quote(project_name)} --env-file {shlex.quote(env_file)} up -d --remove-orphans {svc_str}"
        code, out, err = cls._run_cmd(cmd, timeout=timeout, cwd=cwd)
        if code == 0:
            return True, out or "Servicios iniciados correctamente"
        return False, err or out

    @classmethod
    def compose_pull(cls, compose_file: str, env_file: str, project_name: str, timeout: int = 3600) -> Tuple[bool, str]:
        """Downloads the images of every service that pulls from a registry (the use-cases image is built locally)."""
        cwd = os.path.dirname(os.path.abspath(compose_file))
        cmd = (f"docker compose -f {shlex.quote(compose_file)} -p {shlex.quote(project_name)} --env-file {shlex.quote(env_file)} "
               f"pull --ignore-buildable --quiet")
        code, out, err = cls._run_cmd(cmd, timeout=timeout, cwd=cwd)
        if code == 0:
            return True, out or "Imágenes descargadas"
        return False, err or out

    @classmethod
    def compose_stop(cls, compose_file: str, project_name: str) -> Tuple[bool, str]:
        cmd = f"docker compose -f {shlex.quote(compose_file)} -p {shlex.quote(project_name)} stop"
        code, out, err = cls._run_cmd(cmd, timeout=45)
        if code == 0:
            return True, out or "Ambiente detenido correctamente"
        return False, err or out

    @classmethod
    def compose_down(cls, compose_file: str, project_name: str, remove_volumes: bool = False) -> Tuple[bool, str]:
        v_flag = "-v" if remove_volumes else ""
        cmd = f"docker compose -f {shlex.quote(compose_file)} -p {shlex.quote(project_name)} down {v_flag}"
        code, out, err = cls._run_cmd(cmd, timeout=60)
        if code == 0:
            return True, out or "Ambiente eliminado correctamente"
        return False, err or out

    @classmethod
    def get_volume_details(cls, volume_name: str) -> Dict[str, Any]:
        """Inspects a Docker volume and returns driver, mountpoint, and real host physical path."""
        code, out, _ = cls._run_cmd(f"docker volume inspect {shlex.quote(volume_name)}")
        if code == 0 and out:
            try:
                data = json.loads(out)
                if isinstance(data, list) and len(data) > 0:
                    v = data[0]
                    opts = v.get("Options") or {}
                    device = opts.get("device")
                    mountpoint = v.get("Mountpoint", "")
                    is_custom = bool(device)
                    host_path = device if device else mountpoint
                    return {
                        "name": volume_name,
                        "driver": v.get("Driver", "local"),
                        "mountpoint": mountpoint,
                        "host_path": host_path,
                        "is_custom": is_custom
                    }
            except Exception:
                pass
        return {
            "name": volume_name,
            "driver": "local",
            "mountpoint": f"/var/lib/docker/volumes/{volume_name}/_data",
            "host_path": f"/var/lib/docker/volumes/{volume_name}/_data",
            "is_custom": False
        }

    @classmethod
    def get_volumes_info(cls) -> List[Dict[str, Any]]:
        """Queries Docker volumes belonging strictly to Inspire Flex demo environments."""
        cmd = "docker volume ls --format '{{.Name}}'"
        code, out, _ = cls._run_cmd(cmd)
        vols = []
        if code == 0 and out:
            names = [line.strip() for line in out.splitlines() if line.strip()]
            system_keywords = ["studio_data", "studio_environments", "studio_docker_config"]
            components = ["pgdata", "icmdata", "filestore", "demomode"]

            relevant = []
            for n in names:
                low = n.lower()
                # Exclude studio manager internal infrastructure
                if any(sys_k in low for sys_k in system_keywords):
                    continue
                # Include strictly Inspire Flex demo environment volumes (flex-* or demo-*)
                if (low.startswith("flex-") or low.startswith("demo-")) and any(c in low for c in components):
                    relevant.append(n)

            for name in relevant:
                details = cls.get_volume_details(name)
                vols.append(details)
        return vols

    @classmethod
    def delete_volume(cls, volume_name: str) -> Tuple[bool, str]:
        """Removes a specific Docker volume by name, cleaning stopped containers if needed."""
        if not volume_name:
            return False, "Nombre de volumen inválido"

        lower = volume_name.lower()
        # Safety lock: protect studio system infrastructure volumes
        if any(sys_k in lower for sys_k in ["studio_data", "studio_environments", "studio_docker_config"]):
            return False, f"El volumen '{volume_name}' es crítico del sistema Studio y está protegido contra eliminación."

        clean_name = shlex.quote(volume_name.strip())

        # Check containers referencing this volume
        c_code, c_out, _ = cls._run_cmd(f"docker ps -a --filter volume={clean_name} --format '{{{{.ID}}}} {{{{.State}}}}'")
        if c_code == 0 and c_out.strip():
            lines = [l.strip().split(None, 1) for l in c_out.strip().splitlines() if l.strip()]
            running = [parts[0] for parts in lines if len(parts) > 1 and parts[1].lower() == "running"]
            if running:
                return False, f"El volumen está en uso por contenedores activos ({', '.join(running)}). Pausa o elimina el ambiente primero."

            # Automatically remove stopped/exited containers holding this volume
            for parts in lines:
                cid = parts[0]
                cls._run_cmd(f"docker rm -f {shlex.quote(cid)}")

        code, out, err = cls._run_cmd(f"docker volume rm -f {clean_name}")
        if code == 0:
            return True, f"Volumen '{volume_name}' eliminado exitosamente"
        return False, err or out or "No se pudo eliminar el volumen"

    @classmethod
    def login_registry(cls, registry: str, username: str, password: str) -> Tuple[bool, str]:
        """Authenticates the Docker CLI client with a private container registry."""
        if not registry or not username or not password:
            return False, "Faltan credenciales del registro (registro, usuario o contraseña)"
        clean_reg = shlex.quote(registry.strip())
        clean_user = shlex.quote(username.strip())
        cmd = f"docker login {clean_reg} -u {clean_user} --password-stdin"
        code, out, err = cls._run_cmd(cmd, timeout=30, input_data=password.strip())
        if code == 0:
            return True, out or "Inicio de sesión exitoso en el registro"
        return False, err or out
