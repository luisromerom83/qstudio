"""
Quadient Inspire Flex - Demo & PoC Sandbox Studio
Web Server & Management API
"""
import json
import os
import sys
from flask import Flask, render_template, request, jsonify, send_from_directory

# Add parent directory to path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from manager.services.acr_service import ACRService
from manager.services.docker_service import DockerService
from manager.services.env_service import EnvService, VERTICAL_CATEGORIES
from manager.services.backup_service import BackupService
from manager.i18n import resolve_lang, localize_payload

app = Flask(
    __name__,
    template_folder=os.path.join(os.path.dirname(__file__), "templates"),
    static_folder=os.path.join(os.path.dirname(__file__), "static")
)

DATA_DIR = os.path.join(BASE_DIR, "manager", "data")
ENV_FILE = os.path.join(DATA_DIR, ".quadient_credentials.env")
if not os.path.exists(ENV_FILE) and os.path.exists(os.path.join(BASE_DIR, ".quadient_credentials.env")):
    ENV_FILE = os.path.join(BASE_DIR, ".quadient_credentials.env")

env_service = EnvService(BASE_DIR)
backup_service = BackupService(BASE_DIR)

@app.after_request
def localize_response(response):
    lang = resolve_lang(request.headers.get("X-Studio-Lang"), request.headers.get("Accept-Language"))
    if response.is_json and lang != "es-MX":
        response.set_data(json.dumps(localize_payload(response.get_json(), lang), ensure_ascii=False))
    return response

@app.route("/")
def index():
    return render_template("index.html", default_lang=os.environ.get("STUDIO_LANG", ""))

# ------------------------------------------------------------------------------
# 1. Config & Azure Credentials
# ------------------------------------------------------------------------------
@app.route("/api/config", methods=["GET"])
def get_config():
    creds = ACRService.get_credentials(ENV_FILE)
    is_onboarding_needed = not bool(creds.get("ACR_USERNAME") and creds.get("ACR_PASSWORD"))
    return jsonify({
        "credentials": {
            "registry": creds.get("ACR_REGISTRY", "quadientdistribution.azurecr.io"),
            "username": creds.get("ACR_USERNAME", ""),
            "has_password": bool(creds.get("ACR_PASSWORD")),
            "license_server": creds.get("CX_LIC_SERVER", ""),
            "version": creds.get("INSPIRE_VERSION", "17.5-latest")
        },
        "needs_onboarding": is_onboarding_needed,
        "firebase": env_service.get_firebase_status(),
        "use_cases": env_service.get_use_case_catalog(),
        "verticals": VERTICAL_CATEGORIES
    })

@app.route("/api/config", methods=["POST"])
def update_config():
    data = request.json or {}
    creds = ACRService.get_credentials(ENV_FILE)
    
    if "registry" in data:
        creds["ACR_REGISTRY"] = data["registry"].strip()
    if "username" in data:
        creds["ACR_USERNAME"] = data["username"].strip()
    if "password" in data and data["password"]:
        creds["ACR_PASSWORD"] = data["password"].strip()
    if "license_server" in data:
        creds["CX_LIC_SERVER"] = data["license_server"].strip()
    if "version" in data:
        creds["INSPIRE_VERSION"] = data["version"].strip()

    # Save to persistent data directory
    target_env = os.path.join(DATA_DIR, ".quadient_credentials.env")
    ACRService.save_credentials(target_env, creds)
    # Also save to base dir for compatibility
    try:
        ACRService.save_credentials(os.path.join(BASE_DIR, ".quadient_credentials.env"), creds)
    except Exception:
        pass

    # Propagate credentials to all existing environments so license updates apply immediately
    try:
        for env in env_service.list_environments():
            env_file = env.get("env_file")
            if env_file and os.path.exists(env_file):
                env_creds = ACRService.get_credentials(env_file)
                env_creds.update(creds)
                ACRService.save_credentials(env_file, env_creds)
    except Exception as e:
        app.logger.warning(f"Error propagando credenciales a ambientes existentes: {e}")

    # Authenticate Docker CLI client with Azure Container Registry
    login_ok = True
    login_msg = ""
    if creds.get("ACR_USERNAME") and creds.get("ACR_PASSWORD"):
        login_ok, login_msg = DockerService.login_registry(
            creds.get("ACR_REGISTRY", "quadientdistribution.azurecr.io"),
            creds.get("ACR_USERNAME"),
            creds.get("ACR_PASSWORD")
        )

    if not login_ok:
        return jsonify({
            "success": False,
            "message": f"Configuración guardada, pero falló la autenticación con Azure Container Registry: {login_msg}"
        }), 400

    return jsonify({"success": True, "message": "Configuración guardada y sesión iniciada exitosamente en Azure Container Registry"})

@app.route("/api/config/firebase", methods=["POST"])
def update_firebase_config():
    data = request.json or {}
    ok, msg = env_service.save_firebase_settings(
        (data.get("service_account") or "").strip(),
        (data.get("web_config") or "").strip(),
        (data.get("vapid_key") or "").strip()
    )
    return jsonify({"success": ok, "message": msg, "firebase": env_service.get_firebase_status()}), (200 if ok else 400)

@app.route("/api/config/test", methods=["POST"])
def test_config():
    data = request.json or {}
    reg = data.get("registry", "quadientdistribution.azurecr.io").strip()
    user = data.get("username", "").strip()
    pwd = data.get("password", "").strip()
    
    # Fallback to existing password if not provided in test
    if not pwd:
        creds = ACRService.get_credentials(ENV_FILE)
        pwd = creds.get("ACR_PASSWORD", "")

    ok, msg = ACRService.test_credentials(reg, user, pwd)
    if ok and pwd:
        docker_ok, docker_msg = DockerService.login_registry(reg, user, pwd)
        if not docker_ok:
            return jsonify({"success": False, "message": f"Token Azure validado, pero Docker login falló: {docker_msg}"})
        return jsonify({"success": True, "message": f"{msg} y Docker Engine autenticado"})
    return jsonify({"success": ok, "message": msg})

# ------------------------------------------------------------------------------
# 2. Environments / Demos Management
# ------------------------------------------------------------------------------
@app.route("/api/environments", methods=["GET"])
def list_environments():
    envs = env_service.list_environments()
    return jsonify({"environments": envs, "total": len(envs)})

@app.route("/api/environments", methods=["POST"])
def create_environment():
    data = request.json or {}
    ok, msg, new_env = env_service.create_environment(data)
    if ok:
        return jsonify({"success": True, "message": msg, "environment": new_env})
    return jsonify({"success": False, "message": msg}), 400

@app.route("/api/environments/<env_id>", methods=["GET"])
def get_environment(env_id):
    env = env_service.get_environment(env_id)
    if not env:
        return jsonify({"success": False, "message": "Ambiente no encontrado"}), 404
    return jsonify({"success": True, "environment": env})

@app.route("/api/environments/<env_id>", methods=["PUT"])
def update_environment(env_id):
    data = request.json or {}
    ok, msg = env_service.update_environment(env_id, data)
    if ok:
        return jsonify({"success": True, "message": msg})
    return jsonify({"success": False, "message": msg}), 400

@app.route("/api/environments/<env_id>", methods=["DELETE"])
def delete_environment(env_id):
    remove_vols = request.args.get("remove_volumes", "false").lower() == "true"
    ok, msg = env_service.delete_environment(env_id, remove_volumes=remove_vols)
    if ok:
        return jsonify({"success": True, "message": msg})
    return jsonify({"success": False, "message": msg}), 400

@app.route("/api/environments/<env_id>/activate", methods=["POST"])
def activate_demo(env_id):
    data = request.json or {}
    exclusive = data.get("exclusive", True) # Default to true for RAM saving
    ok, msg = env_service.activate_demo(env_id, exclusive=exclusive)
    return jsonify({"success": ok, "message": msg})

@app.route("/api/environments/<env_id>/progress", methods=["GET"])
def activation_progress(env_id):
    return jsonify({"success": True, "progress": env_service.get_progress(env_id)})

@app.route("/api/environments/<env_id>/stop", methods=["POST"])
def stop_demo(env_id):
    ok, msg = env_service.stop_demo(env_id)
    return jsonify({"success": ok, "message": msg})

# ------------------------------------------------------------------------------
# 3. Individual Container Actions & Logs
# ------------------------------------------------------------------------------
@app.route("/api/containers/<container_name>/action", methods=["POST"])
def container_action(container_name):
    data = request.json or {}
    action = data.get("action", "restart")
    ok, msg = DockerService.container_action(container_name, action)
    return jsonify({"success": ok, "message": msg})

@app.route("/api/containers/<container_name>/logs", methods=["GET"])
def container_logs(container_name):
    try:
        tail = max(1, min(int(request.args.get("tail", 150)), 5000))
    except ValueError:
        return jsonify({"success": False, "message": "Parámetro 'tail' inválido"}), 400
    logs = DockerService.container_logs(container_name, tail=tail)
    return jsonify({"success": True, "logs": logs})

@app.route("/api/containers/<container_name>/stats", methods=["GET"])
def container_stats(container_name):
    stats = DockerService.get_container_stats(container_name)
    return jsonify({"success": True, "stats": stats})

# ------------------------------------------------------------------------------
# 4. Azure Registry Versions & Tags
# ------------------------------------------------------------------------------
@app.route("/api/acr/versions", methods=["GET"])
def get_acr_versions():
    creds = ACRService.get_credentials(ENV_FILE)
    reg = creds.get("ACR_REGISTRY", "quadientdistribution.azurecr.io")
    user = creds.get("ACR_USERNAME", "")
    pwd = creds.get("ACR_PASSWORD", "")
    
    if not user or not pwd:
        return jsonify({"success": False, "message": "Credenciales de Azure no configuradas"})
    
    info = ACRService.get_recommended_versions(reg, user, pwd)
    return jsonify({"success": True, "data": info})

# ------------------------------------------------------------------------------
# 5. Snapshots & Backups
# ------------------------------------------------------------------------------
@app.route("/api/environments/<env_id>/snapshots", methods=["GET"])
def list_snapshots(env_id):
    snaps = backup_service.list_snapshots(env_id)
    return jsonify({"success": True, "snapshots": snaps})

@app.route("/api/environments/<env_id>/snapshots", methods=["POST"])
def create_snapshot(env_id):
    env = env_service.get_environment(env_id)
    if not env:
        return jsonify({"success": False, "message": "Ambiente no encontrado"}), 404
    data = request.json or {}
    name = data.get("name")
    ok, msg, snap = backup_service.create_snapshot(env_id, env["project_name"], name=name)
    if ok:
        return jsonify({"success": True, "message": msg, "snapshot": snap})
    return jsonify({"success": False, "message": msg}), 500

@app.route("/api/snapshots/<filename>", methods=["DELETE"])
def delete_snapshot(filename):
    ok, msg = backup_service.delete_snapshot(filename)
    return jsonify({"success": ok, "message": msg})

# ------------------------------------------------------------------------------
# 6. Volumes
# ------------------------------------------------------------------------------
@app.route("/api/volumes", methods=["GET"])
def list_volumes():
    vols = DockerService.get_volumes_info()
    return jsonify({"success": True, "volumes": vols})

@app.route("/api/volumes/<path:volume_name>", methods=["DELETE"])
def delete_volume(volume_name):
    try:
        ok, msg = DockerService.delete_volume(volume_name)
        status_code = 200 if ok else 400
        return jsonify({"success": ok, "message": msg}), status_code
    except Exception as e:
        return jsonify({"success": False, "message": f"Error al eliminar volumen: {str(e)}"}), 500

@app.route("/api/environments/<env_id>/volumes", methods=["GET"])
def get_env_volumes(env_id):
    vols = env_service.get_environment_volumes(env_id)
    return jsonify({"success": True, "volumes": vols})

if __name__ == "__main__":
    port = int(os.environ.get("STUDIO_PORT", 8090))
    print(f"[*] Iniciando Quadient Demo & PoC Studio en http://0.0.0.0:{port}")
    # threaded: activations block for minutes while the UI polls their progress
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
