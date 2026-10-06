"""
Docker & Docker Compose Service
Handles container lifecycle, healthchecks, stats and logs.
"""
import subprocess
import json
import os
from typing import Dict, List, Optional, Any, Tuple

class DockerService:
    @staticmethod
    def _run_cmd(cmd: str, timeout: int = 60, cwd: Optional[str] = None, input_data: Optional[str] = None) -> Tuple[int, str, str]:
        """Runs a command, automatically wrapping in 'sg docker -c' if required."""
        # Check if direct docker call works
        use_sg = False
        try:
            res = subprocess.run(["docker", "info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2)
            if res.returncode != 0:
                use_sg = True
        except Exception:
            use_sg = True

        if use_sg:
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
        cmd = f"docker ps -a --filter 'label=com.docker.compose.project={project_name}' --format '{{{{json .}}}}'"
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
        cmd = f"docker stats --no-stream --format '{{{{json .}}}}' {container_id_or_name}"
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
        cmd = f"docker {action} {container_name_or_id}"
        code, out, err = cls._run_cmd(cmd, timeout=30)
        if code == 0:
            return True, f"Contenedor {action} completado"
        return False, err or out

    @classmethod
    def container_logs(cls, container_name_or_id: str, tail: int = 150) -> str:
        """Fetches last N lines of container logs."""
        cmd = f"docker logs --tail {tail} --timestamps {container_name_or_id}"
        code, out, err = cls._run_cmd(cmd, timeout=10)
        logs = out if out else err
        return logs or "No hay registros disponibles."

    @classmethod
    def compose_up(cls, compose_file: str, env_file: str, project_name: str, services: Optional[List[str]] = None) -> Tuple[bool, str]:
        cwd = os.path.dirname(os.path.abspath(compose_file))
        svc_str = " ".join(services) if services else ""
        cmd = f"docker compose -f '{compose_file}' -p '{project_name}' --env-file '{env_file}' up -d {svc_str}"
        code, out, err = cls._run_cmd(cmd, timeout=180, cwd=cwd)
        if code == 0:
            return True, out or "Servicios iniciados correctamente"
        return False, err or out

    @classmethod
    def compose_stop(cls, compose_file: str, project_name: str) -> Tuple[bool, str]:
        cmd = f"docker compose -f '{compose_file}' -p '{project_name}' stop"
        code, out, err = cls._run_cmd(cmd, timeout=45)
        if code == 0:
            return True, out or "Ambiente detenido correctamente"
        return False, err or out

    @classmethod
    def compose_down(cls, compose_file: str, project_name: str, remove_volumes: bool = False) -> Tuple[bool, str]:
        v_flag = "-v" if remove_volumes else ""
        cmd = f"docker compose -f '{compose_file}' -p '{project_name}' down {v_flag}"
        code, out, err = cls._run_cmd(cmd, timeout=60)
        if code == 0:
            return True, out or "Ambiente eliminado correctamente"
        return False, err or out

    @classmethod
    def get_volumes_info(cls) -> List[Dict[str, Any]]:
        """Queries Docker volumes and their storage sizes."""
        cmd = "docker volume ls --format '{{json .}}'"
        code, out, _ = cls._run_cmd(cmd)
        vols = []
        if code == 0 and out:
            for line in out.splitlines():
                if line.strip():
                    try:
                        v = json.loads(line)
                        name = v.get("Name", "")
                        # Filter relevant quadient or flex volumes
                        if any(k in name.lower() for k in ["pgdata", "icmdata", "kafka", "flex"]):
                            vols.append({
                                "name": name,
                                "driver": v.get("Driver", "local"),
                                "mountpoint": v.get("Mountpoint", "")
                            })
                    except Exception:
                        pass
        return vols

    @classmethod
    def login_registry(cls, registry: str, username: str, password: str) -> Tuple[bool, str]:
        """Authenticates the Docker CLI client with a private container registry."""
        if not registry or not username or not password:
            return False, "Faltan credenciales del registro (registro, usuario o contraseña)"
        import shlex
        clean_reg = shlex.quote(registry.strip())
        clean_user = shlex.quote(username.strip())
        cmd = f"docker login {clean_reg} -u {clean_user} --password-stdin"
        code, out, err = cls._run_cmd(cmd, timeout=30, input_data=password.strip())
        if code == 0:
            return True, out or "Inicio de sesión exitoso en el registro"
        return False, err or out

