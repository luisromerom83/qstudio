/**
 * Digital Advantage Inbox: translations of the messages router.js returns in error / message.
 * Keys are the Spanish (es-MX) texts; {placeholders} are captured from the Spanish message.
 */
const CATALOG = {
  'Quadient Cloud sin configurar (falta: {missing}). Configúralo en Studio Manager.': {
    'en-US': 'Quadient Cloud is not configured (missing: {missing}). Set it up in Studio Manager.',
    'pt-BR': 'Quadient Cloud não configurado (falta: {missing}). Configure-o no Studio Manager.'
  },
  'Quadient Cloud configurado': {
    'en-US': 'Quadient Cloud configured',
    'pt-BR': 'Quadient Cloud configurado'
  },
  'Usuario o contraseña incorrectos': {
    'en-US': 'Wrong username or password',
    'pt-BR': 'Usuário ou senha incorretos'
  },
  'No has iniciado sesión': {
    'en-US': 'You are not signed in',
    'pt-BR': 'Você não está conectado'
  },
  'Quadient Cloud rechazó la solicitud del token: {detail}': {
    'en-US': 'Quadient Cloud rejected the token request: {detail}',
    'pt-BR': 'O Quadient Cloud recusou a solicitação do token: {detail}'
  }
};

module.exports = { CATALOG };
