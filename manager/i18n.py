"""
Backend message localization.

Services keep writing their messages in Spanish (es-MX, the source language).
Before a JSON response leaves the API, `localize_payload` swaps every
user-facing text ("message", "label", "error", "component") for its en-US / pt-BR version
according to the X-Studio-Lang header sent by the UI.

CATALOG maps each Spanish template to its translations. Templates may carry
{placeholders}; the matching values are captured from the Spanish text and
re-inserted in the translation. Unknown texts are returned unchanged.
"""
import re
from typing import Any, Dict, List, Optional, Tuple

SUPPORTED_LANGS = ("es-MX", "en-US", "pt-BR")
SOURCE_LANG = "es-MX"
LOCALIZED_KEYS = ("message", "label", "error", "component")

CATALOG: Dict[str, Dict[str, str]] = {
    # ── Configuration & Azure Container Registry (app.py, acr_service.py) ──
    "Configuración guardada y sesión iniciada exitosamente en Azure Container Registry": {
        "en-US": "Settings saved and signed in to Azure Container Registry",
        "pt-BR": "Configuração salva e sessão iniciada no Azure Container Registry",
    },
    "Configuración guardada, pero falló la autenticación con Azure Container Registry: {detail}": {
        "en-US": "Settings saved, but authentication with Azure Container Registry failed: {detail}",
        "pt-BR": "Configuração salva, mas a autenticação no Azure Container Registry falhou: {detail}",
    },
    "Token Azure validado, pero Docker login falló: {detail}": {
        "en-US": "Azure token validated, but Docker login failed: {detail}",
        "pt-BR": "Token do Azure validado, mas o login do Docker falhou: {detail}",
    },
    "{msg} y Docker Engine autenticado": {
        "en-US": "{msg}; Docker Engine authenticated",
        "pt-BR": "{msg}; Docker Engine autenticado",
    },
    "Credenciales de Azure no configuradas": {
        "en-US": "Azure credentials are not configured",
        "pt-BR": "Credenciais do Azure não configuradas",
    },
    "Credenciales de Azure no configuradas. Por favor dirígete a la pestaña 'Ajustes' (⚙️) o abre el asistente inicial para configurar tu usuario y contraseña de Azure.": {
        "en-US": "Azure credentials are not configured. Go to the 'Settings' tab (⚙️) or open the setup wizard to enter your Azure username and password.",
        "pt-BR": "Credenciais do Azure não configuradas. Acesse a aba 'Configurações' (⚙️) ou abra o assistente inicial para configurar seu usuário e senha do Azure.",
    },
    "Faltan credenciales obligatorias (Registry, Usuario o Contraseña)": {
        "en-US": "Required credentials are missing (Registry, Username or Password)",
        "pt-BR": "Faltam credenciais obrigatórias (Registry, Usuário ou Senha)",
    },
    "Autenticación exitosa con Azure Container Registry": {
        "en-US": "Successfully authenticated with Azure Container Registry",
        "pt-BR": "Autenticação no Azure Container Registry realizada com sucesso",
    },
    "Fallo de autenticación ({status}): {detail}": {
        "en-US": "Authentication failed ({status}): {detail}",
        "pt-BR": "Falha na autenticação ({status}): {detail}",
    },
    "Error de conexión: {detail}": {
        "en-US": "Connection error: {detail}",
        "pt-BR": "Erro de conexão: {detail}",
    },
    "Fallo al autenticar Docker con Azure Container Registry: {detail}": {
        "en-US": "Failed to authenticate Docker with Azure Container Registry: {detail}",
        "pt-BR": "Falha ao autenticar o Docker no Azure Container Registry: {detail}",
    },

    # ── Firebase (env_service.py) ──
    "La cuenta de servicio no es un JSON válido": {
        "en-US": "The service account is not valid JSON",
        "pt-BR": "A conta de serviço não é um JSON válido",
    },
    "El JSON no corresponde a una cuenta de servicio de Firebase (falta type, private_key o client_email)": {
        "en-US": "The JSON is not a Firebase service account (type, private_key or client_email is missing)",
        "pt-BR": "O JSON não corresponde a uma conta de serviço do Firebase (falta type, private_key ou client_email)",
    },
    "A la configuración web le faltan campos: {fields}": {
        "en-US": "The web configuration is missing fields: {fields}",
        "pt-BR": "Faltam campos na configuração web: {fields}",
    },
    "La VAPID key no tiene el formato esperado (clave pública de Cloud Messaging > Web Push certificates)": {
        "en-US": "The VAPID key doesn't have the expected format (public key from Cloud Messaging > Web Push certificates)",
        "pt-BR": "A VAPID key não tem o formato esperado (chave pública de Cloud Messaging > Web Push certificates)",
    },
    "Faltan datos: se necesitan la cuenta de servicio, la configuración web y la VAPID key": {
        "en-US": "Missing data: the service account, the web configuration and the VAPID key are required",
        "pt-BR": "Faltam dados: são necessários a conta de serviço, a configuração web e a VAPID key",
    },
    "La cuenta de servicio es del proyecto '{key_project}' pero la configuración web es de '{web_project}'; deben ser del mismo proyecto de Firebase": {
        "en-US": "The service account belongs to project '{key_project}' but the web configuration belongs to '{web_project}'; both must be from the same Firebase project",
        "pt-BR": "A conta de serviço é do projeto '{key_project}', mas a configuração web é de '{web_project}'; ambas devem ser do mesmo projeto do Firebase",
    },
    "Firebase configurado con el proyecto {project}": {
        "en-US": "Firebase configured with project {project}",
        "pt-BR": "Firebase configurado com o projeto {project}",
    },

    # ── Environments: create / update / delete (env_service.py, app.py) ──
    "Ambiente no encontrado": {
        "en-US": "Environment not found",
        "pt-BR": "Ambiente não encontrado",
    },
    "El nombre del ambiente es obligatorio": {
        "en-US": "The environment name is required",
        "pt-BR": "O nome do ambiente é obrigatório",
    },
    "Identificador de ambiente inválido (solo minúsculas, números, '-' y '_')": {
        "en-US": "Invalid environment ID (lowercase letters, numbers, '-' and '_' only)",
        "pt-BR": "Identificador de ambiente inválido (somente letras minúsculas, números, '-' e '_')",
    },
    "Versión inválida: {version}": {
        "en-US": "Invalid version: {version}",
        "pt-BR": "Versão inválida: {version}",
    },
    "El puerto de Interactive debe ser mayor o igual a 30701 (recibido: {port})": {
        "en-US": "The Interactive port must be 30701 or higher (received: {port})",
        "pt-BR": "A porta do Interactive deve ser maior ou igual a 30701 (recebido: {port})",
    },
    "Conflicto de puertos: los puertos {ports} ya están asignados o en uso en el host. Por favor selecciona otro puerto o déjalo en blanco para auto-asignación.": {
        "en-US": "Port conflict: ports {ports} are already assigned or in use on the host. Choose another port or leave it blank to assign one automatically.",
        "pt-BR": "Conflito de portas: as portas {ports} já estão atribuídas ou em uso no host. Escolha outra porta ou deixe em branco para atribuição automática.",
    },
    "No se pudo copiar el contenido del volumen {volume} a '{path}': {detail}": {
        "en-US": "Couldn't copy the contents of volume {volume} to '{path}': {detail}",
        "pt-BR": "Não foi possível copiar o conteúdo do volume {volume} para '{path}': {detail}",
    },
    "No se pudo recrear el volumen {volume} con la nueva carpeta: {detail}": {
        "en-US": "Couldn't recreate volume {volume} with the new folder: {detail}",
        "pt-BR": "Não foi possível recriar o volume {volume} com a nova pasta: {detail}",
    },
    "Puerto de Interactive inválido": {
        "en-US": "Invalid Interactive port",
        "pt-BR": "Porta do Interactive inválida",
    },
    "Ruta de host inválida: {path}": {
        "en-US": "Invalid host path: {path}",
        "pt-BR": "Caminho do host inválido: {path}",
    },
    "Error al inicializar la carpeta en el host '{path}': {detail}": {
        "en-US": "Error initializing the host folder '{path}': {detail}",
        "pt-BR": "Erro ao inicializar a pasta no host '{path}': {detail}",
    },
    "Error al inicializar la carpeta compartida de Scaler en el host '{path}': {detail}": {
        "en-US": "Error initializing the Scaler shared folder on the host '{path}': {detail}",
        "pt-BR": "Erro ao inicializar a pasta compartilhada do Scaler no host '{path}': {detail}",
    },
    "Error al inicializar la carpeta Jobs de Scaler en el host '{path}': {detail}": {
        "en-US": "Error initializing the Scaler Jobs folder on the host '{path}': {detail}",
        "pt-BR": "Erro ao inicializar a pasta Jobs do Scaler no host '{path}': {detail}",
    },
    "Ambiente creado exitosamente": {
        "en-US": "Environment created successfully",
        "pt-BR": "Ambiente criado com sucesso",
    },
    "Ambiente y configuración de servicios actualizados correctamente": {
        "en-US": "Environment and service settings updated successfully",
        "pt-BR": "Ambiente e configuração de serviços atualizados com sucesso",
    },
    "Ambiente eliminado exitosamente": {
        "en-US": "Environment deleted successfully",
        "pt-BR": "Ambiente excluído com sucesso",
    },

    # ── Demo Mode volume ──
    "Demo mode no habilitado": {
        "en-US": "Demo Mode is not enabled",
        "pt-BR": "Demo Mode não habilitado",
    },
    "Directorio demo-mode no encontrado en {path}": {
        "en-US": "demo-mode directory not found at {path}",
        "pt-BR": "Diretório demo-mode não encontrado em {path}",
    },
    "Error al inicializar volumen de demo-mode: {detail}": {
        "en-US": "Error initializing the demo-mode volume: {detail}",
        "pt-BR": "Erro ao inicializar o volume de demo-mode: {detail}",
    },
    "Volumen demo-mode configurado correctamente": {
        "en-US": "demo-mode volume configured successfully",
        "pt-BR": "Volume demo-mode configurado com sucesso",
    },

    # ── Activation: messages and progress labels (env_service.py) ──
    "Este ambiente ya se está activando. Espera a que termine.": {
        "en-US": "This environment is already being activated. Wait for it to finish.",
        "pt-BR": "Este ambiente já está sendo ativado. Aguarde a conclusão.",
    },
    "Preparando activación": {
        "en-US": "Preparing activation",
        "pt-BR": "Preparando a ativação",
    },
    "Liberando recursos de otras demos": {
        "en-US": "Freeing resources from other demos",
        "pt-BR": "Liberando recursos de outras demos",
    },
    "Iniciando servicios": {
        "en-US": "Starting services",
        "pt-BR": "Iniciando serviços",
    },
    " Ambiente '{name}' activado. Se suspendieron para ahorrar RAM: {others}.": {
        "en-US": " Environment '{name}' activated. Suspended to save RAM: {others}.",
        "pt-BR": " Ambiente '{name}' ativado. Suspensos para economizar RAM: {others}.",
    },
    " Ambiente '{name}' activado.": {
        "en-US": " Environment '{name}' activated.",
        "pt-BR": " Ambiente '{name}' ativado.",
    },
    "Fallo al inicializar el ambiente: {detail}": {
        "en-US": "Failed to initialize the environment: {detail}",
        "pt-BR": "Falha ao inicializar o ambiente: {detail}",
    },
    "Fallo al iniciar el ambiente: {detail}": {
        "en-US": "Failed to start the environment: {detail}",
        "pt-BR": "Falha ao iniciar o ambiente: {detail}",
    },
    "Ambiente ya preparado previamente con éxito.": {
        "en-US": "Environment was already prepared successfully.",
        "pt-BR": "Ambiente já preparado anteriormente com sucesso.",
    },
    "Iniciando PostgreSQL": {
        "en-US": "Starting PostgreSQL",
        "pt-BR": "Iniciando PostgreSQL",
    },
    "Error iniciando PostgreSQL: {detail}": {
        "en-US": "Error starting PostgreSQL: {detail}",
        "pt-BR": "Erro ao iniciar o PostgreSQL: {detail}",
    },
    "PostgreSQL no alcanzó estado saludable a tiempo.": {
        "en-US": "PostgreSQL did not become healthy in time.",
        "pt-BR": "O PostgreSQL não ficou saudável a tempo.",
    },
    "Creando usuario administrador en ICM": {
        "en-US": "Creating administrator user in ICM",
        "pt-BR": "Criando usuário administrador no ICM",
    },
    "Iniciando ICM": {
        "en-US": "Starting ICM",
        "pt-BR": "Iniciando ICM",
    },
    "Error iniciando ICM: {detail}": {
        "en-US": "Error starting ICM: {detail}",
        "pt-BR": "Erro ao iniciar o ICM: {detail}",
    },
    "Asignando permisos en ICM": {
        "en-US": "Assigning permissions in ICM",
        "pt-BR": "Atribuindo permissões no ICM",
    },
    "Error al asignar permisos a usuario 'system' en ICM: {detail}": {
        "en-US": "Error assigning permissions to user 'system' in ICM: {detail}",
        "pt-BR": "Erro ao atribuir permissões ao usuário 'system' no ICM: {detail}",
    },
    "Preparando bases de datos de Scaler (puede tardar varios minutos)": {
        "en-US": "Preparing Scaler databases (this may take several minutes)",
        "pt-BR": "Preparando os bancos de dados do Scaler (pode levar alguns minutos)",
    },
    "Error iniciando scaler-prepare: {detail}": {
        "en-US": "Error starting scaler-prepare: {detail}",
        "pt-BR": "Erro ao iniciar o scaler-prepare: {detail}",
    },
    "scaler-prepare falló con código {code}: {logs}": {
        "en-US": "scaler-prepare failed with code {code}: {logs}",
        "pt-BR": "scaler-prepare falhou com o código {code}: {logs}",
    },
    "scaler-prepare no completó en el tiempo esperado (timeout).": {
        "en-US": "scaler-prepare did not finish in the expected time (timeout).",
        "pt-BR": "scaler-prepare não foi concluído no tempo esperado (timeout).",
    },
    "Ambiente inicializado correctamente": {
        "en-US": "Environment initialized successfully",
        "pt-BR": "Ambiente inicializado com sucesso",
    },

    # ── Docker: engine, containers, compose, volumes (docker_service.py, app.py) ──
    "Docker Engine {version} conectado": {
        "en-US": "Docker Engine {version} connected",
        "pt-BR": "Docker Engine {version} conectado",
    },
    "No se pudo conectar al daemon de Docker: {detail}": {
        "en-US": "Could not connect to the Docker daemon: {detail}",
        "pt-BR": "Não foi possível conectar ao daemon do Docker: {detail}",
    },
    "Comando excedió el tiempo límite (timeout)": {
        "en-US": "Command exceeded the time limit (timeout)",
        "pt-BR": "O comando excedeu o tempo limite (timeout)",
    },
    "Acción inválida: {action}": {
        "en-US": "Invalid action: {action}",
        "pt-BR": "Ação inválida: {action}",
    },
    "Contenedor {action} completado": {
        "en-US": "Container {action} completed",
        "pt-BR": "Contêiner {action} concluído",
    },
    "Servicios iniciados correctamente": {
        "en-US": "Services started successfully",
        "pt-BR": "Serviços iniciados com sucesso",
    },
    "Ambiente detenido correctamente": {
        "en-US": "Environment stopped successfully",
        "pt-BR": "Ambiente parado com sucesso",
    },
    "Ambiente eliminado correctamente": {
        "en-US": "Environment removed successfully",
        "pt-BR": "Ambiente removido com sucesso",
    },
    "Faltan credenciales del registro (registro, usuario o contraseña)": {
        "en-US": "Registry credentials are missing (registry, username or password)",
        "pt-BR": "Faltam credenciais do registro (registro, usuário ou senha)",
    },
    "Inicio de sesión exitoso en el registro": {
        "en-US": "Signed in to the registry successfully",
        "pt-BR": "Login no registro realizado com sucesso",
    },
    "Parámetro 'tail' inválido": {
        "en-US": "Invalid 'tail' parameter",
        "pt-BR": "Parâmetro 'tail' inválido",
    },
    "Nombre de volumen inválido": {
        "en-US": "Invalid volume name",
        "pt-BR": "Nome de volume inválido",
    },
    "El volumen '{volume}' es crítico del sistema Studio y está protegido contra eliminación.": {
        "en-US": "Volume '{volume}' is critical to the Studio system and is protected from deletion.",
        "pt-BR": "O volume '{volume}' é essencial para o sistema Studio e está protegido contra exclusão.",
    },
    "El volumen está en uso por contenedores activos ({containers}). Pausa o elimina el ambiente primero.": {
        "en-US": "The volume is in use by running containers ({containers}). Pause or delete the environment first.",
        "pt-BR": "O volume está em uso por contêineres ativos ({containers}). Pause ou exclua o ambiente primeiro.",
    },
    "Volumen '{volume}' eliminado exitosamente": {
        "en-US": "Volume '{volume}' deleted successfully",
        "pt-BR": "Volume '{volume}' excluído com sucesso",
    },
    "No se pudo eliminar el volumen": {
        "en-US": "The volume could not be deleted",
        "pt-BR": "Não foi possível excluir o volume",
    },
    "Error al eliminar volumen: {detail}": {
        "en-US": "Error deleting volume: {detail}",
        "pt-BR": "Erro ao excluir o volume: {detail}",
    },

    # ── Snapshots (backup_service.py) ──
    "Snapshot creado exitosamente": {
        "en-US": "Snapshot created successfully",
        "pt-BR": "Snapshot criado com sucesso",
    },
    "Error al generar snapshot: {detail}": {
        "en-US": "Error creating snapshot: {detail}",
        "pt-BR": "Erro ao gerar o snapshot: {detail}",
    },
    "Nombre de snapshot inválido": {
        "en-US": "Invalid snapshot name",
        "pt-BR": "Nome de snapshot inválido",
    },
    "Snapshot eliminado": {
        "en-US": "Snapshot deleted",
        "pt-BR": "Snapshot excluído",
    },

    # ── Environment volume components ("component" field, env_service.get_environment_volumes) ──
    "Bases de Datos (PostgreSQL)": {
        "en-US": "Databases (PostgreSQL)",
        "pt-BR": "Bancos de dados (PostgreSQL)",
    },
    "Paquetes y Repositorio (Inspire ICM)": {
        "en-US": "Packages and Repository (Inspire ICM)",
        "pt-BR": "Pacotes e Repositório (Inspire ICM)",
    },
    "Almacén de Archivos (Interactive)": {
        "en-US": "File Store (Interactive)",
        "pt-BR": "Armazenamento de Arquivos (Interactive)",
    },
    "Usuarios y Avatares (Demo Mode)": {
        "en-US": "Users and Avatars (Demo Mode)",
        "pt-BR": "Usuários e Avatares (Demo Mode)",
    },
    "Carpeta Compartida Host ↔ Scaler (/sharedfolder)": {
        "en-US": "Host ↔ Scaler Shared Folder (/sharedfolder)",
        "pt-BR": "Pasta Compartilhada Host ↔ Scaler (/sharedfolder)",
    },
    "Directorio de Trabajos Scaler (/opt/scalerSharedFolder)": {
        "en-US": "Scaler Jobs Directory (/opt/scalerSharedFolder)",
        "pt-BR": "Diretório de Jobs do Scaler (/opt/scalerSharedFolder)",
    },
    "Archivos Servidor FTP (/home/vsftpd/system)": {
        "en-US": "FTP Server Files (/home/vsftpd/system)",
        "pt-BR": "Arquivos do Servidor FTP (/home/vsftpd/system)",
    },
}


def resolve_lang(header_value: Optional[str], accept_language: Optional[str] = None) -> str:
    for candidate in [header_value] + [part.split(";")[0] for part in (accept_language or "").split(",")]:
        if not candidate:
            continue
        c = candidate.strip().lower()
        for lang in SUPPORTED_LANGS:
            if lang.lower() == c or lang[:2].lower() == c[:2]:
                return lang
    return SOURCE_LANG


def _compile(template: str) -> Tuple[re.Pattern, List[str]]:
    names: List[str] = []
    pattern = ""
    for literal, name in re.findall(r"([^{]*)(?:\{(\w+)\})?", template):
        pattern += re.escape(literal)
        if name:
            names.append(name)
            pattern += f"(?P<{name}>.+?)"
    return re.compile(f"^{pattern}$", re.DOTALL), names


_EXACT = {k: v for k, v in CATALOG.items() if "{" not in k}
_PATTERNS = [(_compile(k)[0], v) for k, v in CATALOG.items() if "{" in k]


def localize(text: Any, lang: str) -> Any:
    if lang == SOURCE_LANG or not isinstance(text, str) or not text:
        return text
    entry = _EXACT.get(text)
    if entry:
        return entry.get(lang, text)
    for pattern, translations in _PATTERNS:
        m = pattern.match(text)
        if m and lang in translations:
            # Captured values may themselves be catalogued messages (e.g. a nested error)
            values = {k: localize(v, lang) for k, v in m.groupdict().items()}
            return translations[lang].format(**values)
    return text


def localize_payload(data: Any, lang: str) -> Any:
    if lang == SOURCE_LANG:
        return data
    if isinstance(data, dict):
        return {k: (localize(v, lang) if k in LOCALIZED_KEYS and isinstance(v, str) else localize_payload(v, lang))
                for k, v in data.items()}
    if isinstance(data, list):
        return [localize_payload(v, lang) for v in data]
    return data
