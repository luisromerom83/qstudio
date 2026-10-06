"""
Azure Container Registry (ACR) Service
Handles OAuth2 token exchange with Azure Container Registry and queries available tags.
"""
import requests
import os
from typing import Dict, List, Optional, Tuple

class ACRService:
    @staticmethod
    def get_credentials(env_file_path: str) -> Dict[str, str]:
        creds = {
            "ACR_REGISTRY": "quadientdistribution.azurecr.io",
            "ACR_USERNAME": "",
            "ACR_PASSWORD": "",
            "CX_LIC_SERVER": "",
            "INSPIRE_VERSION": "17.5-latest"
        }
        if os.path.exists(env_file_path):
            with open(env_file_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        creds[k] = v
        return creds

    @staticmethod
    def save_credentials(env_file_path: str, creds: Dict[str, str]) -> None:
        acr_name = creds.get("ACR_REGISTRY", "quadientdistribution.azurecr.io").split(".")[0]
        content = f"""# Quadient Azure Container Registry Credentials
ACR_NAME="{acr_name}"
ACR_REGISTRY="{creds.get('ACR_REGISTRY', 'quadientdistribution.azurecr.io')}"
ACR_USERNAME="{creds.get('ACR_USERNAME', '')}"
ACR_PASSWORD="{creds.get('ACR_PASSWORD', '')}"
CX_LIC_SERVER="{creds.get('CX_LIC_SERVER', '')}"
QUADIENT_LICENSE_URL="{creds.get('CX_LIC_SERVER', '')}"
INSPIRE_VERSION="{creds.get('INSPIRE_VERSION', '17.5-latest')}"
"""
        with open(env_file_path, "w", encoding="utf-8") as f:
            f.write(content)
        os.chmod(env_file_path, 0o600)

        # Also sync to root .env if in root directory
        parent_dir = os.path.dirname(os.path.abspath(env_file_path))
        root_env = os.path.join(parent_dir, ".env")
        try:
            with open(root_env, "w", encoding="utf-8") as f:
                f.write(content)
            os.chmod(root_env, 0o600)
        except Exception:
            pass

    @classmethod
    def test_credentials(cls, registry: str, username: str, password: str) -> Tuple[bool, str]:
        """Validates credentials by requesting an OAuth2 token from ACR."""
        if not registry or not username or not password:
            return False, "Faltan credenciales obligatorias (Registry, Usuario o Contraseña)"
        try:
            token_url = f"https://{registry}/oauth2/token"
            params = {
                "service": registry,
                "scope": "repository:flex/interactive:metadata_read",
                "grant_type": "password",
                "username": username,
                "password": password
            }
            resp = requests.post(token_url, data=params, timeout=10)
            if resp.status_code == 200 and "access_token" in resp.json():
                return True, "Autenticación exitosa con Azure Container Registry"
            else:
                return False, f"Fallo de autenticación ({resp.status_code}): {resp.text[:180]}"
        except Exception as e:
            return False, f"Error de conexión: {str(e)}"

    @classmethod
    def get_token(cls, registry: str, username: str, password: str, repository: str) -> Optional[str]:
        try:
            token_url = f"https://{registry}/oauth2/token"
            params = {
                "service": registry,
                "scope": f"repository:{repository}:metadata_read",
                "grant_type": "password",
                "username": username,
                "password": password
            }
            resp = requests.post(token_url, data=params, timeout=10)
            if resp.status_code == 200:
                return resp.json().get("access_token")
        except Exception:
            pass
        return None

    @classmethod
    def get_tags(cls, registry: str, username: str, password: str, repository: str = "flex/interactive") -> List[str]:
        token = cls.get_token(registry, username, password, repository)
        if not token:
            return []
        try:
            tags_url = f"https://{registry}/v2/{repository}/tags/list?n=1000"
            resp = requests.get(tags_url, headers={"Authorization": f"Bearer {token}"}, timeout=15)
            if resp.status_code == 200:
                tags = resp.json().get("tags", [])
                return tags
        except Exception:
            pass
        return []

    @classmethod
    def get_recommended_versions(cls, registry: str, username: str, password: str) -> Dict[str, any]:
        """Returns sorted list of latest and stable inspire versions from ACR."""
        tags = cls.get_tags(registry, username, password, "flex/interactive")
        latest_tags = sorted([t for t in tags if "latest" in t], reverse=True)
        hf_tags = sorted([t for t in tags if "-HF" in t], reverse=True)[:15]
        return {
            "all_latest": latest_tags,
            "hotfixes": hf_tags,
            "total_tags_found": len(tags)
        }
