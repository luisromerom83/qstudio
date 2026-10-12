"""
Backup & Snapshot Service
Creates point-in-time snapshots of Demo databases and ICM packages.
"""
import os
import re
import json
import shlex
import tarfile
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any
from .docker_service import DockerService

class BackupService:
    def __init__(self, base_dir: str):
        self.base_dir = os.path.abspath(base_dir)
        self.snapshots_dir = os.path.join(self.base_dir, "manager", "data", "snapshots")
        self.meta_file = os.path.join(self.snapshots_dir, "snapshots.json")
        os.makedirs(self.snapshots_dir, exist_ok=True)

    def list_snapshots(self, env_id: Optional[str] = None) -> List[Dict[str, Any]]:
        snapshots = []
        if os.path.exists(self.meta_file):
            try:
                with open(self.meta_file, "r", encoding="utf-8") as f:
                    snapshots = json.load(f)
            except Exception:
                pass

        # Verify physical existence
        valid = []
        for s in snapshots:
            filepath = os.path.join(self.snapshots_dir, s["filename"])
            if os.path.exists(filepath):
                s["size_bytes"] = os.path.getsize(filepath)
                s["size_human"] = self._format_size(s["size_bytes"])
                if env_id is None or s.get("env_id") == env_id:
                    valid.append(s)
        return sorted(valid, key=lambda x: x.get("created_at", ""), reverse=True)

    def _save_meta(self, snapshots: List[Dict[str, Any]]):
        with open(self.meta_file, "w", encoding="utf-8") as f:
            json.dump(snapshots, f, indent=2, ensure_ascii=False)

    def create_snapshot(self, env_id: str, project_name: str, name: Optional[str] = None) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        # The name becomes a filename and part of a shell command: keep it to a safe charset
        clean_name = re.sub(r"[^A-Za-z0-9._-]", "_", name or f"snapshot_{env_id}_{timestamp}").lstrip(".") or f"snapshot_{timestamp}"
        filename = f"{clean_name}.tar.gz"
        filepath = os.path.join(self.snapshots_dir, filename)
        tmp_dump_dir = os.path.join(self.snapshots_dir, f"tmp_{timestamp}")
        os.makedirs(tmp_dump_dir, exist_ok=True)

        try:
            # 1. Dump PostgreSQL if running
            pg_container = f"{project_name}-postgres" if project_name != "kafka-csv-producer" else "quadient-postgres"
            dump_file = os.path.join(tmp_dump_dir, "databases_dump.sql")
            code, out, err = DockerService._run_cmd(
                f"docker exec {shlex.quote(pg_container)} pg_dumpall -U scaler > {shlex.quote(dump_file)}",
                timeout=60
            )

            # 2. Package into tar.gz
            with tarfile.open(filepath, "w:gz") as tar:
                if os.path.exists(dump_file) and os.path.getsize(dump_file) > 0:
                    tar.add(dump_file, arcname="databases_dump.sql")
                # Also include snapshot manifest
                manifest_path = os.path.join(tmp_dump_dir, "manifest.json")
                manifest_data = {
                    "env_id": env_id,
                    "project_name": project_name,
                    "created_at": datetime.now().isoformat(),
                    "name": name or clean_name
                }
                with open(manifest_path, "w") as mf:
                    json.dump(manifest_data, mf)
                tar.add(manifest_path, arcname="manifest.json")

            # Clean tmp
            for f in os.listdir(tmp_dump_dir):
                os.remove(os.path.join(tmp_dump_dir, f))
            os.rmdir(tmp_dump_dir)

            record = {
                "id": f"snap_{timestamp}",
                "env_id": env_id,
                "project_name": project_name,
                "name": name or f"Snapshot {datetime.now().strftime('%d/%m/%Y %H:%M')}",
                "filename": filename,
                "created_at": datetime.now().isoformat(),
                "size_bytes": os.path.getsize(filepath),
                "size_human": self._format_size(os.path.getsize(filepath))
            }

            all_snaps = self.list_snapshots()
            all_snaps.append(record)
            self._save_meta(all_snaps)

            return True, "Snapshot creado exitosamente", record
        except Exception as e:
            if os.path.exists(tmp_dump_dir):
                import shutil
                shutil.rmtree(tmp_dump_dir, ignore_errors=True)
            return False, f"Error al generar snapshot: {str(e)}", None

    def delete_snapshot(self, filename: str) -> Tuple[bool, str]:
        if os.path.basename(filename) != filename or filename.startswith(".") or not filename.endswith(".tar.gz"):
            return False, "Nombre de snapshot inválido"
        filepath = os.path.join(self.snapshots_dir, filename)
        if os.path.exists(filepath):
            try:
                os.remove(filepath)
            except Exception as e:
                return False, str(e)
        all_snaps = [s for s in self.list_snapshots() if s.get("filename") != filename]
        self._save_meta(all_snaps)
        return True, "Snapshot eliminado"

    @staticmethod
    def _format_size(size_bytes: int) -> str:
        for unit in ["B", "KB", "MB", "GB"]:
            if size_bytes < 1024.0:
                return f"{size_bytes:.1f} {unit}"
            size_bytes /= 1024.0
        return f"{size_bytes:.1f} TB"
